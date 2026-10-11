import { TaskMessagingService } from './TaskMessagingService';

/**
 * Event alerts (a task was assigned / handed over / finished / a superuser replied), sent ONLY as Meta-approved templates.
 * Free text is rejected by WhatsApp for anyone who has not messaged in the last 24 hours ("Re-engagement message"), and that
 * rejection arrives after AiSensy has already said OK, so a free-text-first send silently fails. Kill switches and Pretend
 * Mode still apply (everything goes through TaskMessagingService.sendMessage).
 *
 *   task_assigned_v1  Task: {{1}} · Assigned by: {{2}} · Date: {{3}}   (+ a "tasks" quick-reply button)
 *   task_update_v2    Task: {{1}} · Assigned to: {{2}} · Update: {{3}}
 */

export const ASSIGNED_CAMPAIGN = process.env.AISENSY_TASK_ASSIGNED_CAMPAIGN || 'task_assigned_v1';
export const UPDATE_CAMPAIGN = process.env.AISENSY_TASK_UPDATE_CAMPAIGN || 'task_update_v2';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One line: Meta rejects line breaks, tabs and long runs of spaces inside a template variable. */
export const oneLine = (s: unknown, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** "Priyanka (Procurement)", or just the name. */
export const personLabel = (name: string, department?: string | null) =>
    oneLine(department ? `${name} (${department})` : name, 100);

/** 2026-10-11 → "11 Oct 2026". Anything else is passed through. */
export function formatDate(date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : oneLine(date, 30);
}

/** One task → its title. Several → "1. A | 2. B", cut with "…and N more" to stay short. */
export function taskList(titles: string[], max = 600): string {
    const clean = titles.map(t => oneLine(t, 120)).filter(Boolean);
    if (clean.length <= 1) return clean[0] || 'a task';
    let out = '';
    for (let i = 0; i < clean.length; i++) {
        const next = out ? `${out} | ${i + 1}. ${clean[i]}` : `1. ${clean[i]}`;
        if (next.length > max) return `${out} | …and ${clean.length - i} more`;
        out = next;
    }
    return out;
}

export function assignedParams(titles: string[], fromLabel: string, date: string): [string, string, string] {
    return [taskList(titles), oneLine(fromLabel, 100) || 'Your team', formatDate(date)];
}

export function updateParams(titles: string[], assigneeLabel: string, update: string): [string, string, string] {
    return [taskList(titles), oneLine(assigneeLabel, 100) || 'Someone', oneLine(update, 400) || 'Updated'];
}

/** What the person receives, filled in (used as the Pretend-Mode preview and in logs). */
export function assignedPreview(p: [string, string, string]): string {
    return `🔔 A new task has been assigned to you.\n\nTask: ${p[0]}\nAssigned by: ${p[1]}\nDate: ${p[2]}\n\nReply "tasks" to see your list and mark it done.`;
}

export function updatePreview(p: [string, string, string]): string {
    return `📌 Update regarding a task you assigned.\n\nTask: ${p[0]}\nAssigned to: ${p[1]}\nUpdate: ${p[2]}\nPlease review this update for your records.`;
}

const validPhone = (phone?: string | null): phone is string => !!phone && phone.trim().length >= 10;

/** "A new task has been assigned to you" — one message even for several tasks. Never throws. */
export async function sendTaskAssigned(phone: string | null | undefined, input: { titles: string[]; fromLabel: string; date: string; messageType?: string; departmentId?: string }): Promise<boolean> {
    if (!validPhone(phone) || input.titles.length === 0) return false;
    const params = assignedParams(input.titles, input.fromLabel, input.date);
    try {
        return await TaskMessagingService.sendMessage(phone, assignedPreview(params), {
            messageType: input.messageType || 'task_assigned', departmentId: input.departmentId,
            campaignName: ASSIGNED_CAMPAIGN, templateParams: params, templateOnly: true,
        });
    } catch (err) {
        console.error('[taskAlerts] Failed to send task-assigned alert:', err instanceof Error ? err.message : err);
        return false;
    }
}

/** "Update regarding a task you assigned" — to the person who GAVE the task(s). Never throws. */
export async function sendTaskUpdate(phone: string | null | undefined, input: { titles: string[]; assigneeLabel: string; update: string; messageType?: string; departmentId?: string }): Promise<boolean> {
    if (!validPhone(phone) || input.titles.length === 0) return false;
    const params = updateParams(input.titles, input.assigneeLabel, input.update);
    try {
        return await TaskMessagingService.sendMessage(phone, updatePreview(params), {
            messageType: input.messageType || 'task_update', departmentId: input.departmentId,
            campaignName: UPDATE_CAMPAIGN, templateParams: params, templateOnly: true,
        });
    } catch (err) {
        console.error('[taskAlerts] Failed to send task-update alert:', err instanceof Error ? err.message : err);
        return false;
    }
}
