import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

test('every petty cash notification is a no-op without recipient queries or outbound delivery', async () => {
    let reads = 0, sends = 0;
    const query = () => {
        reads++;
        const q = { select: () => q, eq: () => q, in: () => q,
            then: resolve => Promise.resolve({ data: [{ id: 'user', user_id: 'user', email: 'fixture@example.invalid' }] }).then(resolve) };
        return q;
    };
    const { notifyPettyCash } = loadTs('backend/lib/pettyCash/notify.ts', {
        '@/backend/lib/supabase/admin': { supabaseAdmin: { from: query, rpc: async () => { reads++; return { data: true }; } } },
        '@/backend/services/EmailService': { EmailService: { sendEmail: async () => { sends++; } } },
    });
    const request = { id: 'request', organization_id: 'org', property_id: 'property', requester_id: 'user',
        request_no: 'PCR-FIXTURE', amount_requested: 100, purpose: 'Isolated fixture', assigned_allocator_id: 'allocator', assigned_approver_id: 'approver' };
    for (const kind of ['submitted', 'allocated', 'approved', 'rejected', 'sent_back', 'paid', 'settlement_submitted', 'closed', 'proof_updated']) {
        await notifyPettyCash(kind, request, 'Fixture only');
    }
    assert.equal(reads, 0);
    assert.equal(sends, 0);
});
