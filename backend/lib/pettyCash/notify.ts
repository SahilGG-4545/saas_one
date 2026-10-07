export type PettyCashRequestRow = {
    id: string; organization_id: string; property_id: string; requester_id: string;
    request_no: string; amount_requested: number; purpose: string;
    assigned_allocator_id?: string | null; assigned_approver_id?: string | null;
    allocated_amount?: number | null; approved_amount?: number | null; paid_amount?: number | null;
    requester_name?: string | null;
};
type Kind = 'submitted' | 'allocated' | 'approved' | 'rejected' | 'sent_back' | 'paid' | 'settlement_submitted' | 'closed' | 'proof_updated';
/** Petty-cash delivery is intentionally disabled until omnichannel wiring is approved.
 * Keep the call contract so financial actions do not depend on notification delivery.
 * No recipient lookup, email, WhatsApp, or outbox work happens here.
 */
export async function notifyPettyCash(kind: Kind, req: PettyCashRequestRow, remark?: string): Promise<void> {
    void kind;
    void req;
    void remark;
}
