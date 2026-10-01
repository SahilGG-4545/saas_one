import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { normalizeInbound } from '@/backend/lib/whatsapp/assistant/protocol.mjs';
import { enqueueAssistantMessage, drainWhatsAppPhone } from '@/backend/lib/whatsapp/assistant/runtime';
import { processIncomingMessage } from '@/backend/lib/whatsapp/processMessage';
import { isGreetingMessage } from '@/backend/lib/whatsapp/greeting';
import { AiSensyService } from '@/backend/services/AiSensyService';

export const runtime = 'nodejs';
export const maxDuration = 120;

function secretMatches(value: string | null, expected: string) {
    if (!value) return false;
    const candidate = Buffer.from(value);
    const secret = Buffer.from(expected);
    return candidate.length === secret.length && timingSafeEqual(candidate, secret);
}

export async function GET() {
    return NextResponse.json({ status: 'ok', service: 'AiSensy inbound webhook',
        assistantEnabled: process.env.AISENSY_ASSISTANT_ENABLED === 'true' });
}

export async function POST(req: NextRequest) {
    const enabled = process.env.AISENSY_ASSISTANT_ENABLED === 'true';
    const secret = process.env.AISENSY_WEBHOOK_SECRET;
    // A phone number in an unauthenticated payload must never authorize a booking.
    if (enabled && !secret) return NextResponse.json({ error: 'Webhook authentication is not configured' }, { status: 503 });
    if (secret) {
        const supplied = req.headers.get('x-aisensy-secret') || req.headers.get('x-webhook-secret') || req.headers.get('authorization');
        if (!secretMatches(req.nextUrl.searchParams.get('secret'), secret) &&
            !secretMatches(supplied, secret) && !secretMatches(supplied, `Bearer ${secret}`)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }
    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 }); }
    const input = normalizeInbound(body);
    if (!input) return NextResponse.json({ ok: true, ignored: true });
    if (input.mediaUrl) {
        try { if (new URL(input.mediaUrl).protocol !== 'https:') throw new Error('Invalid protocol'); }
        catch { return NextResponse.json({ error: 'Media must use an HTTPS URL' }, { status: 400 }); }
    }
    if (!enabled) {
        after(async () => {
            try {
                if (!input.mediaUrl && isGreetingMessage(input.text)) await AiSensyService.sendGreeting(input.phone);
                else await processIncomingMessage(input.phone, input.text,
                    input.mediaType === 'image' ? input.mediaUrl : null, null, input.mediaType === 'image',
                    input.mediaType === 'video' ? input.mediaUrl : null, null, input.mediaType === 'video', null, input.messageId || null);
            } catch (error) { console.error('[AiSensyWebhook] Legacy processing failed', error); }
        });
        return NextResponse.json({ success: true });
    }
    if (!input.messageId) return NextResponse.json({ error: 'A stable inbound messageId is required' }, { status: 400 });
    try {
        // Persist first, then acknowledge immediately. No scheduled queue wait on this path.
        const eventId = await enqueueAssistantMessage(input);
        console.info('[AiSensyWebhook] Received', { eventId, receivedAt: new Date().toISOString(), duplicate: !eventId });
        after(async () => {
            try { await drainWhatsAppPhone(input.phone); }
            catch (error) { console.error('[AiSensyWebhook] Deferred processing failed; cron will retry', error); }
        });
        return NextResponse.json({ success: true, queued: !!eventId, duplicate: !eventId });
    } catch (error) {
        console.error('[AiSensyWebhook] Could not persist message', error);
        return NextResponse.json({ error: 'Message could not be accepted; retry delivery' }, { status: 503 });
    }
}
