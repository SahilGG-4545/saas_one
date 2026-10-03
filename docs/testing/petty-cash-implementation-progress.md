# Implementation ledger — plan: docs/superpowers/plans/2026-10-03-petty-cash-allocation-wallet.md

- User authorized implementation on the existing dedicated feature branch.
- Phase 1/2: additive database schema, property routing, explicit access and guarded stage actions implemented. Initial database regression suite observed failing before migration existed, then passing (5/5).
- Phase 3: atomic wallet/expense/gate, proof correction and private upload/download implemented. Existing records are retained; legacy advances remain legacy and gate new requests until reconciled. No live migration or financial writes performed.
- Phase 4: API/UI/reporting, bulk preview and per-item results, personal expense history, property routing settings, role sidebars and body-portal responsive dialogs implemented.
- Phase 5: 19 database/API/sidebar regressions and two desktop/mobile browser lifecycle checks passed in isolated fixtures. TypeScript and SQL migration lint passed. Private evidence checks include readable PDF/image acceptance and malformed/spoofed rejection. Live named-user testing remains unavailable without authenticated app access.
- Ruling: use immutable wallet entries plus a balance function rather than a mutable wallet cache; the requester advisory lock serializes credits/debits/submissions and avoids two independent balance sources.
- Ruling: preserve legacy balances and bills in the existing reconciliation view rather than invent opening balances from ambiguous custodian/bill records. New v2 credits originate only from confirmed v2 payment. Existing unresolved legacy advances block replenishment.
- Ruling: old unversioned email links cannot act on v2 requests; notifications link users to the current application record, protecting revised requests from stale approvals.
- Navigation changes outside the petty-cash directory add only a shared Petty Cash link to existing role sidebars; unrelated module behavior is unchanged.
- Explicit reassignment resets current allocation details; original decisions remain in activity history. Regression verifies the old allocator loses action permission.
- Build verification is limited: production build attempted with build-only placeholder Supabase settings, then failed downloading the existing Urbanist Google Font. No live credentials, migration, payment or request were used.

- Independent review found and prompted fixes for explicit Supabase default RPC grants, settlement-view invoker RLS, and legacy rejected-proof supersession. Added failing reproductions, then verified corrected cases pass. Client RPC privileges now exclude anon/authenticated except auth.uid-based RLS wrappers. Superseded proofs remain immutable history.
