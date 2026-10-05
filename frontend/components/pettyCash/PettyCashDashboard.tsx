'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { inr, PC_STATUS_META } from '@/frontend/lib/pettyCash/roles';
import NewRequestModal from './NewRequestModal';
import WorkflowRequestDetail from './WorkflowRequestDetail';
import PropertyRoutingSettings from './PropertyRoutingSettings';
import ExpenseHistory from './ExpenseHistory';
import { createClient } from '@/frontend/utils/supabase/client';
import ConsolidatedOverview from './ConsolidatedOverview';
import { pcFetch, pcJson, type Context, type PettyCashRequest } from './workflowTypes';
export default function PettyCashDashboard() {
    const { orgId } = useParams<{ orgId: string }>();
    const [context, setContext] = useState<Context>(); const [requests, setRequests] = useState<PettyCashRequest[]>([]); const [tab, setTab] = useState('mine');
    const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [showNew, setShowNew] = useState(false); const [detailId, setDetailId] = useState('');
    const [selected, setSelected] = useState<string[]>([]); const [amounts, setAmounts] = useState<Record<string, string>>({}); const [message, setMessage] = useState(''); const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [revision, setRevision] = useState(0);
    const loadContext = useCallback(async () => { const data = await pcFetch<Context>(`/api/petty-cash/context?org_id=${orgId}`); setContext(data); }, [orgId]);
    const loadRequests = useCallback(async () => {
        if (['routing', 'overview', 'expenses'].includes(tab)) return;
        const data = await pcFetch<{ requests: PettyCashRequest[]; pagination: { total_pages: number } }>(`/api/petty-cash?org_id=${orgId}&tab=${tab}&page=${page}`);
        setRequests(data.requests); setPages(Math.max(1, data.pagination.total_pages));
    }, [orgId, tab, page]);
    const refresh = useCallback(async () => { setError(''); try { await Promise.all([loadContext(), loadRequests()]); setRevision(n => n + 1); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load petty cash'); } }, [loadContext, loadRequests]);
    useEffect(() => { void refresh(); }, [refresh]);
    const refreshRef = useRef(refresh);
    useEffect(() => { refreshRef.current = refresh; }, [refresh]);
    useEffect(() => {
        const client = createClient();
        const channel = client.channel(`pc_${orgId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'petty_cash_requests', filter: `organization_id=eq.${orgId}` }, () => { void refreshRef.current(); }).subscribe();
        return () => { void client.removeChannel(channel); };
    }, [orgId]);
    const tabs = [{ key: 'mine', label: 'My Wallet & Requests' }, { key: 'expenses', label: 'My Expenses' },
        ...(context?.caps.canAllocate ? [{ key: 'allocations', label: 'To Allocate' }] : []),
        ...(context?.caps.canApprove ? [{ key: 'approvals', label: 'To Approve' }] : []),
        ...(context?.caps.canAllocate || context?.caps.canApprove ? [{ key: 'assigned', label: 'Assigned Requests & Spends' }] : []),
        ...(context?.caps.canDisburse ? [{ key: 'disbursements', label: 'To Pay' }, { key: 'reconciliation', label: 'Reconciliation' }] : []),
        ...(context?.caps.isAdmin ? [{ key: 'overview', label: 'Overview' }, { key: 'all', label: 'All Requests' }] : []),
        ...(context?.caps.canManageRouting ? [{ key: 'routing', label: 'Property Routing' }] : []),
    ];
    const isBulk = tab === 'allocations' || tab === 'approvals';
    return <div className="petty-cash-workflow space-y-5">
        <style>{`.pc-input{display:block;width:100%;border:1px solid var(--border,#cbd5e1);border-radius:10px;padding:9px 12px;background:var(--surface,#fff);color:inherit;margin-top:4px}.pc-button{border-radius:10px;padding:9px 14px;background:#587e85;color:white;font-weight:600}.pc-button:disabled{opacity:.5;cursor:not-allowed}.petty-cash-workflow label{font-size:14px}`}</style>
        <div className="flex flex-wrap gap-3 justify-between items-center"><div><h1 className="text-2xl font-bold">Petty Cash</h1><p className="text-text-secondary">Request, allocate, approve, pay and account for every expense.</p></div><div className="flex flex-wrap gap-2"><button className="pc-button" onClick={() => { void refresh(); }}>Refresh</button><button className="pc-button" disabled={!context?.properties.length} onClick={() => setShowNew(true)}>Prepare draft</button><button className="pc-button" disabled={!context?.wallet.can_request || !context.properties.length} onClick={() => setShowNew(true)}>Request Petty Cash</button></div></div>
        {error && <p role="alert" className="text-red-600">{error}</p>}{!context && !error && <p>Loading petty cash…</p>}
        {context && <>
            {tab === 'mine' && <><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{(['received', 'spent', 'returned', 'balance'] as const).map(key => <div className="rounded-xl border border-border p-4" key={key}><p className="capitalize">{key}</p><strong className="text-xl">{inr(context.wallet[key])}</strong></div>)}</div>{context.wallet.blocker && <p role="status" className="rounded-xl bg-amber-50 text-amber-800 p-3">Next request unavailable: {context.wallet.blocker}</p>}{!context.properties.length && <p>An active property assignment is needed to request cash.</p>}</>}
            <div className="flex gap-2 overflow-x-auto border-b border-border pb-2">{tabs.map(t => <button key={t.key} onClick={() => { setTab(t.key); setSelected([]); setPage(1); setMessage(''); }} className={`px-3 py-2 rounded-xl whitespace-nowrap ${t.key === tab ? 'bg-primary text-white' : 'bg-surface border border-border'}`}>{t.label}</button>)}</div>
            {tab === 'routing' ? <PropertyRoutingSettings context={context} onSaved={() => { void loadContext(); }} /> : tab === 'expenses' ? <ExpenseHistory key={revision} org={orgId} onOpen={setDetailId} /> : tab === 'overview' ? <ConsolidatedOverview key={revision} org={orgId} onOpen={setDetailId} /> : <>
                {isBulk && <div className="flex flex-wrap gap-3 items-center"><button disabled={busy || !selected.length} className="pc-button" onClick={async () => {
                    const total = requests.filter(r => selected.includes(r.id)).reduce((sum, r) => sum + Number(tab === 'allocations' ? amounts[r.id] || r.amount_requested : r.allocated_amount || r.amount_requested), 0);
                    if (!window.confirm(`${tab === 'allocations' ? 'Allocate' : 'Approve'} ${selected.length} requests totalling ${inr(total)}?`)) return;
                    setBusy(true); setMessage(''); try {
                        const data = await pcFetch<{ results: { id: string; ok: boolean; error?: string }[] }>('/api/petty-cash/bulk', pcJson({ organization_id: orgId, action: tab === 'allocations' ? 'allocate' : 'approve', items: requests.filter(r => selected.includes(r.id)).map(r => ({ id: r.id, expected_version: r.version, ...(tab === 'allocations' ? { allocated_amount: amounts[r.id] || r.amount_requested } : {}) })) }));
                        setSelected(data.results.filter(r => !r.ok).map(r => r.id)); setMessage(`${data.results.filter(r => r.ok).length} succeeded. ${data.results.filter(r => !r.ok).map(r => r.error).join('; ')}`); await refresh();
                    } catch (e) { setError(e instanceof Error ? e.message : 'Bulk action failed'); } finally { setBusy(false); }
                }}>Process selected ({selected.length})</button><p>Each request follows its configured approver. Allocation amounts can be edited below.</p></div>}
                {message && <p role="status">{message}</p>}
                <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{isBulk && <th className="p-2"><input type="checkbox" aria-label="Select all visible requests" checked={!!requests.length && requests.every(r => selected.includes(r.id))} onChange={e => setSelected(e.target.checked ? requests.map(r => r.id) : [])} /></th>}{['Request', 'Property', 'Requester', 'Status', 'Requested', 'Allocated', 'Approver', 'Details'].map(h => <th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{requests.map(r => <tr key={r.id} className="border-t border-border">{isBulk && <td className="p-2"><input type="checkbox" aria-label={`Select ${r.request_no}`} checked={selected.includes(r.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, r.id] : prev.filter(id => id !== r.id))} /></td>}<td className="p-2 whitespace-nowrap">{r.request_no}</td><td>{r.property?.name}</td><td>{r.requester?.full_name || r.requester?.email}</td><td>{r.request_type === 'reimbursement' ? 'Historical reimbursement' : r.workflow_version === 1 && r.status === 'submitted' ? 'Needs routing reassignment' : PC_STATUS_META[r.status]?.label || r.status}</td><td>{inr(r.amount_requested)}</td><td>{tab === 'allocations' ? <input className="pc-input min-w-28" aria-label={`Allocated amount ${r.request_no}`} type="number" min="0.01" max={r.amount_requested} step="0.01" value={amounts[r.id] ?? String(r.amount_requested)} onChange={e => setAmounts(prev => ({ ...prev, [r.id]: e.target.value }))} /> : inr(r.allocated_amount)}</td><td>{r.assigned_approver?.full_name || r.assigned_approver?.email}</td><td><button className="underline p-2" onClick={() => setDetailId(r.id)}>View</button></td></tr>)}</tbody></table>{!requests.length && <p className="p-5 text-text-secondary">No requests in this queue.</p>}</div>
                <div className="flex gap-3 justify-end items-center"><button disabled={page <= 1} onClick={() => { setPage(p => p - 1); setSelected([]); }}>Previous</button><p>Page {page} of {pages}</p><button disabled={page >= pages} onClick={() => { setPage(p => p + 1); setSelected([]); }}>Next</button></div>
            </>}
            {showNew && <NewRequestModal open properties={context.properties} organizationId={orgId} routes={context.routes} canSubmit={context.wallet.can_request} blocker={context.wallet.blocker} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); void refresh(); }} />}
            {detailId && <WorkflowRequestDetail key={detailId} context={context} id={detailId} onClose={() => setDetailId('')} onChanged={() => { void refresh(); }} />}
        </>}
    </div>;
}
