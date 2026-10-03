import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { processIncomingMessage } from '@/backend/lib/whatsapp/processMessage';
import { AiSensyService } from '@/backend/services/AiSensyService';
import { NotificationService } from '@/backend/services/NotificationService';
import { getBookingDateTimeIST } from '@/backend/utils/timezone';
import { findWhatsAppUser, getWhatsAppProperties } from './access';
import { advance } from './engine.mjs';
import { drainPhone } from './worker.mjs';

async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin.rpc(name, args);
    if (error) throw error;
    return data;
}

interface EventClaim {
    token: string;
    event: { id: string; payload: Record<string, unknown>; snapshot: unknown; reply: unknown };
}

const store = {
    async claim(phone: string): Promise<EventClaim | null> {
        const token = randomUUID();
        const event = await rpc('whatsapp_assistant_claim', { p_phone: phone, p_token: token });
        return event ? { event, token } : null;
    },
    async save(claim: EventClaim, state: unknown, reply: unknown) {
        await rpc('whatsapp_assistant_save', { p_id: claim.event.id, p_token: claim.token, p_state: state, p_reply: reply });
    },
    async fail(claim: EventClaim, error: string) {
        await rpc('whatsapp_assistant_fail', { p_id: claim.event.id, p_token: claim.token, p_error: error });
    },
    async finish(claim: EventClaim, error: string | null) {
        await rpc('whatsapp_assistant_finish', { p_id: claim.event.id, p_token: claim.token, p_error: error });
    },
};

async function rooms(propertyId: string) {
    const { data, error } = await supabaseAdmin.from('meeting_rooms').select('id,name,property_id')
        .eq('property_id', propertyId).eq('status', 'active').order('name').order('id');
    if (error) throw error;
    return data || [];
}

async function slots(propertyId: string, roomId: string, date: string) {
    if (!(await rooms(propertyId)).some(room => room.id === roomId)) return [];
    const [slotResult, bookingResult] = await Promise.all([
        supabaseAdmin.from('meeting_room_slots').select('id,start_time,end_time').order('start_time').order('id'),
        supabaseAdmin.from('meeting_room_bookings').select('start_time,end_time')
            .eq('property_id', propertyId).eq('meeting_room_id', roomId).eq('booking_date', date).eq('status', 'confirmed'),
    ]);
    if (slotResult.error) throw slotResult.error;
    if (bookingResult.error) throw bookingResult.error;
    return (slotResult.data || []).filter(slot => slot.end_time > slot.start_time &&
        getBookingDateTimeIST(date, slot.start_time).getTime() > Date.now() &&
        !(bookingResult.data || []).some(booking => booking.start_time < slot.end_time && booking.end_time > slot.start_time));
}

async function availableRooms(propertyId: string, date: string, startTime: string, endTime: string) {
    const [roomList, booked, configured] = await Promise.all([
        rooms(propertyId),
        supabaseAdmin.from('meeting_room_bookings').select('meeting_room_id').eq('property_id', propertyId)
            .eq('booking_date', date).eq('status', 'confirmed').lt('start_time', endTime).gt('end_time', startTime),
        supabaseAdmin.from('meeting_room_slots').select('start_time,end_time').order('start_time'),
    ]);
    if (booked.error) throw booked.error;
    if (configured.error) throw configured.error;
    // Check union coverage; the transactional RPC checks it again before inserting.
    let coveredUntil = startTime;
    for (const slot of configured.data || []) {
        if (slot.start_time.slice(0, 5) <= coveredUntil && slot.end_time.slice(0, 5) > coveredUntil) coveredUntil = slot.end_time.slice(0, 5);
    }
    if (coveredUntil < endTime) return [];
    return roomList.filter(room => !(booked.data || []).some(booking => booking.meeting_room_id === room.id));
}

async function creditSummary(userId: string, propertyId: string, slot: { start_time: string; end_time: string }) {
    const { data: members, error: memberError } = await supabaseAdmin.from('company_members')
        .select('company_id, company:companies!inner(property_id)').eq('user_id', userId).eq('company.property_id', propertyId);
    if (memberError) throw memberError;
    if ((members || []).length > 1) return 'Multiple companies at this property. Please contact your property manager.';
    const companyId = members?.[0]?.company_id;
    let query = supabaseAdmin.from('meeting_room_credits').select('remaining_hours').eq('property_id', propertyId);
    query = companyId ? query.eq('company_id', companyId) : query.eq('user_id', userId).is('company_id', null);
    const { data: credit, error } = await query.maybeSingle();
    if (error) throw error;
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const needed = (minutes(slot.end_time) - minutes(slot.start_time)) / 60;
    return credit ? `${needed} hours required; ${credit.remaining_hours} hours remaining` : 'No credit record; current app booking rules apply';
}

