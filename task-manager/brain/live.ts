import type { AccessDecision } from '../TaskAccessService';
import { decideImportEligibility, extractCandidate } from '../TaskImportInbound';
import type { Employee, TestingConfig } from '../types';
import type { ExecutionResult } from './domain';
import { ExecIO, executeAction, needsExecution } from './execute';
import { BrainDeps, BrainResult, composeBrainReply, runBrain } from './index';
import { shadowDetails } from './shadow';
import { clip } from './text';
import type { Action, BrainContext, PendingState } from './types';
import { AI_DOWN_HELP, ExactPlan, LastChange, UNDO_HINT, UndoIO, changeFromAction, normalizeChange, parseExactCommand, planExact, runUndo } from './frontDoor';
import { isExplicitTaskCommand } from '@/backend/lib/whatsapp/interpreter/coordinator.mjs';

/**
 * The language brain — Phase 4: SMART CHAT, live.
 *
 * For people in a department with Smart chat ON (and, while the sandbox is ON, a sandbox number), the brain answers their plain-
 * language messages. Everything not covered falls back to the OLD bot untouched:
 *   • a room / ticket message, or one while a facility conversation is open  → old facility assistant
 *   • the AI being unavailable                                               → old keyword bot
 *   • an older conversation (import preview, old "confirm?") still open       → that old flow finishes first
 *
 * Quick part (during the webhook): decide. Slow part (after the webhook answered): carry out, write the reply, remember.
 * Every change is carried out by the existing task functions, which enforce permissions again.
 * What is remembered is a short-lived summary — the brain's own words and what it understood, never the person's original words.
 */

export const LIVE_STATE_TYPE = 'BRAIN_STATE';
const STATE_TTL_MIN = 15;

export interface LiveState {
    /** Short memory of the last turns (interpretation + the bot's own replies), newest last. */
    recent: string[];
    pending: PendingState | null;
    /** The change that was proposed and is waiting for a yes (only for a pending confirmation). */
    action: Action | null;
    /** One-line summary of the original request, used to resume after a pick or a change of mind. */
    originalSummary: string | null;
    pickOptions: string[];
    /** This conversation is a reply to someone's request (a reminder sent to a superuser): tell the people who gave those tasks. */
    relay: boolean;
    /** Titles of the tasks in that request (they are not on the person's own list). */
    titles: Record<string, string>;
    /** Phase 3 "One front door": the person's last change, so "undo" can reverse it within 10 minutes. */
    lastChange?: LastChange | null;
}

const EMPTY: LiveState = { recent: [], pending: null, action: null, originalSummary: null, pickOptions: [], relay: false, titles: {} };

