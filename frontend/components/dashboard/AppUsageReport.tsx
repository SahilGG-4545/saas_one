'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Info, Loader2, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

/**
 * App Usage Report (Org Super Admin → Reports → App usage).
 *
 * Every module is scored against its own rhythm (see /api/reports/app-usage), so the
 * grid compares adoption fairly across modules and properties; raw action counts are
 * one toggle away.
 */

type Cadence = 'scheduled' | 'daily' | 'weekly' | 'monthly';

interface Cell { actions: number; pct: number | null; detail: string }
interface UsageUser {
    userId: string; name: string; email: string | null; role: string | null; propertyId: string | null;
    byModule: Record<string, number>; total: number; activeDays: number; lastActive: string | null;
}
interface Report {
    range: { from: string; to: string; days: number; weeks: number; months: number };
    properties: { id: string; name: string }[];
    modules: { key: string; label: string; cadence: Cadence }[];
    cells: Record<string, Record<string, Cell>>;
    orgWide: { key: string; label: string; actions: number; users: number | null; available: boolean }[];
    users: UsageUser[];
    daily: { date: string; activeUsers: number; actions: number }[];
    unavailable: string[];
    truncated: string[];
    generatedAt: string;
}

type Preset = '7' | '30' | 'mtd' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
    { id: '7', label: 'Last 7 days' },
    { id: '30', label: 'Last 30 days' },
    { id: 'mtd', label: 'This month' },
    { id: 'custom', label: 'Custom' },
];

