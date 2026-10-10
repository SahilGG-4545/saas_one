/**
 * Phase 0 — baseline report (100% OFFLINE: fake audit rows, no network, no database, no WhatsApp).
 * Run: npx tsx task-manager/tests/test_baseline_report.ts
 */
let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const R = await import('../brain/baseline_report');

    // Day A = 2026-10-09 IST, Day B = 2026-10-10 IST (19:00 UTC on the 9th is already the 10th in IST).
    const A = '2026-10-09T05:00:00.000Z', B = '2026-10-09T19:00:00.000Z';
    const audit = [
        { created_at: A, event_type: 'whatsapp_received', details: { system: 'TASK_MANAGER', reason: 'done_number_pattern' } },
        { created_at: A, event_type: 'whatsapp_received', details: { system: 'AMBIGUOUS', reason: 'ambiguous_employee_greeting_or_help' } },
        { created_at: A, event_type: 'whatsapp_received', details: { system: 'FACILITY', reason: 'default_facility_fallback' } },
        { created_at: A, event_type: 'whatsapp_received', details: { system: 'AMBIGUOUS', reason: 'nl_unclear_in_task_session' } },
        { created_at: A, event_type: 'brain_shadow', details: { status: 'ok', outcome: 'ACT', ms: 3000 } },
        { created_at: A, event_type: 'brain_shadow', details: { status: 'ai_unavailable', outcome: null, ms: 15000 } },
        { created_at: A, event_type: 'whatsapp_sent', details: { type: 'morning_digest', status: 'sent', phone: '+919999999999', preview: 'SECRET TASK LIST' } },
        { created_at: A, event_type: 'whatsapp_sent', details: { type: 'pending_reminder', status: 'failed' } },
        { created_at: A, event_type: 'whatsapp_sent', details: { type: 'bot_reply', status: 'simulated' } },
        { created_at: B, event_type: 'brain_live', details: { status: 'ok', outcome: 'CONFIRM', ms: 2000 } },
        { created_at: B, event_type: 'brain_live', details: { status: 'ok', outcome: 'CLARIFY', ms: 4000 } },
        { created_at: B, event_type: 'voice_note', details: {} },
        { created_at: B, event_type: 'whatsapp_blocked_by_kill_switch', details: { reason: 'global' } },
    ];
    const now = new Date('2026-10-10T06:00:00.000Z');
    const queue = [
        { created_at: A, updated_at: A, status: 'sent', attempts: 1 },
        { created_at: A, updated_at: A, status: 'failed', attempts: 3 },
        { created_at: B, updated_at: '2026-10-10T05:30:00.000Z', status: 'pending', attempts: 0 },   // 30 min old → stuck
        { created_at: B, updated_at: '2026-10-10T05:58:00.000Z', status: 'processing', attempts: 1 }, // 2 min old → not stuck
    ];

    const b = R.summarize(audit, queue, now);
    const a = b.byDay['2026-10-09'], bb = b.byDay['2026-10-10'];

    check('IST day split: 19:00 UTC counts on the next day', b.days.join(',') === '2026-10-09,2026-10-10', b.days);
    check('old-router messages counted', a.inbound.router === 4, a.inbound);
    check('fallbacks: menu ×2 + facility default, not the real command', Object.values(a.fallbacks).reduce((x, y) => x + y, 0) === 3, a.fallbacks);
    check('shadow: AI unavailable counted apart from outcomes', a.shadow.total === 2 && a.shadow.aiUnavailable === 1 && a.shadow.outcomes.ACT === 1, a.shadow);
    check('scheduled sends split by type and status', a.scheduled['morning_digest · sent'] === 1 && a.scheduled['pending_reminder · failed'] === 1, a.scheduled);
    check('pretend-mode bot replies are not counted as scheduled sends', !Object.keys(a.scheduled).some(k => k.startsWith('bot_reply')), a.scheduled);
    check('Smart chat outcomes counted', bb.inbound.smartChat === 2 && bb.smartChatOutcomes.CONFIRM === 1 && bb.smartChatOutcomes.CLARIFY === 1, bb.smartChatOutcomes);
    check('voice notes and kill-switch blocks counted', bb.inbound.voice === 1 && bb.blocked === 1, bb);
    check('facility queue: per-day count + status totals', a.inbound.facilityQueue === 2 && bb.inbound.facilityQueue === 2 && b.queue.sent === 1 && b.queue.failed === 1, b.queue);
    check('stuck = waiting longer than 10 min only', b.queueStuck === 1, b.queueStuck);
    check('retried = more than one attempt', b.queueRetried === 1, b.queueRetried);

    const text = R.render(b, 7);
    check('report shows the fallback rate', /Fallback rate\s+3 \/ 4 old-router messages = 75%/.test(text), text);
    check('report never prints phone numbers or message previews', !text.includes('9999') && !text.includes('SECRET'), text);
    check('report is honest that no-reply is not measurable yet', text.includes('NOT MEASURABLE YET'));
    check('report says accepted ≠ delivered', text.includes('accepted ≠ delivered'));

    const empty = R.render(R.summarize([], [], now), 7);
    check('no shadow rows → tells you how to switch it on', empty.includes('TASK_BRAIN_SHADOW=true'), empty);

    check('no network used', net.length === 0, net);

    console.log(failures === 0 ? '\n🎉 BASELINE REPORT TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
