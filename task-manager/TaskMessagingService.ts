import { AiSensyService } from '@/backend/services/AiSensyService';
import { TaskDatabaseService } from './TaskDatabaseService';

const PROJECT_API_BASE = 'https://apis.aisensy.com/project-apis/v1/project';

export class TaskMessagingService {
    private static formatPhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        if (digits.length === 10) return '91' + digits;
        return digits;
    }

    /**
     * Phase 2: Central WhatsApp Gatekeeper
     * Enforces the multi-level kill switch hierarchy:
     * 1. Global Kill Switch: Blocks ALL automated messaging company-wide
     * 2. Department Kill Switch: Blocks messaging for a specific department
     * 3. Message-Type Kill Switch: Blocks specific message categories (morning_digest, pending_reminder, eod_summary, kickoffs)
     */
    static async isMessagingAllowed(options?: {
        departmentId?: string;
        ruleType?: string;
        messageType?: string;
        bypassKillSwitch?: boolean;
    }): Promise<{ allowed: boolean; reason?: string }> {
        if (options?.bypassKillSwitch) {
            return { allowed: true };
        }

        try {
            const killSwitches = await TaskDatabaseService.getKillSwitches();

            // 1. Global Emergency Kill Switch
            if (killSwitches.globalHalt) {
                const reason = killSwitches.haltReason
                    ? `Global Kill Switch ACTIVE: ${killSwitches.haltReason}`
                    : 'Global Kill Switch ACTIVE: All automated WhatsApp messaging is halted company-wide.';
                return { allowed: false, reason };
            }

            // 2. Department-Level Kill Switch
            if (options?.departmentId && killSwitches.departmentHalt?.[options.departmentId]) {
                return {
                    allowed: false,
                    reason: `Department Kill Switch ACTIVE: WhatsApp messaging is currently paused for this department.`
                };
            }

            // 3. Message-Type Kill Switch
            const rawType = options?.messageType || options?.ruleType;
            if (rawType && killSwitches.messageTypeHalt) {
                const isHalted = (killSwitches.messageTypeHalt as Record<string, boolean | undefined>)[rawType];
                if (isHalted) {
                    return {
                        allowed: false,
                        reason: `Message Category Kill Switch ACTIVE: Notifications of type '${rawType}' are currently paused.`
                    };
                }
            }

            return { allowed: true };
        } catch (err: any) {
            console.error('[TaskMessagingService] Error checking kill switch gatekeeper:', err?.message);
            // Default to safe behavior if gatekeeper check fails unexpectedly
            return { allowed: true };
        }
    }

    /**
     * Sends a direct free-form WhatsApp message inside the 24-hour service window.
     * Uses the AiSensy Project (Direct) API proven in whatsapp-test/freeformTest.ts.
     * Enables rich, dynamic WhatsApp responses without needing pre-approved templates.
     */
    static async sendFreeformReply(phone: string, text: string): Promise<boolean> {
        const destination = this.formatPhone(phone);
        const projectId = process.env.AISENSY_PROJECT_ID;
        const password = process.env.AISENSY_PROJECT_API_KEY;

        if (!projectId || !password) {
            console.warn('[TaskMessagingService] AISENSY_PROJECT_ID or AISENSY_PROJECT_API_KEY not configured. Falling back to template send.');
            return false;
        }

        try {
            const res = await fetch(`${PROJECT_API_BASE}/${encodeURIComponent(projectId)}/messages`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-AiSensy-Project-API-Pwd': password,
                },
                body: JSON.stringify({
                    to: destination,
                    type: 'text',
                    recipient_type: 'individual',
                    text: { body: text },
                }),
                signal: AbortSignal.timeout(15_000),
            });

            if (!res.ok) {
                const body = await res.text().catch(() => '');
                console.error(`[TaskMessagingService] Freeform send failed with status ${res.status}:`, body);
                return false;
            }

            return true;
        } catch (error) {
            console.error('[TaskMessagingService] Freeform send network error:', error);
            return false;
        }
    }

    /**
     * Resolves the Meta-approved campaign name corresponding to the notification rule type.
     * Supports environment variable overrides and falls back to the newly approved dedicated templates.
     */
    static getCampaignForRuleType(ruleType?: string): string {
        switch (ruleType) {
            case 'morning_digest':
                return process.env.AISENSY_TASK_MORNING_CAMPAIGN || 'task_morning_kickoff_v1';
            case 'pending_reminder':
                return process.env.AISENSY_TASK_MIDDAY_CAMPAIGN || 'task_midday_reminder_v1';
            case 'eod_summary':
                return process.env.AISENSY_TASK_EOD_CAMPAIGN || 'task_eod_summary_v1';
            case 'overdue_alert':
                return process.env.AISENSY_TASK_MIDDAY_CAMPAIGN || 'task_midday_reminder_v1';
            default:
                return process.env.AISENSY_TASK_MORNING_CAMPAIGN || process.env.AISENSY_TASK_CAMPAIGN_NAME || 'task_morning_kickoff_v1';
        }
    }

    /**
     * Sends an outbound notification via pre-approved template.
     * Required for proactive outbound alerts (e.g. morning task digest) outside the 24h window.
     */
    static async sendTemplateNotification(params: {
        phone: string;
        campaignName?: string;
        templateParams: string[];
    }): Promise<boolean> {
        const campaignName = params.campaignName || this.getCampaignForRuleType();
        const res = await AiSensyService.sendTemplate({
            phone: params.phone,
            campaignName,
            templateParams: params.templateParams,
        });
        return res.success;
    }

    /**
     * Unified message dispatcher:
     * 1. Evaluates Phase 2 Kill Switch gatekeeper.
     * 2. Attempts freeform reply first (within 24h session window).
     * 3. Falls back to Meta-approved template campaign if freeform fails.
     */
    static async sendMessage(
        phone: string,
        text: string,
        options?: {
            departmentId?: string;
            ruleType?: string;
            messageType?: string;
            campaignName?: string;
            templateParams?: string[];
            bypassKillSwitch?: boolean;
        }
    ): Promise<boolean> {
        // Phase 2 Gatekeeper Check
        const gatekeeper = await this.isMessagingAllowed(options);
        if (!gatekeeper.allowed) {
            console.warn(`[TaskMessagingService] 🛑 Message to ${phone} blocked: ${gatekeeper.reason}`);
            
            // Record safety audit log
            await TaskDatabaseService.logAudit({
                event_type: 'whatsapp_blocked_by_kill_switch',
                actor_id: null,
                target_employee_id: null,
                task_id: null,
                details: {
                    phone,
                    reason: gatekeeper.reason,
                    departmentId: options?.departmentId,
                    ruleType: options?.ruleType,
                    messageType: options?.messageType || options?.ruleType,
                    blockedAt: new Date().toISOString(),
                },
            }).catch(err => {
                console.warn('[TaskMessagingService] Failed to record kill switch audit log:', err?.message);
            });

            return false;
        }

        const sent = await this.sendFreeformReply(phone, text);
        if (sent) return true;

        // Fallback to Meta-approved template if outside 24h window or freeform fails
        const campaignName = options?.campaignName || this.getCampaignForRuleType(options?.ruleType);
        const params = options?.templateParams && options.templateParams.length > 0
            ? options.templateParams
            : [text];

        return this.sendTemplateNotification({
            phone,
            campaignName,
            templateParams: params,
        });
    }

    static async sendFreeformMessage(phone: string, text: string): Promise<boolean> {
        return this.sendMessage(phone, text);
    }
}

