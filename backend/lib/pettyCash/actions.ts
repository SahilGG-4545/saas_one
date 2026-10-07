import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { notifyPettyCash } from './notify';
import type { PettyCashAccess } from './access';
export async function applyPettyCashAction(access: PettyCashAccess, id: string, action: string, body: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin.rpc('pc_action', { actor: access.user.id, rid: id, action, body: { ...body, organization_id: access.organizationId } });
    if (!error && data) {
        const kinds = { allocate: 'allocated', approve: 'approved', reject: 'rejected', send_back: 'sent_back', submit: 'submitted', resubmit: 'submitted', reassign: 'submitted', pay: 'paid', settle: 'settlement_submitted', close: 'closed' } as const;
        const kind = kinds[action as keyof typeof kinds];
        if (kind) void notifyPettyCash(kind, data, typeof body.remark === 'string' ? body.remark : undefined).catch(() => {});
    }
    return { data, error };
}
