import { normalizeText, validateTurn } from './contracts.mjs';
import { parseBookingDate } from '../assistant/protocol.mjs';

const TTL = 20 * 60 * 1000;
const blank = () => ({ llmVersion: 1, active: null, drafts: {} });
export const isExplicitTaskCommand = text => /^(?:tasks?|task\s*manager|my\s*tasks|view\s*tasks|status|today'?s?\s*tasks|cancel\s+tasks|(?:done|complete|finish)\s+\d+|done[-\s]*all|complete\s*all|finished\s*all|all\s*done|assign(?:\s+.*)?|team(?:\s*status)?|view\s*team\s*tasks|dept|department)$/i.test(text.trim());

export function parseClock(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(value.trim().replace(/a\.m\.|p\.m\./gi, v => v.replaceAll('.', '')));
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (minute > 59) return null;
    if (match[3]) {
        if (hour < 1 || hour > 12) return null;
        hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
    } else if (!match[2] || hour > 23) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function exactChoice(expression, choices) {
    const name = normalizeText(expression);
    const matches = choices.filter(item => normalizeText(item.name) === name);
    return matches.length === 1 ? matches[0] : null;
}

export async function advanceConversation(input, current, deps) {
    const now = deps.now();
    const state = current?.llmVersion === 1 ? structuredClone(current) : blank();
    const reply = (text, draft = null) => ({ session: state, reply: { key: 'notice', params: [text], text,
        workflow: draft?.workflow || 'menu', conversationId: draft?.id || input.requestId,
        revision: draft?.revision || 0, lastInboundAt: input.inboundAt || now.toISOString() } });
    const user = await deps.findUser(input.phone);
    if (!user || (state.userId && state.userId !== user.id)) {
        return { session: null, reply: { key: 'notice', params: ['Your number could not be linked to an approved account. Contact your property manager.'], text: 'Your number could not be linked to an approved account. Contact your property manager.', lastInboundAt: input.inboundAt || now.toISOString() } };
    }
    state.userId = user.id;
    const properties = await deps.properties(user.id);
    const configs = new Map();
    for (const orgId of new Set(properties.map(p => p.organization_id))) configs.set(orgId, await deps.settings(orgId));
    const allowed = workflow => properties.filter(p => {
        const cfg = configs.get(p.organization_id);
        return cfg?.enabled && cfg.pilotUserIds.includes(user.id) && cfg[workflow === 'booking' ? 'bookingEnabled' : 'ticketEnabled'];
    });
    const recovered = new Map();
    for (const [workflow, draft] of Object.entries(state.drafts)) {
        const accessible = draft.userId === user.id && (!draft.propertyId || allowed(workflow).some(p => p.id === draft.propertyId));
        if (accessible && state.active === workflow && input.text.trim().toLowerCase() === (workflow === 'booking' ? 'confirm booking' : 'submit ticket')) {
            const expected = workflow === 'ticket' ? {propertyId:draft.propertyId,title:draft.fields.issue?.trim(),mediaUrl:draft.mediaUrl || null} : draft.review?.fingerprint;
            const outcome = await (workflow === 'booking' ? deps.findBooking : deps.findTicket)(draft.id, user.id, expected);
            if (outcome?.id && (!outcome.property_id || outcome.property_id === draft.propertyId)) recovered.set(workflow,outcome);
        }
        if (!accessible || (draft.expiresAt <= now.getTime() && !recovered.has(workflow))) delete state.drafts[workflow];
    }
    if (state.active && !state.drafts[state.active]) state.active = null;
    if (!allowed('booking').length && !allowed('ticket').length) return reply('WhatsApp AI is not enabled for your account or you no longer have access. Contact your organization administrator.');
    const text = input.text.trim();
    const normalized = normalizeText(text);
    const menuSelection = ['create ticket','book meeting room'].includes(normalized) && !input.mediaUrl;
    // Quotes bind to the recipient and exact current draft. An old prompt cannot confirm a new action.
    if (input.quotedIds?.length) {
        const quote = await deps.quote?.(input.phone, input.quotedIds);
        if (!quote && !menuSelection) return reply('I cannot link that quoted message to an active request. Send MENU and choose a service, or reply to the latest prompt.');
        // A known menu action can safely start/resume collection even if the provider omitted its outbound ID.
        if (quote) {
        if (quote.workflow === 'task') return reply('That reply belongs to Task Manager. Send TASKS or DONE followed by the task number. Your facility request is still saved.');
        if (quote.workflow !== 'menu') {
            const draft = state.drafts[quote.workflow];
            if (!draft || draft.id !== quote.conversation_id || draft.revision !== quote.revision) return reply('That is an older or completed request. Please reply to the latest prompt or send MENU.');
            state.active = quote.workflow;
        } else if (!['create ticket', 'book meeting room', 'hi', 'hello', 'hey', 'menu'].includes(normalized)) {
            return reply('Please choose Create Ticket or Book Meeting Room from the menu.');
        }
        }
    }
    if (isExplicitTaskCommand(text)) return reply('This message belongs to Task Manager. Send TASKS to continue there. Your facility request is still saved.');
    if (!input.mediaUrl && /^(hi|hello|hey|menu|help|options)$/.test(normalized)) {
        state.active = null;
        return { session: state, reply: { key: 'menu', params: [], workflow: 'menu', conversationId: input.requestId, revision: 0, lastInboundAt: input.inboundAt || now.toISOString() } };
    }
    const selected = !input.mediaUrl && (normalized === 'create ticket' ? 'ticket' : normalized === 'book meeting room' ? 'booking' : null);
    if (selected) {
        if (!allowed(selected).length) return reply('This service is not enabled for your account.');
        state.active = selected;
        state.drafts[selected] ||= { workflow: selected, id: input.requestId, userId: user.id, fields: {}, revision: 0 };
    }
    const draft = state.drafts[state.active];
    if (!draft) return reply('Please send HI and choose Create Ticket or Book Meeting Room first. For task updates, send TASKS.');
    if (!input.mediaUrl && /\b(?:tasks?|done|completed|finished)\b/i.test(text) && !menuSelection) return reply('This sounds like a task update. Send TASKS or DONE followed by the task number. Your facility request is still saved.', draft);
    if (!input.mediaUrl && /\b(?:do not|don['’]?t|never)\s+(?:create|raise|book|submit|confirm)\b/i.test(text)) return reply('I will not submit this request. Send a correction, or CANCEL to discard it.', draft);
    if (!input.quotedIds?.length && !input.mediaUrl && /^(?:yes|no|done|cancel|\d+)$/.test(normalized) &&
        (Object.keys(state.drafts).length > 1 || await deps.hasTaskContext?.(input.phone))) {
        return reply('That short reply could refer to more than one conversation. Reply to the latest service prompt, or send Confirm Booking / Submit Ticket. For task updates, send TASKS.', draft);
    }
    draft.expiresAt = now.getTime() + TTL;
    if (!input.mediaUrl && normalized === 'cancel') {
        delete state.drafts[state.active]; state.active = null;
        return reply('This request was cancelled. Send HI to start another request.');
    }
    const confirmation = !input.mediaUrl && (draft.workflow === 'booking' ? /^confirm booking$/ : /^submit ticket$/).test(normalized);
    if (!input.mediaUrl && /^(yes|confirm|submit|no)$/.test(normalized)) return reply('Please use Confirm Booking or Submit Ticket for the selected request, or send a correction.', draft);
    const choices = allowed(draft.workflow);
    let changed = false;
    if (!input.mediaUrl && draft.workflow==='ticket' && /^(no photo|remove photo|without photo)$/.test(normalized)) {
        delete draft.mediaUrl;changed=true;
    } else if (!selected && !confirmation && !input.mediaUrl && /^\d+$/.test(text) && draft.choices) {
        const option = draft.choices.items[Number(text) - 1];
        if (!option) return reply('Please choose one of the option numbers shown in the latest message.', draft);
        if (draft.choices.kind === 'property') {draft.propertyId = option.id;delete draft.roomId;}
        else {draft.fields.room = option.name;draft.roomId = option.id;}
        changed = true;
    } else if (!selected && !confirmation && !(normalized === 'add photo' && !input.mediaUrl)) {
        let pendingMedia = null;
        if (input.mediaUrl) {
            if (draft.workflow !== 'ticket' || input.mediaType !== 'image') return reply('Please send a photo only for a ticket, or send the booking details as text.', draft);
            try { if (new URL(input.mediaUrl).protocol !== 'https:') throw new Error(); }
            catch { return reply('The photo could not be accepted. Please send it again.', draft); }
            pendingMedia = input.mediaUrl;
        }
        if (text) {
            const result = await deps.interpret({ workflow: draft.workflow, text, pending: Object.keys(draft.fields) });
            const validated = result.ok ? validateTurn({ intent: result.intent, fields: result.fields }, draft.workflow, text) : result;
            if (!validated.ok || validated.intent !== 'details') return reply('I could not safely understand that message for this request. Please send the requested details again. For task updates, send TASKS.', draft);
            for (const [field, value] of Object.entries(validated.fields)) if (value !== null) { draft.fields[field] = value; changed = true; }
            if (validated.fields.room) delete draft.roomId;
            if (validated.fields.property) {
                const property = exactChoice(validated.fields.property, choices);
                delete draft.propertyId;
                delete draft.roomId;
                if (property) draft.propertyId = property.id;
            }
        }
        if (pendingMedia) { draft.mediaUrl = pendingMedia; changed = true; }
    }
    if (changed) { draft.revision++; delete draft.review; delete draft.choices; }
    if (!draft.propertyId && choices.length === 1 && !draft.fields.property) draft.propertyId = choices[0].id;
    const property = choices.find(p => p.id === draft.propertyId);
    if (!property) {
        // Never show another organization's data through a model-proposed property name.
        draft.choices = { kind: 'property', items: choices.slice(0, 20).map(p => ({ id:p.id, name:p.name })) };
        return reply(`Choose the property for this ${draft.workflow} (reply with its name or number):\n${draft.choices.items.map((p,i)=>`${i+1}. ${p.name}`).join('\n')}${choices.length>20 ? '\nMore properties are available; send the exact property name.' : ''}`, draft);
    }
    const cfg = configs.get(property.organization_id);
    if (confirmation && recovered.has(draft.workflow)) {
        delete state.drafts[draft.workflow]; state.active = null;
        return { session:state,reply:null };
    }
    const reviewMatches = fingerprint => draft.review?.revision === draft.revision && draft.review?.fingerprint === fingerprint;
    const setReview = fingerprint => {
        if (draft.review && draft.review.fingerprint !== fingerprint) draft.revision++;
        draft.review = {revision:draft.revision,fingerprint};
    };
    if (draft.workflow === 'ticket') {
        const issue = draft.fields.issue?.trim();
        if (!issue) return reply(`What is the issue at ${property.name}? Send a description or a photo with the issue in its caption. A photo is optional.`, draft);
        if (issue.length > 2000) return reply('Please shorten the issue description to 2,000 characters.', draft);
        if (normalized === 'add photo') return reply('Send a photo now, or reply Submit Ticket to continue without a photo.', draft);
        const fingerprint = JSON.stringify([property.id,property.name,issue,draft.mediaUrl || null]);
        if (!confirmation || !reviewMatches(fingerprint)) {
            setReview(fingerprint);
            return reply(`Create a ticket at ${property.name}:\n${issue}\n${draft.mediaUrl ? 'Photo attached.' : 'Photo is optional: send one now if needed.'}\nReply Submit Ticket to create it, or send a correction.`, draft);
        }
        let ticket;
        try {
            ticket = await deps.createTicket({ phone: input.phone, userId: user.id, propertyId: property.id,
                title: issue, mediaUrl: draft.mediaUrl || null, messageId: input.messageId, requestId: draft.id, interpreter: true });
        } catch(error) {
            if(error.code==='OPERATION_ALREADY_CREATED') {
                delete state.drafts[draft.workflow];state.active=null;
                return reply('An earlier ticket was already created for this request. Check it in the app or contact your property manager. To create a ticket with different details, send HI and start a new request.');
            }
            if(error.code!=='INVALID_MEDIA')throw error;
            delete draft.review;
            return reply('The photo could not be accepted. Send a supported photo again, or reply No Photo to continue without it.',draft);
        }
        if (!ticket?.id) throw new Error('Ticket service did not return a stored ticket');
    } else {
        const roomList = await deps.rooms(property.id);
        const room = draft.roomId ? roomList.find(r=>r.id===draft.roomId) || null : draft.fields.room ? exactChoice(draft.fields.room, roomList) : roomList.length === 1 ? roomList[0] : null;
        const date = draft.fields.date ? parseBookingDate(draft.fields.date, now) : cfg.defaultDate === 'today' ? parseBookingDate('today',now) : null;
        const startTime = parseClock(draft.fields.start), endTime = parseClock(draft.fields.end);
        const missing = [];
        if (!date) missing.push('date (today, tomorrow, or DD-MM-YYYY)');
        if (!room) missing.push('meeting room');
        if (!startTime || !endTime) missing.push('both start and end times with AM/PM (e.g. 2.30 PM to 3 PM) or 24-hour HH:MM');
        if (missing.length) {
            if (!room) draft.choices = {kind:'room',items:roomList.slice(0,20).map(r=>({id:r.id,name:r.name}))};
            return reply(`For ${property.name}, please send: ${missing.join('; ')}.${!room ? `\nRooms: ${draft.choices.items.map((r,i)=>`${i+1}. ${r.name}`).join('; ') || 'No active rooms available.'}${roomList.length>20 ? '\nMore rooms are available; send the exact room name.' : ''}` : ''}`, draft);
        }
        if (endTime <= startTime) { delete draft.review; return reply('The end time must be later than the start time on the same day. Please send both times again.', draft); }
        if (Date.parse(`${date}T${startTime}:00+05:30`) <= now.getTime()) { delete draft.review; return reply('The start time has passed. Please send a future date and time.', draft); }
        {
            const available = await deps.availableRooms(property.id,date,startTime,endTime);
            if (!available.some(r=>r.id === room.id)) { delete draft.review; return reply('That room is unavailable during the requested hours. Please choose another room or time.', draft); }
            const credit = await deps.creditSummary(user.id,property.id,{start_time:startTime,end_time:endTime});
            const fingerprint = JSON.stringify([property.id,property.name,room.id,room.name,date,startTime,endTime]);
            if (!confirmation || !reviewMatches(fingerprint)) {
                setReview(fingerprint);
                return reply(`Book ${room.name} at ${property.name}\n${date}, ${startTime} to ${endTime} IST\n${credit}\nReply Confirm Booking to book, or send a correction.`, draft);
            }
            try {
                const booking = await deps.bookRange({userId:user.id,propertyId:property.id,roomId:room.id,date,startTime,endTime,requestId:draft.id,interpreter:true});
                if (!booking?.id) throw new Error('Booking service did not return a stored booking');
            } catch (error) {
                if(error.code==='OPERATION_ALREADY_CREATED') {
                    delete state.drafts[draft.workflow];state.active=null;
                    return reply('An earlier booking was already created for this request. Check it in the app. To book different details, send HI and start a new request.');
                }
                if (!['SLOT_UNAVAILABLE','INSUFFICIENT_CREDITS','MULTIPLE_COMPANIES','ACCESS_REVOKED','INVALID_BOOKING'].includes(error.code)) throw error;
                delete draft.review;
                if (error.code === 'ACCESS_REVOKED') {delete state.drafts[draft.workflow];state.active=null;return reply('Your access changed. Please contact your property manager.');}
                if (error.code === 'INVALID_BOOKING') return reply('The room or booking hours changed. Please send a new room, date and time.',draft);
                return reply(error.code === 'INSUFFICIENT_CREDITS' ? 'You do not have enough meeting-room credits. Contact your property manager or choose a shorter duration.' : error.code === 'MULTIPLE_COMPANIES' ? 'Please contact your property manager to resolve your company account.' : 'That room is no longer available. Please choose another room or time.', draft);
            }
        }
    }
    // Existing omnichannel/outbox owns completion notifications. Never invent a success or send a duplicate campaign.
    delete state.drafts[draft.workflow]; state.active = null;
    return {session:state,reply:null};
}