const dependencies = {
    now: () => new Date(), findUser: findWhatsAppUser, properties: getWhatsAppProperties, rooms, slots, creditSummary, availableRooms,
    async createTicket(request: { phone: string; userId: string; propertyId: string; title: string; mediaUrl: string | null; messageId: string; requestId: string }) {
        return processIncomingMessage(request.phone, request.title, request.mediaUrl, null, !!request.mediaUrl,
            null, null, false, request.propertyId, request.messageId,
            { userId: request.userId, requestId: request.requestId, suppressReply: true, throwOnError: true });
    },
    async bookRange(request: { userId: string; propertyId: string; roomId: string; date: string; startTime: string; endTime: string; requestId: string }) {
        try {
            const booking = await rpc('whatsapp_assistant_book_range', { p_user_id: request.userId, p_property_id: request.propertyId,
                p_room_id: request.roomId, p_date: request.date, p_start_time: request.startTime, p_end_time: request.endTime,
                p_request_id: request.requestId });
            await NotificationService.afterRoomBooked(booking.id).catch(error => console.error('[WhatsAppAssistant] Booking notification failed', error));
            return booking;
        } catch (error) {
            const failure = error as { code?: string; message?: string };
            if (failure.code === '23P01' || failure.message?.includes('SLOT_UNAVAILABLE')) throw Object.assign(new Error('Slot unavailable'), { code: 'SLOT_UNAVAILABLE' });
            if (failure.message?.includes('INSUFFICIENT_CREDITS')) throw Object.assign(new Error('Insufficient credits'), { code: 'INSUFFICIENT_CREDITS' });
            throw error;
        }
    },
    async bookRoom(request: { userId: string; propertyId: string; roomId: string; slotId: string; date: string; requestId: string }) {
        try {
            const booking = await rpc('whatsapp_assistant_book', { p_user_id: request.userId, p_property_id: request.propertyId,
                p_room_id: request.roomId, p_slot_id: request.slotId, p_date: request.date, p_request_id: request.requestId });
            // Existing booking outbox triggers handle email; retain the app's notification hook.
            await NotificationService.afterRoomBooked(booking.id).catch(error => console.error('[WhatsAppAssistant] Booking notification failed', error));
            return booking;
        } catch (error) {
            const failure = error as { code?: string; message?: string };
            if (failure.code === '23P01' || failure.message?.includes('SLOT_UNAVAILABLE')) {
                throw Object.assign(new Error('Slot unavailable'), { code: 'SLOT_UNAVAILABLE' });
            }
            if (failure.message?.includes('INSUFFICIENT_CREDITS')) {
                throw Object.assign(new Error('Insufficient credits'), { code: 'INSUFFICIENT_CREDITS' });
            }
            throw error;
        }
    },
};

export async function enqueueAssistantMessage(payload: Record<string, unknown>) {
    return rpc('whatsapp_assistant_enqueue', { p_payload: payload });
}

export async function drainWhatsAppPhone(phone: string) {
    return drainPhone(phone, { store, advance, dependencies: { ...dependencies,
        bookRange: process.env.AISENSY_MESSAGE_BOOKING_ENABLED === 'true' ? dependencies.bookRange : undefined },
        send: (destination: string, reply: { key: string; params: string[] }) => AiSensyService.sendAssistantReply(destination, reply),
        log: (entry: Record<string, unknown>) => console.info('[WhatsAppAssistant]', JSON.stringify(entry)),
    });
}

export async function retryWhatsAppAssistant() {
    const { data, error } = await supabaseAdmin.from('whatsapp_assistant_events').select('phone')
        .in('status', ['pending','processing','ready']).order('created_at').limit(100);
    if (error) throw error;
    const phones = [...new Set((data || []).map(event => event.phone))].slice(0, 10);
    let processed = 0;
    for (let i = 0; i < phones.length; i += 3) {
        const results = await Promise.allSettled(phones.slice(i, i + 3).map(drainWhatsAppPhone));
        for (const result of results) {
            if (result.status === 'fulfilled') processed += result.value;
            else console.error('[WhatsAppAssistant] Retry failed', result.reason);
        }
    }
    return { phones: phones.length, processed };
}
