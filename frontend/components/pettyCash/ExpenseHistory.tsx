'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, ReceiptText } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { inr } from '@/frontend/lib/pettyCash/roles';
import { pcFetch, type Expense } from './workflowTypes';
export default function ExpenseHistory({ org, onOpen }: { org: string; onOpen: (id: string) => void }) {
    const [rows, setRows] = useState<(Expense & { request: { request_no: string } })[]>([]);
    const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [retry, setRetry] = useState(0);
    useEffect(() => {
        let active = true; setLoading(true); setError('');
        pcFetch<{ expenses: typeof rows; total_pages: number }>(`/api/petty-cash/expenses?org_id=${org}&page=${page}`)
            .then(data => { if (active) { setRows(data.expenses); setPages(Math.max(1, data.total_pages)); } })
            .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load expenses'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [org, page, retry]);
    return <div className="space-y-4">
        <div className="pc-panel">
            <div className="pc-panel-heading"><div className="pc-icon-tile"><ReceiptText size={20} /></div><div><h2 className="font-semibold">My Expenses</h2><p className="text-xs text-text-secondary mt-1">Your recorded spends and proof review status.</p></div></div>
            {error ? <div role="alert" className="pc-alert m-4 flex flex-wrap justify-between items-center"><span>{error}</span><Button variant="solid" size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button></div> : loading ? <p role="status" className="pc-empty"><Loader2 size={24} className="animate-spin" />Loading expenses…</p> : !rows.length ? <div className="pc-empty"><ReceiptText size={28} /><h3>No expenses yet</h3><p>Open a paid request to record a spend with proof.</p></div> : <div className="divide-y divide-border">{rows.map(expense => <div key={expense.id} className="p-5 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2"><div className="flex flex-wrap items-center gap-3"><strong className="text-lg tabular-nums">{inr(expense.amount)}</strong><span className="pc-status" data-status={expense.review_status}>{expense.review_status.replaceAll('_', ' ')}</span></div><p className="text-sm break-words">{expense.description}</p><p className="text-xs text-text-secondary">{expense.expense_date.slice(0, 10)} · {expense.vendor}</p>{expense.review_remarks && <p className="text-xs text-text-secondary break-words">Review: {expense.review_remarks}</p>}</div>
                <Button variant="solid" size="sm" onClick={() => onOpen(expense.request_id)}>View {expense.request?.request_no} and proofs</Button>
            </div>)}</div>}
        </div>
        <div className="flex items-center justify-end gap-2"><Button variant="solid" size="sm" className="gap-1" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={14} />Previous</Button><p className="text-xs text-text-secondary px-2">Page {page} of {pages}</p><Button variant="solid" size="sm" className="gap-1" disabled={loading || page >= pages} onClick={() => setPage(value => value + 1)}>Next<ChevronRight size={14} /></Button></div>
    </div>;
}
