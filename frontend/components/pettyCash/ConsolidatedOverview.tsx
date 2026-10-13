'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/frontend/components/ui/button';
import {
    Inbox,
    Loader2,
    Coins,
    CheckCircle2,
    Wallet,
    Receipt,
    Clock,
    Building2,
    User,
    AlertTriangle,
    ShieldAlert,
    TrendingUp,
    Filter,
    X,
    ChevronRight,
    ArrowUpRight,
    Check,
    Sparkles,
    Calendar,
    Search,
    ChevronLeft
} from 'lucide-react';
import { inr, PC_STATUS_META } from '@/frontend/lib/pettyCash/roles';
import { overviewGroups } from '@/frontend/lib/pettyCash/overviewGroups';
import SearchableSelect from './SearchableSelect';
import {
    overviewAnalysis,
    periodDates,
    calendarDate,
    overviewAttention,
    matchesAttention,
    type AttentionKey
} from '@/frontend/lib/pettyCash/overviewAnalysis';
import { pcFetch } from './workflowTypes';

interface Row {
    id: string;
    request_no: string;
    requester_id: string;
    requester_name: string;
    property_id: string;
    property_name: string;
    status: string;
    request_type: string;
    paid: number;
    spent: number;
    balance: number;
    unresolved_proofs: number;
    requested: number;
    allocated: number;
    approved: number;
    created_at: string;
    assigned_allocator_id?: string;
    assigned_approver_id?: string;
    assigned_allocator_name?: string;
    assigned_approver_name?: string;
}

const STAGE_CONFIG = {
    submitted: {
        step: '1',
        icon: Coins,
        color: 'text-amber-500',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
        ring: 'ring-2 ring-amber-500',
        activeBg: 'bg-amber-50/80 dark:bg-amber-950/30',
        label: 'To Allocate',
        desc: 'Awaiting allocation review'
    },
    pending_approval: {
        step: '2',
        icon: CheckCircle2,
        color: 'text-indigo-500',
        bg: 'bg-indigo-500/10',
        border: 'border-indigo-500/20',
        ring: 'ring-2 ring-indigo-500',
        activeBg: 'bg-indigo-50/80 dark:bg-indigo-950/30',
        label: 'To Approve',
        desc: 'Awaiting managerial sign-off'
    },
    approved: {
        step: '3',
        icon: Wallet,
        color: 'text-emerald-500',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/20',
        ring: 'ring-2 ring-emerald-500',
        activeBg: 'bg-emerald-50/80 dark:bg-emerald-950/30',
        label: 'To Pay',
        desc: 'Ready for treasury payout'
    },
    settlement_submitted: {
        step: '4',
        icon: Receipt,
        color: 'text-purple-500',
        bg: 'bg-purple-500/10',
        border: 'border-purple-500/20',
        ring: 'ring-2 ring-purple-500',
        activeBg: 'bg-purple-50/80 dark:bg-purple-950/30',
        label: 'Settlement Review',
        desc: 'Bills submitted for closure'
    }
} as const;

