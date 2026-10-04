import { AiSensyService } from '@/backend/services/AiSensyService';

const PROJECT_API_BASE = 'https://apis.aisensy.com/project-apis/v1/project';

export class TaskMessagingService {
    private static formatPhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        if (digits.length === 10) return '91' + digits;
        return digits;
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
     * Sends an outbound notification via pre-approved template.
     * Required for proactive outbound alerts (e.g. morning task digest) outside the 24h window.
     */
    static async sendTemplateNotification(params: {
        phone: string;
        campaignName?: string;
        templateParams: string[];
    }): Promise<boolean> {
        const campaignName = params.campaignName || process.env.AISENSY_TASK_CAMPAIGN_NAME || 'fms_welcome_onboarding_v1';
        const res = await AiSensyService.sendTemplate({
            phone: params.phone,
            campaignName,
            templateParams: params.templateParams,
        });
        return res.success;
    }

    /**
     * Unified message dispatcher:
     * Attempts freeform reply first (within 24h session window), falling back to template if freeform is unavailable.
     */
    static async sendMessage(phone: string, text: string): Promise<boolean> {
        const sent = await this.sendFreeformReply(phone, text);
        if (sent) return true;

        // Fallback to template if campaign configured
        if (process.env.AISENSY_TASK_CAMPAIGN_NAME) {
            return this.sendTemplateNotification({
                phone,
                campaignName: process.env.AISENSY_TASK_CAMPAIGN_NAME,
                templateParams: [text],
            });
        }
        return false;
    }

    static async sendFreeformMessage(phone: string, text: string): Promise<boolean> {
        return this.sendMessage(phone, text);
    }
}
