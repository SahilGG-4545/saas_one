# Review Petty Cash before production merge

Source branch: `feat/petty-cash-allocation-wallet`. The user authorized pushing this branch and wants to review it before a production merge. Keep the PR in draft and do not merge or enable auto-merge as part of preview review.

## Open the preview

The repository has an active Vercel integration for project `saas-one` in team `autopilot-offices-projects` (confirmed from the feature branch's existing successful Vercel commit status).

1. Open the feature PR on GitHub. Its Vercel bot comment normally shows **Visit Preview**. The Vercel check's **Details** link opens deployment status/build logs.
2. Alternatively, open Vercel → `saas-one` → Deployments, filter branch `feat/petty-cash-allocation-wallet`, and choose the latest successful **Preview** deployment matching the PR head commit. Use **Visit** to open its generated URL.
3. Sign in using isolated test users. Open `/<test-organization-id>/petty-cash`, or Management Hub → Petty Cash. Review Dashboard ↔ Grievance and User Directory as well.

A feature-branch push can trigger its preview when Vercel Git previews are enabled. A merge into the configured Production Branch can trigger production. Verify the Production Branch in Vercel's Git settings; this workspace cannot inspect those account settings. GitHub's default branch is `main`, but that alone does not prove Vercel's production-branch setting.

## Database preparation

A Preview deployment isolates code; it does not automatically isolate the Supabase database. Before testing actions, check Vercel → Settings → Environment Variables → **Preview**. These three variables must all reference the same separate test Supabase project:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)

Use the existing schema and isolated fixture identities in that project. Review and manually apply pending migrations there in order, as described in `docs/features/petty_cash_module.md`, including the allocation-wallet, plan-completion and membership-approval-scope migrations. Configure primary allocator/approver users through Workflow settings; never from the requester's form. Add the preview URL to that test project's permitted Supabase Auth redirect URLs if needed. Redeploy the preview after changing its build-time public environment variables.

No database changes are authorized by pushing the branch. If Preview currently points to production, switch it to a separately authorized test project before using payment, expense or membership actions. Until the test schema is prepared, relevant APIs can report missing workflow/schema columns and the complete flow cannot be tested.

## Review and release

Test the requester → allocator → approver → accounts Paid → wallet → expense-with-proof flow. Retry payment/expense actions and verify one credit/debit, no negative balance and zero balance/proof-complete replenishment before finance closure. Check role-specific sidebars, Payment Tracker separation, mobile/direct links/refresh/history, pending directory rows, failed fetch Retry, cross-scope denial and scoped approvals. Petty-cash outbound notifications remain disabled.

After preview acceptance, production rollout remains a separate decision: review migration/backups, apply only pending database additions through the normal approved deployment process, configure routing, and then explicitly authorize the production merge/deployment. No merge, production promotion or database migration occurs merely by creating the draft PR in this task.