export default function ConsolidatedOverview({
    org,
    onOpen,
    countsIssue
}: {
    org: string;
    onOpen: (id: string) => void;
    countsIssue?: string;
}) {
    const [period, setPeriod] = useState('all');
    const [attention, setAttention] = useState<AttentionKey | null>(null);
    const [loading, setLoading] = useState(true);
    const [retry, setRetry] = useState(0);
    const [rows, setRows] = useState<Row[]>([]);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [property, setProperty] = useState('');
    const [status, setStatus] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [actor, setActor] = useState('');
    const [requester, setRequester] = useState('');
    const [page, setPage] = useState(1);
    const [breakdownTab, setBreakdownTab] = useState<'property' | 'requester'>('property');

    useEffect(() => {
        let active = true;
        setLoading(true);
        setRows([]);
        setError('');
        pcFetch<{ rows: Row[] }>(`/api/petty-cash/tracker?org_id=${org}`)
            .then(data => {
                if (active) {
                    setRows(
                        data.rows.map(row => ({
                            ...row,
                            requester_name: row.requester_name || 'Unnamed user',
                            property_name: row.property_name || 'Unnamed property'
                        }))
                    );
                }
            })
            .catch(e => {
                if (active) setError(e.message);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [org, retry]);

    const baseFiltered = useMemo(() => {
        return rows.filter(
            r =>
                (!property || property === r.property_id) &&
                (!requester || requester === r.requester_id) &&
                (!status || status === r.status) &&
                (!actor || actor === r.assigned_allocator_id || actor === r.assigned_approver_id) &&
                (!from || calendarDate(new Date(r.created_at)) >= from) &&
                (!to || calendarDate(new Date(r.created_at)) <= to) &&
                `${r.requester_name} ${r.request_no}`.toLowerCase().includes(search.toLowerCase())
        );
    }, [rows, property, requester, status, actor, from, to, search]);

    const notes = useMemo(() => overviewAttention(baseFiltered), [baseFiltered]);
    const filtered = useMemo(() => baseFiltered.filter(row => matchesAttention(row, attention)), [baseFiltered, attention]);
    const properties = useMemo(() => overviewGroups(filtered, 'property'), [filtered]);
    const requesters = useMemo(() => overviewGroups(filtered, 'requester'), [filtered]);

    const clearFilters = () => {
        setSearch('');
        setProperty('');
        setStatus('');
        setFrom('');
        setTo('');
        setActor('');
        setRequester('');
        setPeriod('all');
        setAttention(null);
        setPage(1);
    };

    const hasActiveFilters = Boolean(
        search || property || status || actor || requester || period !== 'all' || from || to || attention
    );

    const actors = [
        ...new Map(
            rows
                .flatMap(
                    r =>
                        [
                            [r.assigned_allocator_id, r.assigned_allocator_name],
                            [r.assigned_approver_id, r.assigned_approver_name]
                        ] as [string | undefined, string | undefined][]
                )
                .filter(([id]) => id)
        ).entries()
    ];

    const analysis = useMemo(() => overviewAnalysis(filtered), [filtered]);

    const pick = (setter: (value: string) => void) => (value: string) => {
        setter(value);
        setAttention(null);
        setPage(1);
    };

    const toggleStage = (stageStatus: string) => {
        if (status === stageStatus) {
            setStatus('');
        } else {
            setStatus(stageStatus);
            setAttention(null);
        }
        setPage(1);
    };

    const toggleAttention = (key: AttentionKey) => {
        if (attention === key) {
            setAttention(null);
        } else {
            setAttention(key);
            setStatus('');
        }
        setPage(1);
    };

    const dateError = Boolean(from && to && from > to);
    const pages = Math.max(1, Math.ceil(filtered.length / 50));
    const currentPage = Math.min(page, pages);

    // Financial calculations
    const totals = useMemo(() => {
        const getSum = (key: keyof Row) =>
            filtered.reduce((sum, r) => sum + Math.round(Number(r[key] || 0) * 100), 0) / 100;
        const requested = getSum('requested');
        const allocated = getSum('allocated');
        const approved = getSum('approved');
        const paid = getSum('paid');
        const spent = getSum('spent');
        const balance = getSum('balance');
        const proofs = filtered.reduce((sum, r) => sum + Number(r.unresolved_proofs || 0), 0);

        const spentPct = paid > 0 ? Math.min(100, Math.round((spent / paid) * 100)) : 0;
        const balancePct = paid > 0 ? Math.min(100 - spentPct, Math.round((balance / paid) * 100)) : 0;
        const pendingPct = Math.max(0, 100 - spentPct - balancePct);

        return { requested, allocated, approved, paid, spent, balance, proofs, spentPct, balancePct, pendingPct };
    }, [filtered]);

    return (
        <div className="space-y-6 min-w-0">
            {/* Header & Governance Banner */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white shadow-xl">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                            Portfolio Governance & Treasury
                        </span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-xs text-slate-300 font-medium">{filtered.length} Live Requests</span>
                    </div>
                    <h2 className="text-2xl font-black text-white tracking-tight mt-1.5">
                        Petty Cash Overview
                    </h2>
                    <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                        Monitor pre-approval pipeline, track active cash float, review proof settlements, and prevent aged blockages across properties.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <div className="px-4 py-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/10 flex items-center gap-3">
                        <Wallet className="w-5 h-5 text-emerald-400 shrink-0" />
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                                Disbursed Float
                            </div>
                            <div className="text-lg font-black text-white tabular-nums">
                                {inr(totals.paid)}
                            </div>
                        </div>
                    </div>
                    <div className="px-4 py-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/10 flex items-center gap-3">
                        <TrendingUp className="w-5 h-5 text-indigo-400 shrink-0" />
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                                Spent Utilization
                            </div>
                            <div className="text-lg font-black text-emerald-400 tabular-nums">
                                {totals.spentPct}%
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {error && (
                <div role="alert" className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-rose-900 dark:text-rose-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <AlertTriangle className="w-4 h-4 text-rose-600" />
                        <span>{error}</span>
                    </div>
                    <Button variant="solid" size="sm" onClick={() => setRetry(v => v + 1)} className="rounded-xl font-bold">
                        Retry
                    </Button>
                </div>
            )}

            {loading && (
                <div role="status" className="p-4 rounded-2xl bg-slate-50 dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300">
                    <Loader2 size={18} className="animate-spin text-primary" />
                    <span>Loading petty cash overview records…</span>
                </div>
            )}

            {/* Interactive Workflow Pipeline Navigator */}
            <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                            Workflow Stages
                        </span>
                        <span className="text-xs text-slate-400 font-medium">· Click stage to filter queue</span>
                    </div>
                    {status && (
                        <button
                            onClick={() => setStatus('')}
                            className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                        >
                            <X size={12} /> Clear stage filter
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5" aria-label="Pending workflow stages">
                    {analysis.stages.map(stage => {
                        const cfg = STAGE_CONFIG[stage.status as keyof typeof STAGE_CONFIG];
                        const isSelected = status === stage.status;
                        const Icon = cfg.icon;

                        return (
                            <button
                                key={stage.status}
                                type="button"
                                onClick={() => toggleStage(stage.status)}
                                className={`group p-4 rounded-2xl border text-left transition-all relative overflow-hidden ${
                                    isSelected
                                        ? `${cfg.ring} ${cfg.activeBg} border-transparent shadow-md`
                                        : 'bg-white dark:bg-[#161b22] border-slate-100 dark:border-[#30363d] hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-8 h-8 rounded-xl ${cfg.bg} flex items-center justify-center ${cfg.color} shrink-0`}>
                                            <Icon size={16} />
                                        </div>
                                        <div>
                                            <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                                Stage {cfg.step}
                                            </span>
                                            <span className="text-xs font-black text-slate-900 dark:text-white">
                                                {cfg.label}
                                            </span>
                                        </div>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-black tabular-nums ${
                                        stage.count > 0
                                            ? `${cfg.bg} ${cfg.color}`
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                                    }`}>
                                        {stage.count}
                                    </span>
                                </div>

                                <div className="mt-3 flex items-baseline justify-between">
                                    <div>
                                        <div className="text-2xl font-black text-slate-900 dark:text-white tabular-nums leading-none">
                                            {stage.count}
                                            <span className="text-[11px] font-medium text-slate-400 ml-1">requests</span>
                                        </div>
                                        {stage.status !== 'settlement_submitted' && (
                                            <div className="text-xs font-bold text-slate-600 dark:text-slate-300 mt-1 tabular-nums">
                                                {inr(stage.amount)}
                                            </div>
                                        )}
                                    </div>

                                    <div className={`text-[10px] font-bold uppercase tracking-wider ${
                                        isSelected ? cfg.color : 'text-slate-400 opacity-0 group-hover:opacity-100'
                                    } transition-opacity flex items-center gap-0.5`}>
                                        {isSelected ? 'Active' : 'Filter'}
                                        <ChevronRight size={10} />
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Smart Portfolio Aging & Action Center */}
            <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                        <h3 className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                            <ShieldAlert size={14} className="text-amber-600 dark:text-amber-400" />
                            Action Required & Aging Alerts
                        </h3>
                    </div>
                    {attention && (
                        <button
                            onClick={() => setAttention(null)}
                            className="text-xs font-bold text-amber-800 dark:text-amber-300 hover:underline flex items-center gap-1"
                        >
                            <X size={12} /> Show all filtered
                        </button>
                    )}
                </div>

                {countsIssue && (
                    <div className="p-2.5 rounded-xl bg-amber-100/60 dark:bg-amber-900/40 text-xs font-semibold text-amber-900 dark:text-amber-200">
                        Pending badge counts are currently in repair. Full tracker totals and report data below remain active.
                    </div>
                )}

                {/* Interactive Alert Pills */}
                <div className="flex flex-wrap gap-2 pt-1">
                    <button
                        type="button"
                        onClick={() => toggleAttention('aged')}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                            attention === 'aged'
                                ? 'bg-amber-500 text-white shadow-sm ring-2 ring-amber-400'
                                : 'bg-white/80 dark:bg-[#161b22] border border-amber-200 dark:border-amber-900/50 text-slate-800 dark:text-slate-200 hover:bg-white'
                        }`}
                    >
                        <Clock size={13} className={attention === 'aged' ? 'text-white' : 'text-amber-600'} />
                        <span>
                            <strong className="font-black tabular-nums">{analysis.sevenDays}</strong> aged 7+ days
                        </span>
                        {analysis.oldest !== null && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/10 text-current">
                                Oldest: {analysis.oldest}d
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => toggleAttention('cash')}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                            attention === 'cash'
                                ? 'bg-amber-500 text-white shadow-sm ring-2 ring-amber-400'
                                : 'bg-white/80 dark:bg-[#161b22] border border-amber-200 dark:border-amber-900/50 text-slate-800 dark:text-slate-200 hover:bg-white'
                        }`}
                    >
                        <Wallet size={13} className={attention === 'cash' ? 'text-white' : 'text-emerald-600'} />
                        <span>
                            <strong className="font-black tabular-nums">{analysis.toAccount}</strong> awaiting settlement closure
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/10 text-current">
                            Float: {inr(totals.balance)}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => toggleAttention('corrections')}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                            attention === 'corrections'
                                ? 'bg-amber-500 text-white shadow-sm ring-2 ring-amber-400'
                                : 'bg-white/80 dark:bg-[#161b22] border border-amber-200 dark:border-amber-900/50 text-slate-800 dark:text-slate-200 hover:bg-white'
                        }`}
                    >
                        <AlertTriangle size={13} className={attention === 'corrections' ? 'text-white' : 'text-rose-600'} />
                        <span>
                            <strong className="font-black tabular-nums">{analysis.corrections}</strong> rejected proofs
                        </span>
                        {analysis.corrections === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-bold">
                                Clean
                            </span>
                        )}
                    </button>
                </div>

                {/* Additional attention notes list if multiple */}
                {notes.length > 0 && (
                    <div className="pt-2 border-t border-amber-200/60 dark:border-amber-900/40 text-xs space-y-1">
                        {notes.map(note => (
                            <div key={note.key} className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                                <span className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                    <span>{note.text}</span>
                                    {note.amount !== null && (
                                        <strong className="font-bold tabular-nums text-slate-900 dark:text-white">
                                            ({inr(note.amount)})
                                        </strong>
                                    )}
                                </span>
                                <button
                                    onClick={() => toggleAttention(note.key)}
                                    className="font-bold text-amber-700 dark:text-amber-400 hover:underline shrink-0 text-[11px]"
                                >
                                    {attention === note.key ? 'Active filter' : 'Filter this alert'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Financial Capital Flow & Treasury Float Card */}
            <div className="p-6 rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                            Capital Flow & Live Float
                        </span>
                        <h3 className="text-base font-black text-slate-900 dark:text-white mt-0.5">
                            Treasury Lifecycle Breakdown
                        </h3>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>{filtered.length} total requests</span>
                        <span>·</span>
                        <span className="font-semibold text-emerald-600">{totals.spentPct}% spent rate</span>
                    </div>
                </div>

                {/* Visual Multi-Segment Utilization Bar */}
                <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <span>Disbursed Float Utilization: {inr(totals.paid)}</span>
                        <span>{totals.spentPct}% spent</span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex shadow-inner">
                        <div
                            style={{ width: `${totals.spentPct}%` }}
                            className="h-full bg-emerald-500 transition-all duration-500"
                            title={`Spent: ${inr(totals.spent)} (${totals.spentPct}%)`}
                        />
                        <div
                            style={{ width: `${totals.balancePct}%` }}
                            className="h-full bg-sky-500 transition-all duration-500"
                            title={`Remaining Balance: ${inr(totals.balance)} (${totals.balancePct}%)`}
                        />
                        <div
                            style={{ width: `${totals.pendingPct}%` }}
                            className="h-full bg-amber-400/80 transition-all duration-500"
                            title={`Pending / In Flight: ${totals.pendingPct}%`}
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                        <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                            <span>Verified Spent: <strong className="text-slate-900 dark:text-white">{inr(totals.spent)}</strong> ({totals.spentPct}%)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                            <span>Float in Hand: <strong className="text-slate-900 dark:text-white">{inr(totals.balance)}</strong> ({totals.balancePct}%)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                            <span>Pending In-Flight</span>
                        </div>
                    </div>
                </div>

                {/* Financial KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                    <div className="p-4 rounded-2xl bg-slate-50/70 dark:bg-[#1c2128] border border-slate-100 dark:border-[#30363d]">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                            Requested
                        </span>
                        <div className="text-lg font-black text-slate-900 dark:text-white tabular-nums mt-1">
                            {inr(totals.requested)}
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-0.5">Baseline demand</span>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-50/70 dark:bg-[#1c2128] border border-slate-100 dark:border-[#30363d]">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                            Allocated
                        </span>
                        <div className="text-lg font-black text-slate-900 dark:text-white tabular-nums mt-1">
                            {inr(totals.allocated)}
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-0.5">Stage 1 approved</span>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-50/70 dark:bg-[#1c2128] border border-slate-100 dark:border-[#30363d]">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                            Approved
                        </span>
                        <div className="text-lg font-black text-slate-900 dark:text-white tabular-nums mt-1">
                            {inr(totals.approved)}
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-0.5">Stage 2 approved</span>
                    </div>

                    <div className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                            Disbursed (Paid)
                        </span>
                        <div className="text-lg font-black text-emerald-800 dark:text-emerald-300 tabular-nums mt-1">
                            {inr(totals.paid)}
                        </div>
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block mt-0.5">Transferred to staff</span>
                    </div>

                    <div className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                            Verified Spent
                        </span>
                        <div className="text-lg font-black text-emerald-800 dark:text-emerald-300 tabular-nums mt-1">
                            {inr(totals.spent)}
                        </div>
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block mt-0.5">{totals.spentPct}% utilized</span>
                    </div>

                    <div className="p-4 rounded-2xl bg-sky-50/60 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40">
                        <span className="text-[10px] font-black uppercase tracking-wider text-sky-700 dark:text-sky-400 block">
                            Remaining Float
                        </span>
                        <div className="text-lg font-black text-sky-800 dark:text-sky-300 tabular-nums mt-1">
                            {inr(totals.balance)}
                        </div>
                        <span className="text-[10px] text-sky-600 dark:text-sky-400 block mt-0.5">Cash in hand</span>
                    </div>
                </div>
            </div>

            {/* Filter Toolbar */}
            <div data-overview-filters className="p-4 rounded-2xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Filter size={14} className="text-primary" />
                        <span className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                            Search & Filter Controls
                        </span>
                        {hasActiveFilters && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-primary/10 text-primary">
                                Filters active
                            </span>
                        )}
                    </div>
                    {hasActiveFilters && (
                        <Button
                            variant="solid"
                            size="sm"
                            onClick={clearFilters}
                            className="rounded-xl font-bold text-xs gap-1 h-8"
                        >
                            <X size={12} /> Clear all filters
                        </Button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                    {/* Search box */}
                    <div className="relative flex-1 min-w-[200px] max-w-xs">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            className="pc-input w-full rounded-xl pl-9 pr-3 text-xs"
                            style={{ height: 38, marginTop: 0 }}
                            aria-label="Filter requester"
                            placeholder="Search requester or request no…"
                            value={search}
                            onChange={e => pick(setSearch)(e.target.value)}
                        />
                    </div>

                    {/* Filter Dropdowns */}
                    <div className="flex-1 min-w-[150px] max-w-[200px]">
                        <SearchableSelect
                            compact
                            label="Property"
                            value={property}
                            options={[
                                { value: '', label: 'All properties' },
                                ...[...new Map(rows.map(r => [r.property_id, r.property_name])).entries()].map(
                                    ([value, label]) => ({ value, label })
                                )
                            ]}
                            onChange={pick(setProperty)}
                        />
                    </div>

                    <div className="flex-1 min-w-[150px] max-w-[190px]">
                        <SearchableSelect
                            compact
                            label="Status"
                            value={status}
                            options={[
                                { value: '', label: 'All statuses' },
                                ...Object.entries(PC_STATUS_META).map(([value, item]) => ({
                                    value,
                                    label: item.label
                                }))
                            ]}
                            onChange={pick(setStatus)}
                        />
                    </div>

                    <div className="flex-1 min-w-[150px] max-w-[200px]">
                        <SearchableSelect
                            compact
                            label="Requester"
                            value={requester}
                            options={[
                                { value: '', label: 'All requesters' },
                                ...[...new Map(rows.map(r => [r.requester_id, r.requester_name])).entries()].map(
                                    ([value, label]) => ({
                                        value,
                                        label,
                                        searchText: value,
                                        description: value.slice(-8)
                                    })
                                )
                            ]}
                            onChange={pick(setRequester)}
                        />
                    </div>

                    <div className="flex-1 min-w-[150px] max-w-[200px]">
                        <SearchableSelect
                            compact
                            label="Assigned actor"
                            value={actor}
                            options={[
                                { value: '', label: 'All assigned actors' },
                                ...actors.map(([value, name]) => ({
                                    value: value!,
                                    label: name || `Assigned user ${value!.slice(-8)}`,
                                    searchText: value
                                }))
                            ]}
                            onChange={pick(setActor)}
                        />
                    </div>

                    <div className="flex-1 min-w-[140px] max-w-[180px]">
                        <SearchableSelect
                            compact
                            label="Request date"
                            value={period}
                            options={[
                                { value: 'all', label: 'All dates' },
                                { value: '7days', label: 'Last 7 days' },
                                { value: '30days', label: 'Last 30 days' },
                                { value: 'month', label: 'This month' },
                                { value: 'custom', label: 'Custom range' }
                            ]}
                            onChange={value => {
                                setAttention(null);
                                setPeriod(value);
                                if (value !== 'custom') {
                                    const dates = periodDates(value);
                                    setFrom(dates.from);
                                    setTo(dates.to);
                                }
                                setPage(1);
                            }}
                        />
                    </div>
                </div>

                {period === 'custom' && (
                    <div className="flex flex-wrap gap-3 items-center text-xs pt-1 border-t border-slate-100 dark:border-[#30363d]/60">
                        <label className="flex items-center gap-1.5 font-bold text-slate-600 dark:text-slate-300">
                            From{' '}
                            <input
                                aria-label="From request date"
                                type="date"
                                className="pc-input rounded-xl"
                                style={{ height: 34, marginTop: 0 }}
                                value={from}
                                onChange={e => pick(setFrom)(e.target.value)}
                            />
                        </label>
                        <label className="flex items-center gap-1.5 font-bold text-slate-600 dark:text-slate-300">
                            To{' '}
                            <input
                                aria-label="To request date"
                                type="date"
                                className="pc-input rounded-xl"
                                style={{ height: 34, marginTop: 0 }}
                                value={to}
                                onChange={e => pick(setTo)(e.target.value)}
                            />
                        </label>
                        {dateError && (
                            <p role="alert" className="text-rose-600 font-bold">
                                From date must be before or equal to To date.
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Grouped Breakdown: By Property & By Requester */}
            <div className="p-6 rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                            Comparative Distribution
                        </span>
                        <h3 className="text-base font-black text-slate-900 dark:text-white mt-0.5">
                            Float & Spend Distribution
                        </h3>
                    </div>

                    {/* View Switcher */}
                    <div className="flex rounded-xl bg-slate-100 dark:bg-[#1c2128] p-1 border border-slate-200/60 dark:border-[#30363d] self-start sm:self-auto">
                        <button
                            type="button"
                            onClick={() => setBreakdownTab('property')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                breakdownTab === 'property'
                                    ? 'bg-white dark:bg-[#21262d] text-slate-900 dark:text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Building2 size={13} />
                            <span>By Property ({properties.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setBreakdownTab('requester')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                breakdownTab === 'requester'
                                    ? 'bg-white dark:bg-[#21262d] text-slate-900 dark:text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <User size={13} />
                            <span>By Requester ({requesters.length})</span>
                        </button>
                    </div>
                </div>

                {/* Breakdown Grid Cards */}
                {breakdownTab === 'property' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {properties.map(grp => {
                            const isSelected = property === grp.id;
                            const spentRatio = grp.paid > 0 ? Math.min(100, Math.round((grp.spent / grp.paid) * 100)) : 0;

                            return (
                                <div
                                    key={grp.id}
                                    className={`p-4 rounded-2xl border transition-all ${
                                        isSelected
                                            ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/20'
                                            : 'bg-slate-50/60 dark:bg-[#1c2128]/60 border-slate-200/60 dark:border-[#30363d] hover:border-slate-300'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
                                                <Building2 size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <button
                                                    onClick={() => pick(setProperty)(isSelected ? '' : grp.id)}
                                                    className="font-black text-slate-900 dark:text-white hover:text-primary transition-colors text-left text-sm truncate block"
                                                    title={grp.name}
                                                >
                                                    {grp.name}
                                                </button>
                                                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                                    <span>{grp.requests} requests</span>
                                                    <span>·</span>
                                                    <span>{grp.pending} pending</span>
                                                    {grp.proofs > 0 && (
                                                        <span className="text-rose-500 font-bold">· {grp.proofs} proof issues</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => pick(setProperty)(isSelected ? '' : grp.id)}
                                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shrink-0 ${
                                                isSelected
                                                    ? 'bg-primary text-white'
                                                    : 'bg-white dark:bg-[#21262d] border border-slate-200 dark:border-[#30363d] text-slate-600 dark:text-slate-300 hover:border-primary/50'
                                            }`}
                                        >
                                            {isSelected ? 'Filtered' : 'Filter'}
                                        </button>
                                    </div>

                                    {/* Mini Financial Summary */}
                                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-200/60 dark:border-[#30363d]">
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Received</span>
                                            <span className="text-xs font-black text-slate-900 dark:text-white tabular-nums">{inr(grp.paid)}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Spent</span>
                                            <span className="text-xs font-bold text-emerald-600 tabular-nums">{inr(grp.spent)}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Balance</span>
                                            <span className="text-xs font-black text-sky-600 tabular-nums">{inr(grp.balance)}</span>
                                        </div>
                                    </div>

                                    {/* Mini Progress Bar */}
                                    <div className="mt-2.5 h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden flex">
                                        <div style={{ width: `${spentRatio}%` }} className="h-full bg-emerald-500" />
                                        <div style={{ width: `${100 - spentRatio}%` }} className="h-full bg-sky-500" />
                                    </div>
                                </div>
                            );
                        })}
                        {!properties.length && (
                            <p className="p-6 text-xs text-slate-400 text-center col-span-2">No matching properties for this filter.</p>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {requesters.map(grp => {
                            const isSelected = requester === grp.id;
                            const spentRatio = grp.paid > 0 ? Math.min(100, Math.round((grp.spent / grp.paid) * 100)) : 0;

                            return (
                                <div
                                    key={grp.id}
                                    className={`p-4 rounded-2xl border transition-all ${
                                        isSelected
                                            ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/20'
                                            : 'bg-slate-50/60 dark:bg-[#1c2128]/60 border-slate-200/60 dark:border-[#30363d] hover:border-slate-300'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500 shrink-0">
                                                <User size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <button
                                                    onClick={() => pick(setRequester)(isSelected ? '' : grp.id)}
                                                    className="font-black text-slate-900 dark:text-white hover:text-primary transition-colors text-left text-sm truncate block"
                                                    title={grp.name}
                                                >
                                                    {grp.name}
                                                </button>
                                                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                                    <span>{grp.requests} requests</span>
                                                    <span>·</span>
                                                    <span>{grp.pending} pending</span>
                                                    {grp.proofs > 0 && (
                                                        <span className="text-rose-500 font-bold">· {grp.proofs} proof issues</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => pick(setRequester)(isSelected ? '' : grp.id)}
                                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shrink-0 ${
                                                isSelected
                                                    ? 'bg-primary text-white'
                                                    : 'bg-white dark:bg-[#21262d] border border-slate-200 dark:border-[#30363d] text-slate-600 dark:text-slate-300 hover:border-primary/50'
                                            }`}
                                        >
                                            {isSelected ? 'Filtered' : 'Filter'}
                                        </button>
                                    </div>

                                    {/* Mini Financial Summary */}
                                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-200/60 dark:border-[#30363d]">
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Received</span>
                                            <span className="text-xs font-black text-slate-900 dark:text-white tabular-nums">{inr(grp.paid)}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Spent</span>
                                            <span className="text-xs font-bold text-emerald-600 tabular-nums">{inr(grp.spent)}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Balance</span>
                                            <span className="text-xs font-black text-sky-600 tabular-nums">{inr(grp.balance)}</span>
                                        </div>
                                    </div>

                                    {/* Mini Progress Bar */}
                                    <div className="mt-2.5 h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden flex">
                                        <div style={{ width: `${spentRatio}%` }} className="h-full bg-emerald-500" />
                                        <div style={{ width: `${100 - spentRatio}%` }} className="h-full bg-sky-500" />
                                    </div>
                                </div>
                            );
                        })}
                        {!requesters.length && (
                            <p className="p-6 text-xs text-slate-400 text-center col-span-2">No matching requesters for this filter.</p>
                        )}
                    </div>
                )}
            </div>

            {/* Main Interactive Requests Table */}
            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                            Requests Ledger
                        </span>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            Showing {(currentPage - 1) * 50 + 1}–{Math.min(currentPage * 50, filtered.length)} of {filtered.length} requests
                        </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                        <Button
                            variant="solid"
                            size="sm"
                            className="rounded-xl font-bold h-8 text-xs gap-1"
                            disabled={loading || currentPage === 1}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                        >
                            <ChevronLeft size={13} /> Prev
                        </Button>
                        <span className="text-slate-500 px-1 font-medium">
                            {currentPage} / {pages}
                        </span>
                        <Button
                            variant="solid"
                            size="sm"
                            className="rounded-xl font-bold h-8 text-xs gap-1"
                            disabled={loading || currentPage === pages}
                            onClick={() => setPage(p => Math.min(pages, p + 1))}
                        >
                            Next <ChevronRight size={13} />
                        </Button>
                    </div>
                </div>

                <div className="pc-table-wrap rounded-2xl border border-slate-200/80 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[850px]">
                            <thead>
                                <tr className="bg-slate-50/70 dark:bg-[#1c2128] border-b border-slate-100 dark:border-[#30363d]">
                                    {[
                                        'Request No',
                                        'Date',
                                        'Requester',
                                        'Property',
                                        'Status',
                                        'Disbursed',
                                        'Spent',
                                        'Remaining',
                                        'Proof Issues',
                                        'Action'
                                    ].map(h => (
                                        <th
                                            key={h}
                                            className="text-left p-3.5 text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 whitespace-nowrap"
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered
                                    .slice((currentPage - 1) * 50, currentPage * 50)
                                    .map(r => (
                                        <tr
                                            key={r.id}
                                            className="border-t border-slate-100 dark:border-[#30363d]/60 hover:bg-slate-50/60 dark:hover:bg-[#21262d]/50 transition-colors"
                                        >
                                            <td className="p-3.5 whitespace-nowrap">
                                                <button
                                                    className="font-black text-primary hover:underline flex items-center gap-1 group"
                                                    onClick={() => onOpen(r.id)}
                                                >
                                                    <span>{r.request_no}</span>
                                                    <ArrowUpRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                                </button>
                                            </td>
                                            <td className="p-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                                                {new Date(r.created_at).toLocaleDateString('en-IN', {
                                                    day: 'numeric',
                                                    month: 'short',
                                                    year: 'numeric'
                                                })}
                                            </td>
                                            <td className="p-3.5 font-bold text-slate-800 dark:text-slate-200">
                                                {r.requester_name}
                                            </td>
                                            <td className="p-3.5 text-slate-600 dark:text-slate-300">
                                                {r.property_name}
                                            </td>
                                            <td className="p-3.5 whitespace-nowrap">
                                                <span className="pc-status" data-status={r.status}>
                                                    {PC_STATUS_META[r.status]?.label || r.status}
                                                </span>
                                            </td>
                                            <td className="p-3.5 tabular-nums font-semibold text-slate-900 dark:text-white">
                                                {inr(r.paid)}
                                            </td>
                                            <td className="p-3.5 tabular-nums text-emerald-600 font-medium">
                                                {inr(r.spent)}
                                            </td>
                                            <td className="p-3.5 font-black text-slate-900 dark:text-white tabular-nums">
                                                {inr(r.balance)}
                                            </td>
                                            <td className="p-3.5">
                                                {r.unresolved_proofs > 0 ? (
                                                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600">
                                                        {r.unresolved_proofs} issue{r.unresolved_proofs > 1 ? 's' : ''}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-slate-400">—</span>
                                                )}
                                            </td>
                                            <td className="p-3.5">
                                                <Button
                                                    variant="solid"
                                                    size="sm"
                                                    className="rounded-xl font-bold text-xs h-7 px-3"
                                                    onClick={() => onOpen(r.id)}
                                                >
                                                    View
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>

                    {!loading && !error && !filtered.length && (
                        <div className="pc-empty p-8 text-center space-y-2">
                            <Inbox size={36} className="text-slate-400 mx-auto" />
                            <h3 className="font-bold text-slate-800 dark:text-white">No matching requests found</h3>
                            <p className="text-xs text-slate-500 max-w-sm mx-auto">
                                No requests match your currently selected filters. Clear the filters or search term to see records.
                            </p>
                            {hasActiveFilters && (
                                <Button
                                    variant="solid"
                                    size="sm"
                                    onClick={clearFilters}
                                    className="mt-3 rounded-xl font-bold text-xs"
                                >
                                    Clear all filters
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