const CADENCE_LABEL: Record<Cadence, string> = { scheduled: 'Scheduled', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const CADENCE_RULE: Record<Cadence, string> = {
    scheduled: 'completed ÷ scheduled',
    daily: 'days with an entry ÷ days in range',
    weekly: 'weeks with an entry ÷ weeks in range',
    monthly: 'months submitted ÷ months in range',
};

const ORG_WIDE = 'org';

function istToday(): string {
    return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
function shiftDay(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
function rangeFor(preset: Preset, custom: { from: string; to: string }): { from: string; to: string } {
    const to = istToday();
    if (preset === '7') return { from: shiftDay(to, -6), to };
    if (preset === 'mtd') return { from: `${to.slice(0, 8)}01`, to };
    if (preset === 'custom') return custom;
    return { from: shiftDay(to, -29), to };
}
function fmtDay(day: string | null, withYear = false): string {
    if (!day) return '-';
    return new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}
function fmtRole(role: string | null): string {
    if (!role) return '';
    return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
const n = (v: number) => v.toLocaleString('en-IN');

/** Same six steps for adoption % and for counts scaled within a module. */
function shade(pct: number): string {
    if (pct >= 90) return 'bg-blue-700 text-white';
    if (pct >= 75) return 'bg-blue-500 text-white';
    if (pct >= 60) return 'bg-blue-300 text-slate-900';
    if (pct >= 40) return 'bg-blue-200 text-slate-900';
    if (pct >= 20) return 'bg-blue-100 text-slate-900';
    return 'bg-blue-50 text-slate-900';
}
const NOT_USED_STYLE: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 4px, rgba(148,163,184,0.35) 4px 5px)',
};

function isUsed(c: Cell | undefined): boolean {
    return !!c && (c.actions > 0 || (c.pct ?? 0) > 0);
}

export default function AppUsageReport({ orgId }: { orgId: string }) {
    const [preset, setPreset] = useState<Preset>('30');
    const [custom, setCustom] = useState(() => ({ from: shiftDay(istToday(), -29), to: istToday() }));
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [view, setView] = useState<'pct' | 'count'>('pct');
    const [focusProp, setFocusProp] = useState('');
    const [highlight, setHighlight] = useState<string | null>(null);
    const [userProp, setUserProp] = useState('all');
    const [userModule, setUserModule] = useState('all');
    const [exporting, setExporting] = useState(false);
    const focusRef = useRef<HTMLDivElement>(null);

    const range = rangeFor(preset, custom);

    const load = useCallback(async () => {
        if (!orgId || !range.from || !range.to) return;
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/reports/app-usage?orgId=${orgId}&from=${range.from}&to=${range.to}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Could not load the report');
            setData(json);
            setFocusProp(prev => (prev && json.properties.some((p: { id: string }) => p.id === prev) ? prev : json.properties[0]?.id || ''));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the report');
        } finally {
            setLoading(false);
        }
    }, [orgId, range.from, range.to]);

    useEffect(() => { load(); }, [load]);

    const derived = useMemo(() => {
        if (!data) return null;
        const usedPcts: number[] = [];
        let notUsed = 0;
        let actions = 0;
        const readable = data.modules.filter(m => !data.unavailable.includes(m.key));
        data.properties.forEach(p => readable.forEach(m => {
            const c = data.cells[p.id]?.[m.key];
            actions += c?.actions || 0;
            if (isUsed(c) && c?.pct !== null && c?.pct !== undefined) usedPcts.push(c.pct);
            else if (!isUsed(c)) notUsed++;
        }));
        data.orgWide.forEach(o => { actions += o.actions; });
        const avgAdoption = usedPcts.length ? Math.round(usedPcts.reduce((a, b) => a + b, 0) / usedPcts.length) : 0;

        const moduleAvg = data.modules.map(m => {
            const vals = data.properties.map(p => data.cells[p.id]?.[m.key]).filter(c => isUsed(c) && c?.pct !== null).map(c => c!.pct as number);
            return { m, avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, props: vals.length };
        }).filter(x => x.avg !== null).sort((a, b) => (a.avg as number) - (b.avg as number));

        const activeUsers = new Set(data.users.filter(u => u.activeDays > 0).map(u => u.userId)).size;
        const colMax: Record<string, number> = {};
        data.modules.forEach(m => { colMax[m.key] = Math.max(1, ...data.properties.map(p => data.cells[p.id]?.[m.key]?.actions || 0)); });

        const alerts: { level: 'crit' | 'warn'; label: string; text: string; pct: number }[] = [];
        data.properties.forEach(p => data.modules.forEach(m => {
            const c = data.cells[p.id]?.[m.key];
            if (isUsed(c) && c?.pct !== null && (c?.pct as number) < 50) {
                alerts.push({ level: (c?.pct as number) < 35 ? 'crit' : 'warn', label: `${p.name} · ${m.label}`, text: `${c?.pct}%. ${c?.detail}.`, pct: c?.pct as number });
            }
        }));
        alerts.sort((a, b) => a.pct - b.pct);

        return { avgAdoption, notUsed, actions, weakest: moduleAvg[0] || null, activeUsers, colMax, alerts };
    }, [data]);

    const propName = useCallback((id: string | null) => {
        if (!id) return 'Org-wide';
        return data?.properties.find(p => p.id === id)?.name || 'Property';
    }, [data]);

    const moduleLabel = useCallback((key: string) => {
        return data?.modules.find(m => m.key === key)?.label || data?.orgWide.find(o => o.key === key)?.label || key;
    }, [data]);

    const topUsers = useCallback((pid: string, mod: string, count: number) => {
        if (!data) return [];
        return data.users
            .filter(u => u.propertyId === pid && (u.byModule[mod] || 0) > 0)
            .sort((a, b) => b.byModule[mod] - a.byModule[mod])
            .slice(0, count);
    }, [data]);

    const pickCell = (pid: string, mod: string) => {
        setFocusProp(pid);
        setHighlight(mod);
        requestAnimationFrame(() => focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    const handleExport = useCallback(async () => {
        if (!data) return;
        setExporting(true);
        try {
            const XLSX = await import('xlsx');
            const wb = XLSX.utils.book_new();
            const add = (name: string, rows: Record<string, string | number>[]) =>
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name.slice(0, 31));
            const grid = (pick: (c: Cell | undefined) => string | number) => data.properties.map(p => {
                const row: Record<string, string | number> = { Property: p.name };
                data.modules.forEach(m => { row[`${m.label} (${CADENCE_LABEL[m.cadence]})`] = pick(data.cells[p.id]?.[m.key]); });
                return row;
            });
            add('Adoption %', grid(c => (isUsed(c) && c?.pct !== null ? (c?.pct as number) : 'Not used')));
            add('Actions', grid(c => c?.actions || 0));
            add('Users', data.users.map(u => {
                const row: Record<string, string | number> = {
                    Name: u.name, Email: u.email || '', Role: fmtRole(u.role), Property: propName(u.propertyId),
                    'Total actions': u.total, 'Active days': u.activeDays, 'Last active': u.lastActive || '',
                };
                [...data.modules, ...data.orgWide.filter(o => o.users !== null)].forEach(m => { row[m.label] = u.byModule[m.key] || 0; });
                return row;
            }));
            add('Daily', data.daily.map(d => ({ Date: d.date, 'Active users': d.activeUsers, Actions: d.actions })));
            add('Org-wide', data.orgWide.map(o => ({ Module: o.label, Actions: o.actions, Users: o.users ?? 'Not tracked' })));
            XLSX.writeFile(wb, `App_Usage_${data.range.from}_to_${data.range.to}.xlsx`);
        } catch (e) {
            console.error('[AppUsageReport] export error:', e);
        } finally {
            setExporting(false);
        }
    }, [data, propName]);

    // ── Render ──────────────────────────────────────────────────────────────
    const header = (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
                <h2 className="text-xl font-black text-slate-900">App Usage</h2>
                <p className="text-sm text-slate-500">
                    How well each property uses each module, and who does the work.
                    {data && <> {fmtDay(data.range.from, true)} to {fmtDay(data.range.to, true)} · {data.range.days} days</>}
                </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Date range">
                    {PRESETS.map(p => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => setPreset(p.id)}
                            aria-pressed={preset === p.id}
                            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${preset === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
                {preset === 'custom' && (
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                        <input id="usage-from" type="date" value={custom.from} max={custom.to} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-800" aria-label="From date" />
                        <span>to</span>
                        <input id="usage-to" type="date" value={custom.to} min={custom.from} max={istToday()} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-800" aria-label="To date" />
                    </div>
                )}
                <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
                <button type="button" onClick={handleExport} disabled={!data || exporting} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-text-inverse disabled:opacity-50">
                    {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export to Excel
                </button>
            </div>
        </div>
    );

    if (loading && !data) {
        return <div className="space-y-6">{header}<div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></div>;
    }
    if (error && !data) {
        return (
            <div className="space-y-6">
                {header}
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-6 text-sm font-semibold text-rose-700">{error}</div>
            </div>
        );
    }
    if (!data || !derived) return null;

    const focusRows = data.modules
        .map(m => ({ m, c: data.cells[focusProp]?.[m.key] }))
        .sort((a, b) => (isUsed(b.c) ? (b.c?.pct ?? -1) : -2) - (isUsed(a.c) ? (a.c?.pct ?? -1) : -2));

    const userList = data.users
        .filter(u => userProp === 'all' || (userProp === ORG_WIDE ? u.propertyId === null : u.propertyId === userProp))
        .map(u => ({ u, score: userModule === 'all' ? u.total : (u.byModule[userModule] || 0) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
    const userMax = userList[0]?.score || 1;
    const chipModules = [...data.modules, ...data.orgWide.filter(o => o.available && o.users !== null)];

    return (
        <div className="space-y-6">
            {header}
            {error && <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">{error}</div>}

            {/* KPIs */}
            <div className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${loading ? 'opacity-60' : ''}`}>
                {[
                    { label: 'Average adoption', value: `${derived.avgAdoption}%`, sub: `Across modules in use · ${derived.notUsed} property-module pairs not used` },
                    { label: 'Active users', value: n(derived.activeUsers), sub: `People with at least one action in ${data.range.days} days` },
                    { label: 'Actions logged', value: n(derived.actions), sub: `${data.properties.length} properties, ${data.modules.length + data.orgWide.length} modules` },
                    { label: 'Weakest module', value: derived.weakest?.m.label || '-', sub: derived.weakest ? `${derived.weakest.avg}% average where used (${derived.weakest.props} properties)` : 'Not enough data' },
                ].map(k => (
                    <div key={k.label} className="rounded-2xl border border-slate-100 bg-white p-4">
                        <p className="text-xs font-semibold text-slate-500">{k.label}</p>
                        <p className="mt-1 truncate text-2xl font-black text-slate-900">{k.value}</p>
                        <p className="mt-1 text-xs text-slate-400">{k.sub}</p>
                    </div>
                ))}
            </div>

            {/* Adoption grid */}
            <section className={`rounded-2xl border border-slate-100 bg-white p-4 ${loading ? 'opacity-60' : ''}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-black text-slate-900">Module adoption by property</h3>
                    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Grid shows">
                        {(['pct', 'count'] as const).map(v => (
                            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                                className={`rounded-lg px-3 py-1 text-xs font-bold ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                                {v === 'pct' ? 'Adoption %' : 'Action count'}
                            </button>
                        ))}
                    </div>
                </div>
                <p className="mb-3 text-xs text-slate-500">
                    {view === 'pct'
                        ? 'Each cell scores the module against its own rhythm, so every cell is on the same 0 to 100% scale. Click a cell to look inside that property.'
                        : 'Raw action counts. Daily modules will always show bigger numbers than monthly ones, so compare properties down a column, not modules across a row.'}
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] border-separate" style={{ borderSpacing: 3 }}>
                        <thead>
                            <tr>
                                <th className="sticky left-0 z-10 bg-white px-2 text-left text-xs font-bold text-slate-500">Property</th>
                                {data.modules.map(m => (
                                    <th key={m.key} className="px-1 align-bottom text-[11px] font-bold leading-tight text-slate-600">
                                        {m.label}
                                        <span className="block text-[9px] font-semibold uppercase tracking-wider text-slate-400">{CADENCE_LABEL[m.cadence]}</span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.properties.map(p => (
                                <tr key={p.id}>
                                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 text-left text-xs font-bold text-slate-700">{p.name}</th>
                                    {data.modules.map(m => {
                                        const c = data.cells[p.id]?.[m.key];
                                        const selected = focusProp === p.id && highlight === m.key;
                                        const unavailable = data.unavailable.includes(m.key);
                                        const title = `${p.name} · ${m.label}\n${c?.detail || ''}\n${n(c?.actions || 0)} actions`;
                                        if (unavailable || !isUsed(c)) {
                                            return (
                                                <td key={m.key} title={unavailable ? 'Data not available on this deployment' : title}>
                                                    <button type="button" onClick={() => pickCell(p.id, m.key)} style={NOT_USED_STYLE}
                                                        className={`w-full rounded-md px-1 py-2 text-[11px] font-bold text-rose-600 ${selected ? 'ring-2 ring-slate-900' : ''}`}>
                                                        {unavailable ? 'No data' : c?.pct === null && m.cadence === 'scheduled' ? 'None due' : 'Not used'}
                                                    </button>
                                                </td>
                                            );
                                        }
                                        const scale = view === 'pct' ? (c?.pct ?? 0) : ((c?.actions || 0) / derived.colMax[m.key]) * 100;
                                        return (
                                            <td key={m.key} title={title}>
                                                <button type="button" onClick={() => pickCell(p.id, m.key)}
                                                    className={`w-full rounded-md px-1 py-2 font-mono text-xs font-bold tabular-nums ${shade(scale)} ${selected ? 'ring-2 ring-slate-900' : ''}`}>
                                                    {view === 'pct' ? (c?.pct === null ? '-' : `${c?.pct}%`) : n(c?.actions || 0)}
                                                </button>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                        {view === 'pct' ? '0%' : 'Fewer'}
                        {['bg-blue-50', 'bg-blue-100', 'bg-blue-200', 'bg-blue-300', 'bg-blue-500', 'bg-blue-700'].map(c => <i key={c} className={`inline-block h-2.5 w-4 rounded-sm ${c}`} />)}
                        {view === 'pct' ? '100%' : 'More, within each module'}
                    </span>
                    <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm" style={NOT_USED_STYLE} /> Not used in this period</span>
                    <span className="inline-flex items-center gap-1"><Info className="h-3 w-3" /> Scheduled: {CADENCE_RULE.scheduled} · Daily: {CADENCE_RULE.daily} · Weekly: {CADENCE_RULE.weekly} · Monthly: {CADENCE_RULE.monthly}</span>
                </div>
            </section>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
                {/* Inside one property */}
                <section ref={focusRef} className={`rounded-2xl border border-slate-100 bg-white p-4 ${loading ? 'opacity-60' : ''}`}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-black text-slate-900">Inside one property</h3>
                            <p className="text-xs text-slate-500">Modules ranked by adoption, with who uses each one most. Open a module to see its top users.</p>
                        </div>
                        <select id="usage-focus-property" value={focusProp} onChange={e => { setFocusProp(e.target.value); setHighlight(null); }}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700" aria-label="Property to inspect">
                            {data.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        {focusRows.map(({ m, c }, i) => {
                            const used = isUsed(c) && !data.unavailable.includes(m.key);
                            const tops = topUsers(focusProp, m.key, 3);
                            return (
                                <details key={`${focusProp}-${m.key}`} open={highlight === m.key} className={`rounded-xl border ${highlight === m.key ? 'border-slate-900' : 'border-slate-100'} bg-white`}>
                                    <summary className="grid cursor-pointer list-none grid-cols-[20px_minmax(0,1.2fr)_minmax(0,1fr)_44px] items-center gap-3 px-3 py-2.5">
                                        <span className="font-mono text-xs text-slate-400">{i + 1}</span>
                                        <span className="min-w-0">
                                            <span className={`text-sm font-bold ${used ? 'text-slate-800' : 'text-slate-400'}`}>{m.label}</span>
                                            <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">{CADENCE_LABEL[m.cadence]}</span>
                                            <span className="block truncate text-xs text-slate-500">
                                                {!used ? 'Not used at this property' : tops[0] ? `Most active: ${tops[0].name} · ${n(tops[0].byModule[m.key])}` : 'No named user on these records'}
                                            </span>
                                        </span>
                                        <span className="h-2 rounded-r bg-slate-100">
                                            {used && <span className="block h-full rounded-r bg-blue-500" style={{ width: `${Math.max(2, c?.pct ?? 0)}%` }} />}
                                        </span>
                                        <span className="text-right font-mono text-xs font-bold tabular-nums text-slate-700">{used && c?.pct !== null ? `${c?.pct}%` : '-'}</span>
                                    </summary>
                                    <div className="space-y-1 px-3 pb-3 pl-11 text-xs text-slate-600">
                                        <p className="text-slate-400">{c?.detail || 'No data'} · {n(c?.actions || 0)} actions</p>
                                        {tops.length === 0 && <p>No named users for this module in the period.</p>}
                                        {tops.map((u, k) => (
                                            <div key={u.userId} className="flex justify-between gap-3">
                                                <span>{k + 1}. <b className="text-slate-800">{u.name}</b>{u.role ? ` · ${fmtRole(u.role)}` : ''}</span>
                                                <span className="font-mono tabular-nums">{n(u.byModule[m.key])}</span>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            );
                        })}
                    </div>
                </section>

                <div className="space-y-6">
                    {/* Daily active users */}
                    <section className={`rounded-2xl border border-slate-100 bg-white p-4 ${loading ? 'opacity-60' : ''}`}>
                        <div className="mb-2 flex items-baseline justify-between gap-3">
                            <h3 className="text-sm font-black text-slate-900">Daily active users</h3>
                            <p className="text-xs text-slate-500">
                                Average {Math.round(data.daily.reduce((a, d) => a + d.activeUsers, 0) / Math.max(1, data.daily.length))} a day
                            </p>
                        </div>
                        <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.daily} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="date" tickFormatter={d => fmtDay(d)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={16} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                                        labelFormatter={d => fmtDay(String(d), true)}
                                        formatter={(value, name) => [n(Number(value)), name === 'activeUsers' ? 'Active users' : 'Actions']}
                                        contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                                    />
                                    <Bar dataKey="activeUsers" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </section>

                    {/* Needs attention */}
                    <section className={`rounded-2xl border border-slate-100 bg-white p-4 ${loading ? 'opacity-60' : ''}`}>
                        <div className="mb-3 flex items-baseline justify-between gap-3">
                            <h3 className="text-sm font-black text-slate-900">Needs attention</h3>
                            <p className="text-xs text-slate-500">In use, but below 50%</p>
                        </div>
                        <div className="space-y-2">
                            {derived.alerts.length === 0 && <p className="text-xs text-slate-500">Every module in use is at 50% adoption or above.</p>}
                            {derived.alerts.slice(0, 8).map(a => (
                                <div key={a.label} className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                                    <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${a.level === 'crit' ? 'text-rose-600' : 'text-amber-500'}`} />
                                    <span>
                                        <span className={`block text-[10px] font-bold uppercase tracking-wider ${a.level === 'crit' ? 'text-rose-600' : 'text-amber-600'}`}>{a.level === 'crit' ? 'Low adoption' : 'Below half'}</span>
                                        <b className="text-slate-800">{a.label}</b>: {a.text}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>

            {/* Most active users */}
            <section className={`rounded-2xl border border-slate-100 bg-white p-4 ${loading ? 'opacity-60' : ''}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-black text-slate-900">Most active users</h3>
                        <p className="text-xs text-slate-500">
                            Ranked by actions in {userModule === 'all' ? 'all modules' : moduleLabel(userModule)} at {userProp === 'all' ? 'all properties' : userProp === ORG_WIDE ? 'org-wide modules' : propName(userProp)}
                        </p>
                    </div>
                    <select id="usage-user-property" value={userProp} onChange={e => setUserProp(e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700" aria-label="Property for users">
                        <option value="all">All properties</option>
                        {data.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        <option value={ORG_WIDE}>Org-wide (HR, CRM, Tasks)</option>
                    </select>
                </div>
                <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter users by module">
                    {[{ key: 'all', label: 'All modules' }, ...chipModules].map(m => (
                        <button key={m.key} type="button" onClick={() => setUserModule(m.key)} aria-pressed={userModule === m.key}
                            className={`rounded-full border px-3 py-1 text-xs font-bold ${userModule === m.key ? 'border-primary bg-primary text-text-inverse' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            {m.label}
                        </button>
                    ))}
                </div>
                <div className="overflow-x-auto">
                    {userList.length === 0 ? (
                        <p className="py-6 text-center text-xs text-slate-500">No one used this module here in the selected period.</p>
                    ) : (
                        <table className="w-full min-w-[720px] text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 text-slate-500">
                                    <th className="py-2 pr-2 font-bold">#</th>
                                    <th className="py-2 pr-2 font-bold">User</th>
                                    <th className="py-2 pr-2 font-bold">Property</th>
                                    <th className="py-2 pr-2 text-right font-bold">Actions</th>
                                    <th className="py-2 pr-2 font-bold">Top module</th>
                                    <th className="py-2 pr-2 text-right font-bold">Active days</th>
                                    <th className="py-2 font-bold">Last active</th>
                                </tr>
                            </thead>
                            <tbody>
                                {userList.map(({ u, score }, i) => {
                                    const top = Object.entries(u.byModule).sort((a, b) => b[1] - a[1])[0];
                                    return (
                                        <tr key={`${u.userId}-${u.propertyId}`} className="border-b border-slate-50">
                                            <td className="py-2 pr-2 font-mono text-slate-400">{i + 1}</td>
                                            <td className="py-2 pr-2"><b className="block text-slate-800">{u.name}</b><span className="text-[11px] text-slate-400">{fmtRole(u.role)}</span></td>
                                            <td className="py-2 pr-2 text-slate-600">{propName(u.propertyId)}</td>
                                            <td className="py-2 pr-2 text-right font-mono tabular-nums text-slate-700">
                                                <span className="mr-2 inline-block h-1.5 rounded-r bg-blue-500 align-middle" style={{ width: Math.round((score / userMax) * 48) }} />{n(score)}
                                            </td>
                                            <td className="py-2 pr-2 text-slate-600">{top ? moduleLabel(top[0]) : '-'}</td>
                                            <td className="py-2 pr-2 text-right font-mono tabular-nums text-slate-600">{u.activeDays} / {data.range.days}</td>
                                            <td className="py-2 text-slate-600">{fmtDay(u.lastActive)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </section>

            {/* Org-wide modules */}
            <section className="rounded-2xl border border-slate-100 bg-white p-4">
                <h3 className="text-sm font-black text-slate-900">Org-wide modules</h3>
                <p className="mb-3 text-xs text-slate-500">These modules are not tied to a property, so they show counts instead of adoption.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {data.orgWide.map(o => (
                        <div key={o.key} className="rounded-xl bg-slate-50 px-4 py-3">
                            <p className="text-xs font-bold text-slate-500">{o.label}</p>
                            {o.available
                                ? <p className="text-lg font-black text-slate-900">{n(o.actions)} <span className="text-xs font-semibold text-slate-500">{o.users === null ? 'count only, never linked to a person' : `actions · ${n(o.users)} people`}</span></p>
                                : <p className="text-xs font-semibold text-slate-400">No data on this deployment</p>}
                        </div>
                    ))}
                </div>
            </section>

            {data.truncated?.length > 0 && (
                <p className="text-xs font-semibold text-amber-600">
                    Very large range: {data.truncated.map(moduleLabel).join(', ')} hit the row limit, so those numbers are partial. Pick a shorter range for exact figures.
                </p>
            )}
            {data.unavailable.length > 0 && (
                <p className="text-xs text-slate-400">
                    Not shown because the data could not be read: {data.unavailable.map(moduleLabel).join(', ')}.
                </p>
            )}
        </div>
    );
}
