import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { findWhatsAppUser, getWhatsAppProperties } from '../assistant/access';
import { defaultSettings, pilotAllowed, settingsSchema } from './config.mjs';

export async function organizationSettings(organizationId: string) {
    const { data, error } = await supabaseAdmin.from('whatsapp_interpreter_settings')
        .select('config').eq('organization_id', organizationId).maybeSingle();
    if (error) throw error;
    const parsed = settingsSchema.safeParse(data?.config || defaultSettings);
    return parsed.success ? parsed.data : defaultSettings;
}

export async function isInterpreterPilot(input: { phone: string; projectId?: string }) {
    if (process.env.WHATSAPP_LLM_INTERPRETER_ENABLED !== 'true' || process.env.AISENSY_ASSISTANT_ENABLED !== 'true') return false;
    if (!process.env.AISENSY_PROJECT_ID || input.projectId !== process.env.AISENSY_PROJECT_ID) return false;
    const user = await findWhatsAppUser(input.phone);
    if (!user) return false;
    const properties = await getWhatsAppProperties(user.id);
    for (const org of new Set(properties.map(property => property.organization_id))) {
        if (pilotAllowed(await organizationSettings(org), user.id)) return true;
    }
    return false;
}

export async function lookupQuotedContext(phone: string, aliases: string[]) {
    if (!aliases.length || !process.env.AISENSY_PROJECT_ID) return null;
    const { data, error } = await supabaseAdmin.from('whatsapp_outgoing_context').select('workflow,conversation_id,revision')
        .eq('project_id', process.env.AISENSY_PROJECT_ID).eq('phone', phone).in('message_alias', aliases.slice(0, 4))
        .gt('expires_at', new Date().toISOString());
    if (error) throw error;
    const distinct = new Map((data || []).map(row => [`${row.workflow}:${row.conversation_id}:${row.revision}`, row]));
    return distinct.size === 1 ? [...distinct.values()][0] : null;
}

// Read both systems without renewing or clearing either conversation.
export async function getConversationRoutingState(phone: string) {
    const now = new Date();
    const [task, facility, pending] = await Promise.all([
        supabaseAdmin.from('conversation_context').select('context_data').eq('phone_number',phone).eq('system','TASK_MANAGER')
            .gt('expires_at',now.toISOString()).maybeSingle(),
        supabaseAdmin.from('whatsapp_assistant_sessions').select('state').eq('phone',phone).maybeSingle(),
        supabaseAdmin.from('whatsapp_assistant_events').select('id').eq('phone',phone).contains('payload',{interpreter:true})
            .in('status',['pending','processing','ready']).limit(1),
    ]);
    if (task.error || facility.error || pending.error) throw new Error('Conversation routing unavailable');
    const state = facility.data?.state;
    const active = state?.llmVersion === 1 && state.drafts?.[state.active];
    return {taskActive:!!task.data, taskChoicePending:task.data?.context_data?.state === 'AWAITING_SYSTEM_CHOICE',
        facilityActive:!!(active && active.expiresAt > now.getTime()) || !!pending.data?.length};
}

export async function recordOutgoingContext(phone: string, aliases: string[], context: { workflow: string; conversationId: string; revision?: number }) {
    if (!aliases.length || !process.env.AISENSY_PROJECT_ID || process.env.WHATSAPP_LLM_INTERPRETER_ENABLED !== 'true') return;
    const { error } = await supabaseAdmin.from('whatsapp_outgoing_context').upsert(aliases.map(alias => ({
        project_id: process.env.AISENSY_PROJECT_ID, phone, message_alias: alias, workflow: context.workflow,
        conversation_id: context.conversationId, revision: context.revision || 0,
    })), { onConflict: 'project_id,phone,message_alias', ignoreDuplicates: true });
    if (error) throw error;
}
