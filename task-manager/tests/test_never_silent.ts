/**
 * Phase 1 — "never silent" (OFFLINE: fake database URL, a network trap, a fake watchdog IO; no database, no WhatsApp).
 * Run: npx tsx task-manager/tests/test_never_silent.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
delete process.env.WHATSAPP_NEVER_SILENT_ENABLED;

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    // The switches live in the Task Manager settings: stub that read (no database in this test).
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const S = await import('../BotSwitches');
    let settings: any = { neverSilentEnabled: false, conversationMemoryEnabled: false };
    let settingsReads = 0;
    (TaskDatabaseService as any).getTestingConfig = async () => { settingsReads++; if (settings === 'throw') throw new Error('db down'); return settings; };
    const L = await import('../InboundLedger');
    const W = await import('../NeverSilentWatchdog');

    console.log('\n1. The ledger');
    check('phone key: "+91 98765-43210", "919876543210" and "9876543210" are the same person',
        L.phoneKey('+91 98765-43210') === '9876543210' && L.phoneKey('919876543210') === '9876543210' && L.phoneKey('9876543210') === '9876543210');
    await L.recordInbound('m1', '919876543210'); await L.markRoute('m1', 'smart_chat'); await L.markReplied('919876543210');
    check('switch OFF → nothing is written, nothing is even attempted', net.length === 0, net);

    console.log('\n0. The switches (Task Access panel, no redeploy)');
    S.resetBotSwitchCache(); settings = { neverSilentEnabled: true, conversationMemoryEnabled: false };
    check('ON in the settings → on', (await S.botSwitchOn('neverSilent')) === true && (await S.botSwitchOn('conversationMemory')) === false);
    const readsBefore = settingsReads;
    settings = { neverSilentEnabled: false }; await S.botSwitchOn('neverSilent'); await S.botSwitchOn('neverSilent');
    check('read at most every 30 seconds (cached), so a send does not hit the database each time', settingsReads === readsBefore);
    S.resetBotSwitchCache();
    check('after an admin flips it (cache reset) → the new value', (await S.botSwitchOn('neverSilent')) === false);
    const r0 = settingsReads; S.primeBotSwitches({ neverSilent: true });
    check('a send reuses the safety gate\'s own settings read (no second read)', (await S.botSwitchOn('neverSilent')) === true && settingsReads === r0);
    S.resetBotSwitchCache(); settings = 'throw';
    check('settings unreadable → OFF (fail closed)', (await S.botSwitchOn('neverSilent')) === false);
    S.resetBotSwitchCache(); settings = { neverSilentEnabled: false, conversationMemoryEnabled: false };
    process.env.WHATSAPP_NEVER_SILENT_ENABLED = 'true';
    check('the old env variable still forces it ON', (await S.botSwitchOn('neverSilent')) === true);
    net.length = 0;
    const origWarn = console.warn; console.warn = () => {};
    let threw = false;
    try { await L.recordInbound('m1', '919876543210'); await L.markRoute('m1', 'smart_chat'); await L.markReplied('919876543210'); } catch { threw = true; }
    console.warn = origWarn;
    check('switch ON but the database is unreachable → errors are swallowed, the webhook is never broken', !threw);
    net.length = 0;
    await L.recordInbound(null, '919876543210'); await L.recordInbound('m2', ''); await L.recordInbound('m3', '12345');
    check('no message id, no phone, or a short number → ignored', net.length === 0, net);

    console.log('\n2. The watchdog');
    const now = new Date('2026-10-11T10:00:00.000Z');
    const world = (rows: any[], over: any = {}) => {
        const w: any = { rows, sent: [] as any[], claimed: [] as string[], purgedBefore: null as string | null, listArgs: null as any };
        w.io = {
            listOverdue: async (olderThan: string, newerThan: string) => { w.listArgs = { olderThan, newerThan }; return w.rows; },
            recentApologyKeys: async () => new Set<string>(over.recent || []),
            claim: async (id: string) => { if ((over.taken || []).includes(id)) return false; w.claimed.push(id); return true; },
            claimByMessageId: async (mid: string) => !(over.taken || []).includes(mid),
            send: async (phone: string, text: string) => { if (over.sendThrows) throw new Error('boom'); w.sent.push({ phone, text }); return !over.sendFails; },
            purge: async (before: string) => { w.purgedBefore = before; return 3; },
        };
        return w;
    };
    const row = (id: string, key: string) => ({ id, phone: `91${key}`, phone_key: key, received_at: '2026-10-11T09:55:00.000Z' });

    let w = world([row('r1', '9000000001'), row('r2', '9000000002')]);
    let r = await W.runWatchdog(w.io, now);
    check('two people with no reply → each gets ONE apology', r.apologised === 2 && w.sent.length === 2 && w.sent.every((s: any) => s.text === W.APOLOGY_TEXT), r);
    check('looks only at messages older than 2 min and newer than 40 min (covers the 15-minute cron)', w.listArgs.olderThan === '2026-10-11T09:58:00.000Z' && w.listArgs.newerThan === '2026-10-11T09:20:00.000Z', w.listArgs);
    check('rows older than 14 days are cleaned up', w.purgedBefore === '2026-09-27T10:00:00.000Z' && r.purged === 3, w.purgedBefore);

    w = world([row('r1', '9000000001'), row('r2', '9000000001'), row('r3', '9000000001')]);
    r = await W.runWatchdog(w.io, now);
    check('three silent messages from ONE person → one apology, all three claimed (no repeats next minute)', w.sent.length === 1 && w.claimed.length === 3 && r.skippedRecent === 2, r);

    w = world([row('r1', '9000000001')], { recent: ['9000000001'] });
    r = await W.runWatchdog(w.io, now);
    check('they already got an apology in the last 10 min → no second one (but the row is claimed)', w.sent.length === 0 && w.claimed.length === 1 && r.skippedRecent === 1, r);

    w = world([row('r1', '9000000001'), row('r2', '9000000002')], { taken: ['r1'] });
    r = await W.runWatchdog(w.io, now);
    check('answered meanwhile / taken by another run → left alone', w.sent.length === 1 && w.sent[0].phone === '919000000002', w.sent);

    w = world([row('r1', '9000000001')], { sendFails: true });
    r = await W.runWatchdog(w.io, now);
    check('WhatsApp refusing the apology → counted as failed, no crash', r.sendFailed === 1 && r.apologised === 0, r);
    w = world([row('r1', '9000000001')], { sendThrows: true });
    r = await W.runWatchdog(w.io, now);
    check('the send crashing → counted as failed, no crash', r.sendFailed === 1, r);

    w = world([]);
    r = await W.runWatchdog(w.io, now);
    check('nothing overdue → nothing sent', r.checked === 0 && w.sent.length === 0);

    console.log('\n3. Apology right after a crash');
    w = world([]);
    check('crash → claimed and apologised at once', (await W.apologiseNow(w.io, 'm1', '919000000001')) === true && w.sent.length === 1);
    w = world([], { taken: ['m1'] });
    check('already answered or already apologised → no second message', (await W.apologiseNow(w.io, 'm1', '919000000001')) === false && w.sent.length === 0);
    check('no message id → nothing', (await W.apologiseNow(world([]).io, null, '919000000001')) === false);
    check('apology text is short, kind and points to "tasks"', /Sorry, I couldn't finish that/.test(W.APOLOGY_TEXT) && /tasks/.test(W.APOLOGY_TEXT) && W.APOLOGY_TEXT.length < 120);

    console.log('\n4. Wiring');
    const hook = read('app/api/webhooks/aisensy/route.ts');
    check('the webhook records the message BEFORE any Task Manager route runs', hook.indexOf('await recordInbound(') > 0 && hook.indexOf('await recordInbound(') < hook.indexOf('claimTaskImport(body)'));
    check('a route is only marked "expects a reply" when it really runs background work (repeat deliveries are not)',
        /if \(taskImport\.background\) \{\s*await markRoute\(input\?\.messageId, 'task_import'\);/.test(hook) && /if \(smartChat\.background\) \{\s*await markRoute\(input\?\.messageId, 'smart_chat'\);/.test(hook));
    check('the old task router is marked only when it handled the message', /if \(routeResult\.handledByTaskManager\) \{\s*await markRoute\(input\.messageId, 'task_router'\)/.test(hook));
    check('background crashes go to the immediate apology', /after\(guarded\(taskImport\.background\)\)/.test(hook) && /after\(guarded\(smartChat\.background\)\)/.test(hook) && /apologiseAfterCrash\(/.test(hook));
    const out = read('task-manager/TaskMessagingService.ts');
    check('every real or pretend send stamps "replied" (free text, template, Pretend Mode)', (out.match(/void markReplied\(/g) || []).length === 3);
    const cron = read('app/api/cron/whatsapp-watchdog/route.ts');
    check('the optional fast-schedule route needs CRON_SECRET', /Bearer \$\{secret\}/.test(cron) && /runBotHousekeeping\(\)/.test(cron));
    check('no every-minute cron (saves credits): the watchdog runs with the existing 15-minute Task Manager cron', !/whatsapp-watchdog/.test(read('vercel.json'))
        && /if \(action === 'auto' && !dryRun\) await runBotHousekeeping\(\);/.test(read('app/api/cron/task-manager/route.ts')));
    const wd = read('task-manager/NeverSilentWatchdog.ts');
    check('housekeeping checks each switch before doing anything', /if \(await neverSilentEnabled\(\)\)/.test(wd) && /if \(await memoryEnabled\(\)\)/.test(wd));
    const access = read('app/api/task-manager/access/route.ts');
    check('admins flip the switches from the Task Access panel (admin-guarded API), and the cache is reset', /action === 'set_bot_feature'/.test(access) && /resetBotSwitchCache\(\)/.test(access) && /requireTaskManagerAdmin/.test(access));
    check('switching memory OFF deletes all stored memories (privacy)', /body\.feature === 'conversationMemory' && !body\.enabled \? await clearAllMemory\(\)/.test(access));
    const sql = read('supabase/migrations/20261011000001_whatsapp_inbound_ledger.sql').split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    check('the migration is ADDITIVE, stores no message text, and is service-role only',
        /CREATE TABLE IF NOT EXISTS public\.whatsapp_inbound_ledger/.test(sql) && !/\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE|ALTER TABLE public\.(?!whatsapp_inbound_ledger))\b/i.test(sql)
        && !/\b(text_body|message_text|body)\b/i.test(sql) && /REVOKE ALL ON public\.whatsapp_inbound_ledger FROM anon, authenticated/.test(sql));
    check('the watchdog never re-runs a message (no task code is called from it)', !/WorkspaceService|TaskCommandHandler|runBrain|routeInboundMessage/.test(read('task-manager/NeverSilentWatchdog.ts')));

    delete process.env.WHATSAPP_NEVER_SILENT_ENABLED;
    console.log(failures === 0 ? '\n🎉 NEVER-SILENT TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