export function normalizeState(data: any): LiveState {
    if (!data || typeof data !== 'object') return { ...EMPTY };
    return {
        recent: Array.isArray(data.recent) ? data.recent.filter((s: unknown) => typeof s === 'string').slice(-4) : [],
        pending: data.pending && typeof data.pending === 'object' && ['confirm', 'pick', 'preview', 'ping_reply'].includes(data.pending.kind) ? data.pending : null,
        action: data.action && typeof data.action === 'object' && typeof data.action.type === 'string' ? data.action : null,
        originalSummary: typeof data.originalSummary === 'string' ? data.originalSummary : null,
        pickOptions: Array.isArray(data.pickOptions) ? data.pickOptions.filter((s: unknown) => typeof s === 'string') : [],
        relay: data.relay === true,
        titles: data.titles && typeof data.titles === 'object' && !Array.isArray(data.titles) ? Object.fromEntries(Object.entries(data.titles).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {},
        ...(normalizeChange(data.lastChange) ? { lastChange: normalizeChange(data.lastChange) } : {}),
    };
}

/** Keep the person's last change for "undo" when the state is rewritten (only while the front door is on). */
const carry = (state: LiveState, change: LastChange | null | undefined): Partial<LiveState> =>
    (change ?? state.lastChange) ? { lastChange: change ?? state.lastChange } : {};

const remember = (recent: string[], understood: string, said: string | null): string[] =>
    [...recent, `Person: ${clip(understood, 200)}`, ...(said ? [`Assistant: ${clip(said, 200)}`] : [])].slice(-4);

export interface LiveIO {
    getSmartChatDepartments(): Promise<ReadonlySet<string>>;
    getConfig(): Promise<TestingConfig>;
    getEmployee(phone: string): Promise<Employee | null>;
    checkAccess(employee: Employee): Promise<AccessDecision>;
    facilityActive(phone: string): Promise<boolean>;
    getState(phone: string): Promise<{ type: string; data: any } | null>;
    setState(phone: string, state: LiveState): Promise<void>;
    clearState(phone: string): Promise<void>;
    /** For a superuser: the reminders sent to them that are still waiting for a reply (null when none). */
    openPingPending(employee: Employee): Promise<{ pending: PendingState; titles: Record<string, string> } | null>;
    buildContext(employee: Employee, phone: string, opts: { pending: PendingState | null; recent: string[]; conversation?: string[] }): Promise<BrainContext>;
    /** Phase 2 conversation memory: the chat's last messages, oldest first ([] while the switch is OFF). */
    readConversation?(phone: string): Promise<string[]>;
    /** Phase 3: the "One front door" switch (Task Access panel). Absent / false = exactly the old behaviour. */
    frontDoorOn?(): Promise<boolean>;
    /** Phase 3: reversing a change for "undo" (the same permission-checked functions as the Tasks tab). */
    undo?: UndoIO;
    brain: BrainDeps;
    exec: ExecIO;
    /** One WhatsApp message through the safety gate (kill switches, Pretend Mode). */
    reply(phone: string, text: string): Promise<void>;
    audit(details: Record<string, unknown>, employee: Employee): Promise<void>;
    seenBefore(messageId: string): boolean;
    markSeen(messageId: string): void;
}

export interface LiveClaim { handled: boolean; background?: () => Promise<void> }
const NOT_HANDLED: LiveClaim = { handled: false };

/** Optional, for callers that feed the brain text from elsewhere (a voice note). Absent = exactly the old behaviour. */
export interface LiveOptions {
    /** Shown above every reply of this turn (e.g. 🎙️ I heard: "…"). Not remembered in the brain's short memory. */
    replyPrefix?: string;
    /** Where the text came from, recorded in the audit row (e.g. 'voice'). */
    via?: string;
}

/**
 * Called first for every text message. Not ours → { handled:false } and the old bot answers exactly as before.
 * Ours → the decision is already made; the caller runs `background` AFTER answering the webhook.
 */
export async function claimSmartChat(body: unknown, io?: LiveIO, opts: LiveOptions = {}): Promise<LiveClaim> {
    let cand: ReturnType<typeof extractCandidate>;
    try { cand = extractCandidate(body); } catch { return NOT_HANDLED; }
    if (!cand || cand.mediaClass !== 'text' || !cand.text.trim()) return NOT_HANDLED;

    try {
        const real = io ?? await defaultLiveIO();
        // One small read first: while no department has Smart chat ON (the default) nothing else is read.
        const departments = await real.getSmartChatDepartments();
        if (departments.size === 0) return NOT_HANDLED;
        const employee = await real.getEmployee(cand.phone);
        if (!employee?.department_id || !departments.has(employee.department_id)) return NOT_HANDLED;
        const access = await real.checkAccess(employee);
        const config = await real.getConfig();
        // Same people as the Task Manager itself, in a department with the switch ON, inside the sandbox while it is ON.
        if (!decideImportEligibility(config, cand.phone, employee, access, departments).ok) return NOT_HANDLED;

        const row = await real.getState(cand.phone);
        if (row && row.type !== LIVE_STATE_TYPE) return NOT_HANDLED;      // an older conversation is still open: let it finish
        if (await real.facilityActive(cand.phone)) return NOT_HANDLED;    // a room / ticket conversation is open
        if (cand.messageId && real.seenBefore(cand.messageId)) return { handled: true }; // repeat delivery of one we already took

        const state = normalizeState(row?.data);
        // A superuser with a reminder waiting for a reply: their "working on it" / "done" answers THAT request.
        let pending = state.pending; let titles: Record<string, string> = state.titles;
        if (!pending && employee.role === 'superuser') {
            const waiting = await real.openPingPending(employee);
            if (waiting) { pending = waiting.pending; titles = waiting.titles; }
        }
        // Read BEFORE this message is stored, so the transcript holds only EARLIER messages (the new one is "message").
        const conversation = real.readConversation ? await real.readConversation(cand.phone).catch(() => [] as string[]) : [];
        const ctx = await real.buildContext(employee, cand.phone, { pending, recent: state.recent, ...(conversation.length ? { conversation } : {}) });
        const started = Date.now();
        const phone0 = cand.phone, messageId0 = cand.messageId;

        // Phase 3 "One front door" (switch OFF → skipped entirely): exact commands are answered by code, no AI call.
        const frontDoor = real.frontDoorOn ? await real.frontDoorOn().catch(() => false) : false;
        if (frontDoor && !ctx.pending) {
            const cmd = parseExactCommand(cand.text);
            const plan = cmd ? planExact(cmd, ctx) : null;
            if (plan) {
                if (messageId0) real.markSeen(messageId0);
                return { handled: true, background: () => respondExact({ io: real, employee, phone: phone0, messageId: messageId0, text: cand!.text, ctx, state, plan, started, opts }) };
            }
        }

        const result = await runBrain(cand.text, ctx, { ...real.brain, skipReply: true });
        if (result.status !== 'ok' || !result.decision || !result.interpretation) {
            // AI down. Front door ON: old exact commands still go to the old bot; anything else gets one short help line (no menu).
            if (!frontDoor || isExplicitTaskCommand(cand.text)) return NOT_HANDLED;
            if (messageId0) real.markSeen(messageId0);
            return { handled: true, background: async () => { try { await real.reply(phone0, prefixedText(opts, AI_DOWN_HELP)); } catch { /* the watchdog covers silence */ } } };
        }
        if (result.decision.outcome === 'HANDOFF') return NOT_HANDLED;                                 // rooms / tickets → facility assistant

        if (cand.messageId) real.markSeen(cand.messageId);
        const phone = cand.phone, text = cand.text, messageId = cand.messageId;
        return { handled: true, background: () => respond({ io: real, employee, phone, text, messageId, ctx, result, state, depth: 0, started, relay: ctx.pending?.kind === 'ping_reply', titles, opts, frontDoor }) };
    } catch (err) {
        console.warn('[TaskBrainLive] not handled, the old bot answers instead:', err instanceof Error ? err.message : err);
        return NOT_HANDLED;
    }
}

interface Turn {
    io: LiveIO; employee: Employee; phone: string; text: string; messageId: string | null | undefined;
    ctx: BrainContext; result: BrainResult; state: LiveState; depth: number; started: number;
    /** The message is a reply to a request: tell the people who gave those tasks. */
    relay: boolean; titles: Record<string, string>;
    opts?: LiveOptions;
    /** Phase 3: remember executed changes so "undo" can reverse them (only while the front door is on). */
    frontDoor?: boolean;
}

const prefixedText = (opts: LiveOptions | undefined, text: string): string => (opts?.replyPrefix ? `${opts.replyPrefix}\n\n${text}` : text);
const prefixed = (t: Turn, text: string): string => prefixedText(t.opts, text);

/**
 * Phase 3: carry out an exact command ("done 2", "done all", "tasks", "undo") — no AI call. Never throws: a problem becomes
 * one honest apology. The change goes through the same permission-checked functions; "done" is remembered for "undo".
 */
async function respondExact(t: {
    io: LiveIO; employee: Employee; phone: string; messageId: string | null | undefined; text: string;
    ctx: BrainContext; state: LiveState; plan: ExactPlan; started: number; opts?: LiveOptions;
}): Promise<void> {
    const { io, employee, phone, ctx, state, plan } = t;
    try {
        let reply: string; let next: LiveState; let kind: string; let executed: string | null = null;
        if (plan.kind === 'act') {
            const change = changeFromAction(plan.action, ctx);
            const exec = await executeAction(plan.action, ctx, io.exec);
            executed = exec?.summary ?? null;
            reply = [exec?.summary, exec?.values?.details, change ? UNDO_HINT : null].filter(Boolean).join('\n\n') || 'Done.';
            next = { ...EMPTY, recent: state.recent, ...carry(state, change) };
            kind = plan.action.type;
        } else if (plan.kind === 'undo') {
            const r = io.undo ? await runUndo(state.lastChange ?? null, employee.id, io.undo) : { text: "There's nothing to undo right now.", undone: 0 };
            reply = r.text; executed = r.undone ? `Undid ${r.undone}` : null;
            next = { ...EMPTY, recent: state.recent, lastChange: null };   // an undo is used up, whatever happened
            kind = 'undo';
        } else {
            reply = plan.text;
            next = { ...state };
            kind = 'view';
        }
        await io.setState(phone, { ...next, recent: remember(next.recent, `exact command: ${clip(t.text, 40)}`, reply) });
        await io.reply(phone, prefixedText(t.opts, reply));
        await io.audit({ phoneMasked: phone.replace(/\d(?=\d{4})/g, '•'), messageId: t.messageId ?? null, live: true, exact: kind, executed, ms: Date.now() - t.started, ...(t.opts?.via ? { via: t.opts.via } : {}) }, employee);
    } catch (err) {
        console.warn('[TaskBrainLive] exact command failed:', err instanceof Error ? err.message : err);
        try { await io.reply(phone, 'Sorry, something went wrong on my side. Please try that again in a moment.'); } catch { /* nothing more to do */ }
    }
}

/** The slow part. Never throws: a problem becomes one honest apology. */
async function respond(t: Turn): Promise<void> {
    try {
        await handle(t);
    } catch (err) {
        console.warn('[TaskBrainLive] failed while answering:', err instanceof Error ? err.message : err);
        try { await t.io.reply(t.phone, 'Sorry, something went wrong on my side. Please try that again in a moment.'); } catch { /* nothing more to do */ }
    }
}

const GENERIC_LOST = 'Sorry, I lost track of what we were doing. What would you like to do?';

async function handle(t: Turn): Promise<void> {
    const { io, employee, phone, ctx } = t;
    const interp = t.result.interpretation!;
    const decision = t.result.decision!;

    const say = async (result: BrainResult, exec: ExecutionResult | null, next: LiveState | 'clear', extra: Record<string, unknown> = {}) => {
        const reply = await composeBrainReply({ text: t.text, ctx, interpretation: result.interpretation!, decision: result.decision!, deps: io.brain, result: exec ?? undefined });
        if (next === 'clear') await io.clearState(phone);
        else await io.setState(phone, { ...next, recent: remember(t.state.recent, result.interpretation!.summary || 'a message', reply?.text ?? null) });
        if (reply) await io.reply(phone, prefixed(t, reply.text));
        await io.audit({ ...shadowDetails({ phone, messageId: t.messageId, messageChars: t.text.length, result: { ...result, reply }, ms: Date.now() - t.started }), live: true, executed: exec?.summary ?? null, ...(t.opts?.via ? { via: t.opts.via } : {}), ...extra }, employee);
    };

    // ── an answer to a question the bot asked ───────────────────────────────
    if (decision.outcome === 'ACT' && decision.action.type === 'answer_pending') {
        const a = decision.action;
        if (a.answer === 'no') return say(t.result, null, 'clear');
        if (a.answer === 'yes' && t.state.action) {
            const change = t.frontDoor ? changeFromAction(t.state.action, ctx) : null;   // read BEFORE it changes
            const exec = await executeAction(t.state.action, ctx, io.exec, { relay: t.state.relay, titles: t.state.titles });
            return say(t.result, exec, { ...EMPTY, recent: t.state.recent, ...(t.frontDoor ? carry(t.state, change) : {}) }, { confirmedAction: t.state.action.type });
        }
        if ((a.answer === 'pick' || a.answer === 'edit') && t.depth === 0 && t.state.originalSummary) {
            const label = a.answer === 'pick' ? t.state.pickOptions[(a.pick ?? 0) - 1] : null;
            if (a.answer === 'edit' || label) {
                // Resume with the original request plus the person's choice or change — the brain then proposes the new version.
                const message = a.answer === 'pick' ? `${t.state.originalSummary}. Specifically: ${label}` : `${t.state.originalSummary}. Change of mind: ${a.instruction}`;
                const waiting = t.state.relay ? await io.openPingPending(employee) : null;
                const ctx2: BrainContext = { ...ctx, pending: waiting?.pending ?? null };
                const again = await runBrain(message, ctx2, { ...io.brain, skipReply: true });
                if (again.status === 'ok' && again.decision && again.interpretation && again.decision.outcome !== 'HANDOFF') {
                    return handle({ ...t, text: message, ctx: ctx2, result: again, state: { ...t.state, pending: null, action: null, pickOptions: [] }, depth: 1, relay: !!waiting, titles: waiting?.titles ?? {} });
                }
            }
        }
        await io.clearState(phone);
        await io.reply(phone, prefixed(t, GENERIC_LOST));
        return;
    }

    // ── everything else: carry out if it is a read / a note, then reply and remember ────
    let exec: ExecutionResult | null = null;
    let change: LastChange | null = null;
    if (decision.outcome === 'ACT' && needsExecution(decision.action)) {
        if (t.frontDoor) change = changeFromAction(decision.action, ctx);              // read BEFORE it changes
        exec = await executeAction(decision.action, ctx, io.exec, { relay: t.relay, titles: t.titles });
    }

    const next: LiveState = { ...EMPTY, recent: t.state.recent, ...(t.frontDoor ? carry(t.state, change) : {}) };
    if (decision.outcome === 'CONFIRM') {
        next.pending = { kind: 'confirm', summary: interp.summary || 'a change to your tasks' };
        next.action = decision.action;
        next.originalSummary = interp.summary || null;
        next.relay = t.relay; next.titles = t.relay ? t.titles : {};
    } else if (decision.outcome === 'CLARIFY' && decision.options.length && (decision.reason === 'several_people_match' || decision.reason === 'several_tasks_match')) {
        next.pending = { kind: 'pick', options: decision.options };
        next.pickOptions = decision.options;
        next.originalSummary = interp.summary || null;
        next.relay = t.relay; next.titles = t.relay ? t.titles : {};
    }
    return say(t.result, exec, next);
}

// ── the real wiring (loaded lazily so tests never touch the database) ───────

const seen = new Map<string, number>();
const SEEN_TTL_MS = 15 * 60 * 1000;

export async function defaultLiveIO(): Promise<LiveIO> {
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { TaskMessagingService } = await import('../TaskMessagingService');
    const { WorkspaceService, todayIST } = await import('../WorkspaceService');
    const { PermissionService } = await import('../PermissionService');
    const { SuperuserInsights } = await import('../SuperuserInsights');
    const { getConversationRoutingState } = await import('@/backend/lib/whatsapp/interpreter/context');
    const { buildBrainContext } = await import('./context');
    const { engyBrainLlm } = await import('./llm');
    const { SuperuserPingService } = await import('../SuperuserPingService');
    const { defaultRelayIO, relayToAssigners } = await import('./relay');
    const { readTranscript } = await import('../ConversationMemory');
    const { botSwitchOn } = await import('../BotSwitches');
    const llm = engyBrainLlm();
    const relayIO = await defaultRelayIO();

    const STATUS: Record<string, string> = { pending: 'To do', in_progress: 'In progress', completed: 'Done' };

    const exec: ExecIO = {
        async setStatus(actorId, taskId, status) { await WorkspaceService.setStatus(actorId, { taskId, status }); },
        async assign(actorId, i) { await WorkspaceService.assign(actorId, { targetUserId: i.targetUserId, title: i.title, description: i.description, date: i.date, notify: i.notify }); },
        async alertAssigned(actorId, targetUserId, titles, date) { await WorkspaceService.alertAssigned(actorId, targetUserId, titles, date); },
        async handOver(actorId, taskId, toId) { const r = await WorkspaceService.handOver(actorId, { taskId, targetUserId: toId }); return { toName: r.toName }; },
        async readPerson(actorId, personId) {
            const [actor, target] = await Promise.all([TaskDatabaseService.getEmployeeById(actorId), TaskDatabaseService.getEmployeeById(personId)]);
            if (!actor || !target) return null;
            const allowed = actor.role === 'superuser' || target.id === actor.id || (await PermissionService.visibleAndAssignable(actor, [target])).length === 1;
            if (!allowed) return null;
            const rows = await TaskDatabaseService.getDailyAssignments({ employeeId: personId, date: todayIST() });
            return rows.length ? rows.map((r, i) => `${i + 1}. ${r.title} (${STATUS[r.status] ?? r.status})`).join('\n') : 'No tasks today.';
        },
        async readInsight(actorId, kind, subject) {
            const actor = await TaskDatabaseService.getEmployeeById(actorId);
            if (!actor || actor.role !== 'superuser') throw new Error('Company-wide questions are only available to superusers.');
            const r = await SuperuserInsights.run({ actor, decision: { kind, subject } });
            return r.kind === 'reply' ? r.text : r.prompt;
        },
        async relay(actorId, input) {
            const actor = await relayIO.getPerson(actorId);
            return actor ? relayToAssigners({ actor, ...input }, relayIO) : { told: [], couldNot: [] };
        },
    };

    return {
        getSmartChatDepartments: async () => (await TaskAccessService.getSmartChatDepartments()).departments,
        getConfig: () => TaskDatabaseService.getTestingConfig(),
        getEmployee: phone => TaskDatabaseService.getEmployeeByPhone(phone),
        checkAccess: e => TaskAccessService.check({ userId: e.id, departmentId: e.department_id }),
        facilityActive: async phone => (await getConversationRoutingState(phone)).facilityActive,
        async getState(phone) {
            const c = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
            return c ? { type: c.context_type, data: c.context_data } : null;
        },
        async setState(phone, state) {
            await TaskDatabaseService.setConversationContext({ phone, system: 'TASK_MANAGER', contextType: LIVE_STATE_TYPE, contextData: state as unknown as Record<string, any>, ttlMinutes: STATE_TTL_MIN });
        },
        async clearState(phone) {
            // Only ever clear OUR state, never another conversation's.
            const c = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
            if (c && c.context_type === LIVE_STATE_TYPE) await TaskDatabaseService.clearConversationContext(phone, 'TASK_MANAGER');
        },
        async openPingPending(e) {
            const tasks = await SuperuserPingService.openPingTasksFor(e.id);
            if (!tasks.length) return null;
            const assigners = [...new Set(tasks.map(x => x.assignerName))];
            const many = assigners.length > 1;
            const titles = Object.fromEntries(tasks.map(x => [x.id, many ? `${x.title} (from ${x.assignerName})` : x.title]));
            return { pending: { kind: 'ping_reply', assigner: assigners.join(' and '), taskIds: tasks.map(x => x.id), taskTitles: tasks.map(x => titles[x.id]), assigners: many ? assigners : undefined }, titles };
        },
        buildContext: (e, phone, opts) => buildBrainContext(e, phone, opts),
        readConversation: phone => readTranscript(phone),
        frontDoorOn: () => botSwitchOn('frontDoor'),
        undo: {
            currentStatus: taskId => WorkspaceService.taskStatus(taskId),
            async setStatus(actorId, taskId, status) { await WorkspaceService.setStatus(actorId, { taskId, status }); },
            findCreated: (actorId, assigneeId, title, date, since) => WorkspaceService.findRecentlyCreated(actorId, assigneeId, title, date, since),
            async deleteTask(actorId, taskId) { await WorkspaceService.deleteTask(actorId, { taskId }); },
        },
        brain: { llm },
        exec,
        async reply(phone, text) { await TaskMessagingService.sendFreeformReply(phone, text); },
        async audit(details, employee) { await TaskDatabaseService.logAudit({ eventType: 'brain_live', actorId: employee.id, details }); },
        seenBefore: id => { const t = seen.get(id); return !!t && Date.now() - t < SEEN_TTL_MS; },
        markSeen: id => {
            const now = Date.now();
            seen.set(id, now);
            if (seen.size > 1000) seen.forEach((ts, k) => { if (now - ts > SEEN_TTL_MS) seen.delete(k); });
        },
    };
}
