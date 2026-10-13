'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, FilePlus2, Inbox, Loader2, Plus, RefreshCw, RotateCcw, Wallet } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import PettyCashStyles from './PettyCashStyles';
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
    const router=useRouter();const pathname=usePathname();const searchParams=useSearchParams();const linkedRequest=searchParams.get('request_id');
    const invalidLink=linkedRequest!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(linkedRequest);
    const [storedContext, setContext] = useState<Context>();const context=storedContext?.organization_id===orgId?storedContext:undefined; const [requests, setRequests] = useState<PettyCashRequest[]>([]); const [selectedTab, setTab] = useState<string|null>(null);const tab=selectedTab || (context?.caps.isAdmin?'overview':'mine');
    const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [showNew, setShowNew] = useState(false); const [detailTarget,setDetailTarget]=useState<{organizationId:string;id:string}>();const detailId=detailTarget?.organizationId===orgId?detailTarget.id:'';const setDetailId=(id:string)=>setDetailTarget({organizationId:orgId,id});
    useEffect(()=>setDetailTarget(linkedRequest&&!invalidLink?{organizationId:orgId,id:linkedRequest}:undefined),[orgId,linkedRequest,invalidLink]);
    const closeDetail=()=>{setDetailTarget(undefined);if(linkedRequest!==null){const remaining=new URLSearchParams(searchParams.toString());remaining.delete('request_id');router.replace(`${pathname}${remaining.size?`?${remaining}`:''}`,{scroll:false});}};
    const [selected, setSelected] = useState<string[]>([]); const [amounts, setAmounts] = useState<Record<string, string>>({}); const [message, setMessage] = useState(''); const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [revision, setRevision] = useState(0);
    const [loading,setLoading]=useState(true);const [contextLoading,setContextLoading]=useState(true);const [contextError,setContextError]=useState('');const [requestError,setRequestError]=useState('');const [requestsOrg,setRequestsOrg]=useState('');
    const contextSequence=useRef(0);const requestSequence=useRef(0);
    const loadContext=useCallback(async(signal?:AbortSignal)=>{const sequence=++contextSequence.current;setContextLoading(true);setContextError('');try{const data=await pcFetch<Context>(`/api/petty-cash/context?org_id=${orgId}`,{signal});if(!signal?.aborted&&sequence===contextSequence.current)setContext(data);}catch(reason){if(!signal?.aborted&&sequence===contextSequence.current){setContext(undefined);setContextError(reason instanceof Error?reason.message:'Could not load wallet and permissions');}}finally{if(!signal?.aborted&&sequence===contextSequence.current)setContextLoading(false);}},[orgId]);
    const loadRequests=useCallback(async(signal?:AbortSignal)=>{const sequence=++requestSequence.current;setRequestError('');if(!context || ['routing','overview','expenses'].includes(tab)){setLoading(false);return;}setLoading(true);try{const data=await pcFetch<{requests:PettyCashRequest[];pagination:{total_pages:number}}>(`/api/petty-cash?org_id=${orgId}&tab=${tab}&page=${page}`,{signal});if(!signal?.aborted&&sequence===requestSequence.current){setRequests(data.requests);setRequestsOrg(orgId);setPages(Math.max(1,data.pagination.total_pages));}}catch(reason){if(!signal?.aborted&&sequence===requestSequence.current){setRequests([]);setRequestsOrg('');setRequestError(reason instanceof Error?reason.message:'Could not load requests');}}finally{if(!signal?.aborted&&sequence===requestSequence.current)setLoading(false);}},[orgId,tab,page,Boolean(context)]);
    useEffect(()=>{const controller=new AbortController();setContext(undefined);setError('');setRequests([]);setRequestsOrg('');setSelected([]);setTab(null);setPage(1);void loadContext(controller.signal);return()=>{controller.abort();contextSequence.current++;};},[loadContext]);
    useEffect(()=>{const controller=new AbortController();void loadRequests(controller.signal);return()=>{controller.abort();requestSequence.current++;};},[loadRequests]);
    const refresh=useCallback(async()=>{setError('');await Promise.all([loadContext(),loadRequests()]);setRevision(n=>n+1);},[loadContext,loadRequests]);
    const visibleError=invalidLink?'Invalid petty cash request link. Open a request from the table or use a valid notification link.':error||contextError||requestError;
    const refreshRef = useRef(refresh);
    useEffect(() => { refreshRef.current = refresh; }, [refresh]);
    useEffect(() => {
        const client = createClient();let timer:ReturnType<typeof setTimeout>|undefined;
        const channel = client.channel(`pc_${orgId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'petty_cash_requests', filter: `organization_id=eq.${orgId}` }, () => {clearTimeout(timer);timer=setTimeout(()=>{void refreshRef.current();},300);}).subscribe();
        return () => {clearTimeout(timer);void client.removeChannel(channel);};
    }, [orgId]);
    const tabs = [...(context?.caps.isAdmin ? [{key:'overview',label:'Overview'}] : []),{ key: 'mine', label: 'My Wallet & Requests' }, { key: 'expenses', label: 'My Expenses' },
        ...(context?.caps.canAllocate ? [{ key: 'allocations', label: 'To Allocate' }] : []),
        ...(context?.caps.canApprove ? [{ key: 'approvals', label: 'To Approve' }] : []),
        ...(context?.caps.canAllocate || context?.caps.canApprove ? [{ key: 'assigned', label: 'Assigned Requests & Spends' }] : []),
        ...(context?.caps.canDisburse ? [{ key: 'disbursements', label: 'To Pay' }, { key: 'reconciliation', label: 'Reconciliation' }] : []),
        ...(context?.caps.isAdmin ? [{ key: 'all', label: 'All Requests' }] : []),
        ...(context?.caps.canManageRouting ? [{ key: 'routing', label: 'Property Routing' }] : []),
    ];
    const isBulk = tab === 'allocations' || tab === 'approvals';
    const summary = [{ key: 'received', label: 'Received', icon: ArrowDownLeft }, { key: 'spent', label: 'Spent', icon: ArrowUpRight }, { key: 'returned', label: 'Returned', icon: RotateCcw }, { key: 'balance', label: 'Available balance', icon: Wallet }] as const;
    return <div className="petty-cash-workflow space-y-6">
        <PettyCashStyles />
        <div className="pc-panel pc-header flex flex-wrap gap-4 justify-between items-center p-6 rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm">
            <div className="flex items-center gap-3.5">
                <div className="pc-icon-tile w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm shrink-0">
                    <Wallet size={22} />
                </div>
                <div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Finance & Operations</span>
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none mt-0.5">Petty Cash</h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Manage requests, approvals, payments, and real-time ledger settlement.</p>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
                <Button variant="solid" size="icon" aria-label="Refresh" title="Refresh" disabled={loading || contextLoading || busy} onClick={() => { void refresh(); }} className="rounded-xl border border-slate-200 dark:border-[#30363d] hover:bg-slate-100 dark:hover:bg-[#21262d]"><RefreshCw size={16} className={loading || contextLoading ? 'animate-spin' : ''} /></Button>
                <Button variant="solid" className="gap-2 rounded-xl font-bold border border-slate-200 dark:border-[#30363d] hover:bg-slate-100 dark:hover:bg-[#21262d]" disabled={!context?.properties.length} onClick={() => setShowNew(true)}><FilePlus2 size={16} />Prepare draft</Button>
                <Button className="gap-2 rounded-xl font-black bg-primary text-white shadow-lg shadow-primary/20 hover:bg-primary/90 active:scale-95 transition-all" disabled={!context?.wallet.can_request || !context.properties.length} onClick={() => setShowNew(true)}><Plus size={16} />Request Petty Cash</Button>
            </div>
        </div>
        {visibleError && <p role="alert" className="pc-alert">{visibleError}</p>}{!context && !visibleError && <p role="status" className="flex items-center gap-2 text-sm text-text-secondary p-4"><Loader2 size={18} className="animate-spin text-primary" />Loading petty cash…</p>}
        {!contextError && (context || requestsOrg===orgId) && <>
            {context && tab === 'mine' && <>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                    {summary.map(({ key, label, icon: Icon }) => (
                        <div className={`pc-panel pc-summary p-5 rounded-3xl bg-white dark:bg-[#161b22] border ${key === 'balance' ? 'border-primary/40 ring-1 ring-primary/20' : 'border-slate-100 dark:border-[#30363d]'} shadow-sm transition-all hover:shadow-md`} key={key}>
                            <div className="flex justify-between items-center gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</span>
                                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                                    <Icon size={16} />
                                </div>
                            </div>
                            <div className="text-3xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">{inr(context.wallet[key])}</div>
                        </div>
                    ))}
                </div>
                {context.wallet.blocker && <p role="status" className="pc-notice">Next request unavailable: {context.wallet.blocker}</p>}
                {!context.properties.length && <p className="pc-notice">An active property assignment is needed to request cash.</p>}
            </>}
            {context?.counts_error && tab!=='overview' && <p role="status" className="pc-notice">{context.counts_error}</p>}
            <nav aria-label="Petty cash views" className="flex gap-1.5 overflow-x-auto rounded-2xl bg-slate-100 dark:bg-[#161b22] border border-slate-200/80 dark:border-[#30363d] p-1.5 scrollbar-hide">
                {tabs.map(t => (
                    <button
                        key={t.key}
                        aria-label={t.label}
                        aria-description={context?.counts?.[t.key as keyof NonNullable<Context['counts']>] === undefined ? undefined : `${context.counts[t.key as keyof NonNullable<Context['counts']>]} items awaiting action, approval or review`}
                        title={context?.counts?.[t.key as keyof NonNullable<Context['counts']>] === undefined ? t.label : `${t.label}: ${context.counts[t.key as keyof NonNullable<Context['counts']>]} pending items`}
                        aria-pressed={t.key === tab}
                        disabled={busy}
                        onClick={() => { if (t.key === tab) return; setTab(t.key); setRequests([]); setSelected([]); setPage(1); setMessage(''); }}
                        className={`shrink-0 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all ${t.key === tab ? 'bg-white dark:bg-[#21262d] text-slate-900 dark:text-white font-black shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#21262d]/50'}`}
                    >
                        {t.label}
                        {(context?.counts?.[t.key as keyof NonNullable<Context['counts']>] || 0) > 0 && (
                            <span data-pending-count className="ml-2 rounded-full bg-primary/15 dark:bg-primary/25 text-primary px-2 py-0.5 text-[10px] font-black">
                                {context?.counts?.[t.key as keyof NonNullable<Context['counts']>]}
                            </span>
                        )}
                    </button>
                ))}
            </nav>
            {tab === 'routing' && context ? <PropertyRoutingSettings context={context} onSaved={() => { void loadContext(); }} /> : tab === 'expenses' ? <ExpenseHistory key={revision} org={orgId} onOpen={setDetailId} /> : tab === 'overview' ? <ConsolidatedOverview key={revision} countsIssue={context?.counts_error||undefined} org={orgId} onOpen={setDetailId} context={context} /> : <>
                {isBulk && <div className="pc-panel p-4 flex flex-wrap gap-3 items-center rounded-2xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm"><button disabled={busy || loading || !selected.length} className="pc-button" onClick={async () => {
                    const total = requests.filter(r => selected.includes(r.id)).reduce((sum, r) => sum + Number(tab === 'allocations' ? amounts[r.id] || r.amount_requested : r.allocated_amount || r.amount_requested), 0);
                    if (!window.confirm(`${tab === 'allocations' ? 'Allocate' : 'Approve'} ${selected.length} requests totalling ${inr(total)}?`)) return;
                    setBusy(true); setMessage(''); try {
                        const data = await pcFetch<{ results: { id: string; ok: boolean; error?: string }[] }>('/api/petty-cash/bulk', pcJson({ organization_id: orgId, action: tab === 'allocations' ? 'allocate' : 'approve', items: requests.filter(r => selected.includes(r.id)).map(r => ({ id: r.id, expected_version: r.version, ...(tab === 'allocations' ? { allocated_amount: amounts[r.id] || r.amount_requested } : {}) })) }));
                        setSelected(data.results.filter(r => !r.ok).map(r => r.id)); setMessage(`${data.results.filter(r => r.ok).length} succeeded. ${data.results.filter(r => !r.ok).map(r => r.error).join('; ')}`); await refresh();
                    } catch (e) { setError(e instanceof Error ? e.message : 'Bulk action failed'); } finally { setBusy(false); }
                }}>Process selected ({selected.length})</button><p className="text-xs text-text-secondary">Each request follows its configured approver. Allocation amounts can be edited below.</p></div>}
                {message && <p role="status" className="pc-success"><CheckCircle2 size={18} />{message}</p>}
                <div className="pc-table-wrap rounded-2xl border border-slate-200/80 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-sm overflow-hidden" aria-busy={loading}>
                    <table className="w-full text-sm min-w-[850px]">
                        <thead>
                            <tr className="bg-slate-50/70 dark:bg-[#1c2128] border-b border-slate-100 dark:border-[#30363d]">
                                {isBulk && <th className="p-3.5"><input type="checkbox" aria-label="Select all visible requests" disabled={loading || busy} checked={!!requests.length && requests.every(r => selected.includes(r.id))} onChange={e => setSelected(e.target.checked ? requests.map(r => r.id) : [])} /></th>}
                                {['Request', 'Property', 'Requester', 'Status', 'Requested', 'Allocated', 'Approver', 'Details'].map(h => (
                                    <th className="p-3.5 text-left text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500" key={h}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && requests.map(r => (
                                <tr key={r.id} className="border-t border-slate-100 dark:border-[#30363d]/60 hover:bg-slate-50/60 dark:hover:bg-[#21262d]/50 transition-colors">
                                    {isBulk && <td className="p-3.5"><input type="checkbox" aria-label={`Select ${r.request_no}`} disabled={loading || busy} checked={selected.includes(r.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, r.id] : prev.filter(id => id !== r.id))} /></td>}
                                    <td className="p-3.5 whitespace-nowrap font-bold text-slate-900 dark:text-white">{r.request_no}</td>
                                    <td className="p-3.5 text-slate-600 dark:text-slate-300">{r.property?.name}</td>
                                    <td className="p-3.5 text-slate-700 dark:text-slate-200 font-medium">{r.requester?.full_name || r.requester?.email}</td>
                                    <td className="p-3.5"><span className="pc-status" data-status={r.status}>{r.request_type === 'reimbursement' ? 'Historical reimbursement' : r.workflow_version === 1 && r.status === 'submitted' ? 'Needs routing reassignment' : PC_STATUS_META[r.status]?.label || r.status}</span></td>
                                    <td className="p-3.5 font-bold whitespace-nowrap tabular-nums text-slate-900 dark:text-white">{inr(r.amount_requested)}</td>
                                    <td className="p-3.5">{tab === 'allocations' ? <input className="pc-input min-w-28" aria-label={`Allocated amount ${r.request_no}`} type="number" min="0.01" max={r.amount_requested} step="0.01" value={amounts[r.id] ?? String(r.amount_requested)} onChange={e => setAmounts(prev => ({ ...prev, [r.id]: e.target.value }))} /> : inr(r.allocated_amount)}</td>
                                    <td className="p-3.5 text-slate-600 dark:text-slate-300">{r.assigned_approver?.full_name || r.assigned_approver?.email}</td>
                                    <td className="p-3.5"><Button variant="solid" size="sm" className="rounded-xl font-bold" disabled={!context} onClick={() => setDetailId(r.id)}>View</Button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {loading ? <p role="status" className="pc-empty"><Loader2 size={24} className="animate-spin text-primary" />Loading requests…</p> : !requests.length && <div className="pc-empty"><Inbox size={32} className="text-slate-400" /><h3>No requests in this queue</h3><p>{tab === 'mine' ? 'Your petty cash requests will appear here. Create a request to get started.' : 'Requests will appear here when they reach this stage.'}</p></div>}
                </div>
                <div className="flex gap-2 justify-end items-center pt-2">
                    <Button variant="solid" size="sm" disabled={loading || page <= 1} onClick={() => { setPage(p => p - 1); setSelected([]); }} className="gap-1 rounded-xl font-bold"><ChevronLeft size={14} />Previous</Button>
                    <p className="px-2 text-xs font-medium text-slate-500 dark:text-slate-400">Page {page} of {pages}</p>
                    <Button variant="solid" size="sm" disabled={loading || page >= pages} onClick={() => { setPage(p => p + 1); setSelected([]); }} className="gap-1 rounded-xl font-bold">Next<ChevronRight size={14} /></Button>
                </div>
            </>}
            {showNew && context && <NewRequestModal open properties={context.properties} organizationId={orgId} routes={context.routes} canSubmit={context.wallet.can_request} blocker={context.wallet.blocker} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); void refresh(); }} />}
            {detailId && context && <WorkflowRequestDetail key={`${orgId}:${detailId}`} context={context} id={detailId} onClose={closeDetail} onChanged={() => { void refresh(); }} />}
        </>}
    </div>;
}
