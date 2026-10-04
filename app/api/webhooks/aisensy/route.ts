import { NextRequest, NextResponse, after } from 'next/server';
import { normalizeInbound } from '@/backend/lib/whatsapp/assistant/protocol.mjs';
import { enqueueAssistantMessage, drainWhatsAppPhone } from '@/backend/lib/whatsapp/assistant/runtime';
import { processIncomingMessage } from '@/backend/lib/whatsapp/processMessage';
import { isGreetingMessage } from '@/backend/lib/whatsapp/greeting';
import { AiSensyService } from '@/backend/services/AiSensyService';
import { handleFreeformTest } from '@/whatsapp-test/freeformTest';
import { TaskMessageRouter } from '@/task-manager/TaskMessageRouter';
import { TaskIdempotencyService } from '@/task-manager/TaskIdempotencyService';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Log field names and types only: never sender numbers, message text, or credentials.
// Bound traversal so unexpected provider payloads cannot create oversized logs.
function payloadShape(value: unknown, depth = 0): unknown {
    if (value === null) return 'null';
    if (Array.isArray(value)) return depth >= 5 ? 'array' : value.slice(0, 1).map(item => payloadShape(item, depth + 1));
    if (typeof value !== 'object') return typeof value;
    if (depth >= 5) return 'object';
    return Object.fromEntries(Object.entries(value).slice(0, 30)
        .map(([key, item]) => [key, payloadShape(item, depth + 1)]));
}

export async function GET() {
    return NextResponse.json({ status: 'ok', service: 'AiSensy inbound webhook',
        assistantEnabled: process.env.AISENSY_ASSISTANT_ENABLED === 'true' });
}

export async function POST(req: NextRequest) {
    const enabled = process.env.AISENSY_ASSISTANT_ENABLED === 'true';
    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 }); }
    const input = normalizeInbound(body);
    console.info('[AiSensyWebhook] Payload inspected', JSON.stringify({
        assistantEnabled: enabled,
        normalized: !!input,
        hasMessageId: !!input?.messageId,
        hasText: !!input?.text,
        hasMedia: !!input?.mediaUrl,
        shape: payloadShape(body),
    }));
    if (!input) return NextResponse.json({ ok: true, ignored: true });

    // Idempotency: Ignore duplicate webhook deliveries (Phase 19)
    if (input.messageId && await TaskIdempotencyService.isDuplicateWebhook(input.messageId)) {
        console.info('[AiSensyWebhook] Duplicate delivery ignored', { messageId: input.messageId });
        return NextResponse.json({ success: true, duplicate: true });
    }
    if (input.messageId) {
        TaskIdempotencyService.recordProcessedWebhook(input.messageId);
    }

    if (await handleFreeformTest(input)) return NextResponse.json({ success: true, test: true });
    if (input.mediaUrl) {
        try { if (new URL(input.mediaUrl).protocol !== 'https:') throw new Error('Invalid protocol'); }
        catch { return NextResponse.json({ error: 'Media must use an HTTPS URL' }, { status: 400 }); }
    }

    // Task Manager WhatsApp Routing (Phase 6)
    if (input.text) {
        try {
            const routeResult = await TaskMessageRouter.routeInboundMessage({
                phone: input.phone,
                text: input.text,
                messageId: input.messageId || undefined
            });

            if (routeResult.handledByTaskManager) {
                console.info('[AiSensyWebhook] Inbound routed to TASK_MANAGER', {
                    phoneMasked: input.phone.replace(/(\d{4})\d+(\d{2})/, '$1****$2'),
                    command: routeResult.taskResult?.command
                });
                return NextResponse.json({ success: true, routedTo: 'TASK_MANAGER' });
            }
        } catch (routeError) {
            console.error('[AiSensyWebhook] Task routing error, falling back to facility:', routeError);
        }
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
