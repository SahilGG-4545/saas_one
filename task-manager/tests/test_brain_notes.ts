/**
 * Owner 2026-10-20 — notes on tasks from the smart chat (100% OFFLINE: fake data, a scripted AI, a RECORDER in place of
 * WhatsApp and of the task functions; no network, no real database, no message can be sent from this file).
 *   - a new task with a note ("Onboarding - Satish") → saved as "Remark: Satish", shown as "(note: Satish)" in the preview
 *   - a note on a task that already exists: own task, or one the sender gave; the person's name is optional
 *   - a person's name only narrows WHOSE task it is (never a new task, never a hand-over)
 *   - two tasks fit → the bot asks which (showing whose), and the note survives the choice
 * Run: npx tsx task-manager/tests/test_brain_notes.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- stubs replace services and DTOs on purpose (same as the other brain tests) */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };

    const L = await import('../brain/live');
    const { world } = await import('../brain/eval/worlds');
    const { tasksDomain } = await import('../brain/tasksDomain');

    const PHONE = '918433649199';
    const emp = { id: 'u1', name: 'Priyanka Shah', department_id: 'd1', department_name: 'Procurement', role: 'employee' } as any;
    const body = (text: string, id: string) => ({ topic: 'message.sender.user', data: { messages: [{ phone_number: PHONE, id, message_type: 'text', text: { body: text } }] } });

    // Tasks Priyanka GAVE other people (two people both have an "Onboarding").
    const GIVEN = [
        { id: 'g1', title: 'Onboarding', ownerId: 'u2', ownerName: 'Vidya Nair', date: '2026-10-07' },
        { id: 'g2', title: 'Onboarding', ownerId: 'u6', ownerName: 'Dipti Rao', date: '2026-10-08' },
        { id: 'g3', title: 'Vendor follow-up', ownerId: 'u5', ownerName: 'Suraj Verma', date: '2026-10-08' },
    ];

    // ── a scripted AI: answers like the real one should, for exactly the messages below ────────────
    const mkI = (intent: string, slots: any, summary: string) => ({ intent, slots, summary });
    const note = (hints: string[], person: string | null, text: string | null, numbers: number[] = []) =>
        mkI('add_note', { which: { all: false, numbers, hints }, person, note: text }, 'Add a note to a task');
    const interps = (msg: string): any => {
        const m = msg.toLowerCase(), has = (s: string) => m.includes(s);
        if (has('specifically') && has('vidya')) return note(['onboarding'], 'Vidya', 'documents pending');
        if (m.trim() === '1') return mkI('answer_pending', { answer: 'pick', pick: 1, instruction: null }, 'The first one');
        if (m.trim() === 'yes') return mkI('answer_pending', { answer: 'yes', pick: null, instruction: null }, 'Yes');
        if (has('give vidya onboarding - satish')) return mkI('create_tasks', { assignee: 'Vidya', tasks: [{ title: 'Onboarding', details: 'Satish' }], date: null }, 'Give Vidya onboarding');
        if (has("vidya's onboarding")) return note(['onboarding'], 'Vidya', 'documents pending');
        if (has("harsh's onboarding")) return note(['onboarding'], 'Harsh', 'documents pending');
        if (has('note to onboarding: documents pending')) return note(['onboarding'], null, 'documents pending');
        if (has('vendor follow-up')) return note(['vendor follow-up'], null, 'call before 3pm');
        if (has('task 1')) return note([], null, 'waiting for quote', [1]);
        if (has('invented')) return note(['onboarding'], 'Vidya', 'the client wants a refund by Monday');
        if (has('add a note to onboarding')) return note(['onboarding'], 'Vidya', null);
        return mkI('smalltalk', {}, 'Said hello');
    };
    const replyFor = (u: any) => {
        const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join(' ');
        return u.mustEndWithQuestion ? `Quick check, is this right? ${need}` : `Okay, here you go: ${need}`;
    };

    const mk = () => {
        const w: any = { state: null as null | { type: string; data: any }, sent: [] as string[], exec: [] as any[], seen: new Set<string>(), prompts: [] as any[] };
        const llm = { complete: async (req: any) => {
            const u = JSON.parse(req.user);
            if (/Reply with JSON only: \{"text"/.test(req.system)) return { text: JSON.stringify({ text: replyFor(u) }), tokensIn: 5, tokensOut: 5 };
            w.prompts.push(u);
            return { text: JSON.stringify({ confidence: 0.95, language: 'en', ambiguities: [], clarify_question: null, ...interps(u.message) }), tokensIn: 10, tokensOut: 8 };
        } };
        w.io = {
            getSmartChatDepartments: async () => new Set(['d1']), getConfig: async () => ({ enabled: false, employees: [] }), getEmployee: async () => emp, checkAccess: async () => ({ allowed: true }),
            facilityActive: async () => false,
            getState: async () => w.state,
            setState: async (_p: string, s: any) => { w.state = { type: L.LIVE_STATE_TYPE, data: JSON.parse(JSON.stringify(s)) }; },
            clearState: async () => { w.state = null; },
            buildContext: async (_e: any, _p: string, opts: any) => ({ ...world('default'), pending: opts.pending, recent: opts.recent, noteTargets: GIVEN }),
            brain: { llm },
            exec: {
                setStatus: async () => undefined,
                assign: async (a: string, i: any) => { w.exec.push(['assign', a, i.targetUserId, i.title, i.description]); },
                handOver: async () => { w.exec.push(['handover']); return { toName: 'x' }; },
                addNote: async (a: string, taskId: string, text: string) => { w.exec.push(['note', a, taskId, text]); },
                readPerson: async () => '', readInsight: async () => '',
            },
            reply: async (_p: string, t: string) => { w.sent.push(t); },
            audit: async () => undefined,
            seenBefore: (id: string) => w.seen.has(id), markSeen: (id: string) => { w.seen.add(id); },
        };
        return w;
    };
    let n = 0;
    const turn = async (w: any, text: string) => {
        const claim = await L.claimSmartChat(body(text, `m${++n}`), w.io);
        if (claim.background) await claim.background();
        return claim;
    };
    const last = (w: any) => w.sent[w.sent.length - 1] || '';

    console.log('\n1. A new task with a note');
    let w = mk();
    await turn(w, 'give vidya onboarding - satish');
    check('the preview shows the note next to the task, nothing saved yet', /Onboarding \(note: Satish\)/.test(last(w)) && w.exec.length === 0, w.sent);
    await turn(w, 'yes');
    check('yes → saved for Vidya with the note as "Remark: Satish"', JSON.stringify(w.exec) === JSON.stringify([['assign', 'u1', 'u2', 'Onboarding', 'Remark: Satish']]), w.exec);
    const spec = tasksDomain.intents.find(s => s.name === 'create_tasks')!;
    check('the AI is told a dash alone is NOT a note (keep it in the title when unsure)', /A dash alone does NOT mean a detail/.test(spec.slots) && /When unsure, keep it all in the title/.test(spec.slots));

    console.log('\n2. A note on a task given to someone, naming the person');
    w = mk();
    await turn(w, "add note to vidya's onboarding: documents pending");
    check('preview: Vidya\'s Onboarding with the note, nothing saved yet', /Onboarding/.test(last(w)) && w.state?.data.action?.type === 'add_note' && w.state.data.action.taskId === 'g1' && w.exec.length === 0, { sent: last(w), action: w.state?.data.action });
    check('naming Vidya did NOT create a task or hand anything over', w.state?.data.action?.type === 'add_note');
    await turn(w, 'yes');
    check('yes → the note is added to Vidya\'s task only', JSON.stringify(w.exec) === JSON.stringify([['note', 'u1', 'g1', 'documents pending']]), w.exec);

    console.log('\n3. No name, two people have "Onboarding" → the bot asks which');
    w = mk();
    await turn(w, 'add note to onboarding: documents pending');
    check('asks which one, showing whose task each is; nothing saved', w.state?.data.pending?.kind === 'pick' && w.state.data.pickOptions.some((o: string) => /Vidya Nair/.test(o)) && w.state.data.pickOptions.some((o: string) => /Dipti Rao/.test(o)) && w.exec.length === 0, w.state?.data);
    check('the person\'s own words are kept (so the note survives the choice)', /documents pending/.test(w.state?.data.originalSummary || ''), w.state?.data.originalSummary);
    await turn(w, '1');
    check('"1" → the note goes to the first one (Vidya), asked to confirm', w.state?.data.action?.type === 'add_note' && w.state.data.action.taskId === 'g1' && w.state.data.action.note === 'documents pending', w.state?.data.action);
    await turn(w, 'yes');
    check('yes → saved on Vidya\'s task', JSON.stringify(w.exec) === JSON.stringify([['note', 'u1', 'g1', 'documents pending']]), w.exec);

    console.log('\n4. No name, only one task fits → no question');
    w = mk();
    await turn(w, 'add note to vendor follow-up: call before 3pm');
    check('goes straight to the preview for Suraj\'s task', w.state?.data.action?.type === 'add_note' && w.state.data.action.taskId === 'g3' && w.state.data.action.ownerName === 'Suraj Verma', w.state?.data.action);

    console.log('\n5. A note on their own task, by number');
    w = mk();
    await turn(w, 'add note to task 1: waiting for quote');
    check('task 1 of their own list, marked as theirs', w.state?.data.action?.type === 'add_note' && w.state.data.action.taskId === 't1' && w.state.data.action.ownerName === null, w.state?.data.action);

    console.log('\n6. Safety');
    w = mk();
    await turn(w, "add note to harsh's onboarding: documents pending");
    check('a person they gave no such task → asks, never adds it elsewhere', !w.state?.data.action && w.exec.length === 0 && w.state?.data.lastOutcome === 'CLARIFY', w.state?.data);
    w = mk();
    await turn(w, 'add the invented note please');
    check('a note that is not in the message → not saved, asks again', !w.state?.data.action && w.exec.length === 0, w.state?.data);
    w = mk();
    await turn(w, 'add a note to onboarding');
    const d: any = tasksDomain.decide({ intent: 'add_note', confidence: 0.95, language: 'en', ambiguities: [], clarifyQuestion: null, summary: '', grounded: true,
        slots: { intent: 'add_note', which: { all: false, numbers: [], hints: ['onboarding'] }, person: 'Vidya', note: null } } as any, { ...world('default'), noteTargets: GIVEN } as any, { confirmProgressUpdates: false });
    check('no note given → asks what it should say, nothing saved', !w.state?.data.action && w.exec.length === 0 && d.outcome === 'CLARIFY' && d.reason === 'no_task_content' && d.detail === 'note', d);

    check('\nnothing in this test touched the network', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 NOTES (SMART CHAT) TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
