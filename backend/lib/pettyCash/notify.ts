import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';
export type PettyCashRequestRow = {
    id: string; organization_id: string; property_id: string; requester_id: string;
    request_no: string; amount_requested: number; purpose: string;
    assigned_allocator_id?: string | null; assigned_approver_id?: string | null;
    allocated_amount?: number | null; approved_amount?: number | null; paid_amount?: number | null;
    requester_name?: string | null;
};
type Kind = 'submitted' | 'allocated' | 'approved' | 'rejected' | 'sent_back' | 'paid' | 'settlement_submitted' | 'closed' | 'proof_updated';
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Assigned actors only. Emails link to the app; financial actions use the same atomic API. */
export async function notifyPettyCash(kind: Kind, req: PettyCashRequestRow, remark?: string): Promise<void> {
    const ids = new Set<string>([req.requester_id]);
    if (kind === 'submitted' && req.assigned_allocator_id) ids.add(req.assigned_allocator_id);
    if (kind === 'allocated' && req.assigned_approver_id) ids.add(req.assigned_approver_id);
    if (kind === 'approved' || kind === 'settlement_submitted') {
        const [org, prop] = await Promise.all([
            supabaseAdmin.from('organization_memberships').select('user_id').eq('organization_id', req.organization_id).eq('role', 'accounts').eq('is_active', true),
            supabaseAdmin.from('property_memberships').select('user_id').eq('property_id', req.property_id).eq('role', 'accounts').eq('is_active', true),
        ]);
        for (const m of [...(org.data || []), ...(prop.data || [])]) ids.add(m.user_id);
    }
    const { data } = await supabaseAdmin.from('users').select('id,email').in('id', [...ids]);
    const app = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
    const subject = `Petty cash ${req.request_no}: ${kind.replaceAll('_', ' ')}`;
    const href = app ? `${app.replace(/\/$/, '')}/${req.organization_id}/petty-cash` : '';
    for (const user of data || []) {
        if (!user.email) continue;
        const { data: allowed } = await supabaseAdmin.rpc('pc_internal', { u: user.id, o: req.organization_id });
        if (!allowed) continue;
        await EmailService.sendEmail({ to: user.email, subject, html: `<h2>${escape(subject)}</h2><p>${escape(req.purpose)}</p>${remark ? `<p>${escape(remark)}</p>` : ''}${href ? `<p><a href="${escape(href)}">Open Petty Cash</a></p>` : ''}` });
    }
}
