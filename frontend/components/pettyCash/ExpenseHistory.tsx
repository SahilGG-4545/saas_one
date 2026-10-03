'use client';
import { useEffect, useState } from 'react';
import { inr } from '@/frontend/lib/pettyCash/roles';
import { pcFetch, type Expense } from './workflowTypes';
export default function ExpenseHistory({ org, onOpen }: { org: string; onOpen: (id: string) => void }) {
    const [rows, setRows] = useState<(Expense & { request: { request_no: string } })[]>([]); const [error, setError] = useState(''); const [page, setPage] = useState(1); const [pages, setPages] = useState(1);
    useEffect(() => { let active = true; pcFetch<{ expenses: typeof rows; total_pages: number }>(`/api/petty-cash/expenses?org_id=${org}&page=${page}`).then(data => { if (active) { setRows(data.expenses); setPages(data.total_pages); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [org, page]);
    return <div className="space-y-3"><h2 className="text-lg font-bold">My Expenses</h2>{error && <p role="alert">{error}</p>}{!rows.length && <p>No expenses yet. Open a paid request to record a spend with proof.</p>}{rows.map(e => <div key={e.id} className="border border-border rounded-xl p-4"><p><strong>{inr(e.amount)}</strong> · {e.expense_date} · {e.vendor} · {e.description}</p><p>Proof review: {e.review_status} {e.review_remarks}</p><button className="underline" onClick={() => onOpen(e.request_id)}>View {e.request?.request_no} and proofs</button></div>)}<div className="flex gap-3"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><p>{page} / {pages}</p><button disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button></div></div>;
}
