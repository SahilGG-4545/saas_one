import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCommandCenterAccess,
    isCommandCenterAccessError,
    isMissingRelation,
    readOrgId,
} from '@/backend/lib/commandCenter/access';

/**
 * GET /api/reports/app-usage?orgId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Org-level App Usage Report: how well each property has adopted each module, and
 * who does the work. Org super admins (and master admins) only.
 *
 * No new tracking: every module already stores who acted, where and when, so this
 * reads those rows for the date range and aggregates them in JS.
 *
 * Modules are scored against their own rhythm, so a monthly module is never compared
 * with a daily one on raw counts:
 *   scheduled  completed / scheduled            (SOP checklists, PPM)
 *   daily      days with an entry / days        (tickets, meters, visitors, stock)
 *   weekly     weeks with an entry / weeks      (rooms, petty cash, procurement, roster, assets)
 *   monthly    months submitted / months        (monthly requisitions)
 * HR, CRM and Task manager carry no property, so they are reported org-wide as counts.
 *
 * Days are IST calendar days. Each module degrades on its own: a missing table or
 * column marks that module unavailable instead of failing the whole report.
 */

export const dynamic = 'force-dynamic';

type Cadence = 'scheduled' | 'daily' | 'weekly' | 'monthly';
type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string } | null;
type Page = PromiseLike<{ data: unknown[] | null; error: DbError }>;

const IST_OFFSET_MS = 330 * 60 * 1000;
const MAX_DAYS = 366;
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
const VIEW_ROLES = ['org_super_admin', 'master_admin'];

interface Source {
    table: string;
    userCol: string;
    dateCol: string;
    dateType: 'ts' | 'date';
    /** 'water' resolves the property through water_sources.source_id. */
    scope: 'property' | 'water';
}

interface ModuleDef {
    key: string;
    label: string;
    cadence: Cadence;
    source?: Source;
}

const MODULES: ModuleDef[] = [
    { key: 'checklists', label: 'SOP Checklists', cadence: 'scheduled' },
    { key: 'ppm', label: 'PPM', cadence: 'scheduled' },
    { key: 'tickets', label: 'Tickets', cadence: 'daily', source: { table: 'tickets', userCol: 'raised_by', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'electricity', label: 'Electricity', cadence: 'daily', source: { table: 'electricity_readings', userCol: 'created_by', dateCol: 'reading_date', dateType: 'date', scope: 'property' } },
    { key: 'diesel', label: 'Diesel', cadence: 'daily', source: { table: 'diesel_readings', userCol: 'created_by', dateCol: 'reading_date', dateType: 'date', scope: 'property' } },
    { key: 'water', label: 'Water', cadence: 'daily', source: { table: 'water_readings', userCol: 'created_by', dateCol: 'reading_date', dateType: 'date', scope: 'water' } },
    { key: 'visitors', label: 'Visitors', cadence: 'daily', source: { table: 'visitor_logs', userCol: 'created_by', dateCol: 'checkin_time', dateType: 'ts', scope: 'property' } },
    { key: 'stock', label: 'Stock', cadence: 'daily', source: { table: 'stock_movements', userCol: 'user_id', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'meeting_rooms', label: 'Meeting Rooms', cadence: 'weekly', source: { table: 'meeting_room_bookings', userCol: 'user_id', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'petty_cash', label: 'Petty Cash', cadence: 'weekly', source: { table: 'petty_cash_requests', userCol: 'requester_id', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'procurement', label: 'Procurement', cadence: 'weekly', source: { table: 'material_requests', userCol: 'requested_by', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'roster', label: 'Roster', cadence: 'weekly', source: { table: 'roster_audit_logs', userCol: 'changed_by', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'assets', label: 'Assets', cadence: 'weekly', source: { table: 'asset_events', userCol: 'created_by', dateCol: 'occurred_at', dateType: 'ts', scope: 'property' } },
    { key: 'requisitions', label: 'Requisitions', cadence: 'monthly' },
];

// userCol null = count only. HR grievances can be anonymous or confidential, so the
// report never ties an HR ticket to a person.
const ORG_MODULES: { key: string; label: string; table: string; userCol: string | null }[] = [
    { key: 'hr', label: 'HR Grievances', table: 'hr_tickets', userCol: null },
    { key: 'crm', label: 'CRM Leads', table: 'crm_leads', userCol: 'created_by' },
    { key: 'tasks', label: 'Tasks Assigned', table: 'tm_tasks', userCol: 'assigned_by' },
];

// ── Date helpers (IST calendar days, YYYY-MM-DD strings) ─────────────────────

function todayIst(): string {
    return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/** A real calendar day: rejects values like 2026-02-31 that Date would roll over. */
function isDay(v: string | null): v is string {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const t = Date.parse(`${v}T00:00:00Z`);
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** IST calendar day of a timestamp, or the value itself for a DATE column. */
function istDay(v: unknown): string | null {
    if (typeof v !== 'string' || !v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const t = Date.parse(v);
    if (isNaN(t)) return null;
    return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v ? v : null;
}

// ── Paged reads past the PostgREST row cap ──────────────────────────────────

async function fetchAll(makePage: (from: number, to: number) => Page): Promise<{ rows: Row[]; error: DbError; truncated: boolean }> {
    const rows: Row[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE_SIZE;
        const { data, error } = await makePage(from, from + PAGE_SIZE - 1);
        if (error) return { rows, error, truncated: false };
        if (!data || data.length === 0) return { rows, error: null, truncated: false };
        rows.push(...(data as Row[]));
        if (data.length < PAGE_SIZE) return { rows, error: null, truncated: false };
    }
    return { rows, error: null, truncated: true };
}

function isMissingColumn(error: DbError): boolean {
    return error?.code === '42703' || error?.code === 'PGRST204' || /column .* does not exist/i.test(error?.message || '');
}

interface UsageEvent {
    module: string;
    propertyId: string | null;
    userId: string | null;
    day: string | null;
}

export async function GET(request: NextRequest) {
    const access = await resolveCommandCenterAccess(request, readOrgId(request));
    if (isCommandCenterAccessError(access)) return access;

    // isSuperAdmin = master admin, or org_super_admin of the resolved org.
    if (!access.isSuperAdmin && !access.roles.some(r => VIEW_ROLES.includes(r))) {
        return NextResponse.json({ error: 'Forbidden: the App Usage Report is for org super admins' }, { status: 403 });
    }

    // ── Range ────────────────────────────────────────────────────────────────
    const sp = request.nextUrl.searchParams;
    const today = todayIst();
    const askedTo = isDay(sp.get('to')) ? (sp.get('to') as string) : today;
    const to = askedTo > today ? today : askedTo;
    const from = isDay(sp.get('from')) ? (sp.get('from') as string) : addDays(to, -29);
    if (from > to) return NextResponse.json({ error: '"from" must be on or before "to"' }, { status: 400 });

    const days: string[] = [];
    for (let d = from; d <= to && days.length <= MAX_DAYS; d = addDays(d, 1)) days.push(d);
    if (days.length > MAX_DAYS) {
        return NextResponse.json({ error: `Pick a range of ${MAX_DAYS} days or less` }, { status: 400 });
    }
    const dayIndex = new Map(days.map((d, i) => [d, i]));
    const weekCount = Math.ceil(days.length / 7);
    // Weeks are counted back from `to`, so the most recent week is always complete.
    const weekOf = (day: string) => Math.floor((days.length - 1 - (dayIndex.get(day) as number)) / 7);
    const months = Array.from(new Set(days.map(d => d.slice(0, 7))));

    const fromTs = `${from}T00:00:00+05:30`;
    const toTsExclusive = `${addDays(to, 1)}T00:00:00+05:30`;
    // Checklists due later today are not missed yet, so scheduled work stops at now.
    const dueBefore = to === today ? new Date().toISOString() : toTsExclusive;

    const propertyIds = access.propertyIds;
    const propertySet = new Set(propertyIds);
    const events: UsageEvent[] = [];
    const unavailable: string[] = [];
    const truncated: string[] = [];
    const scheduled = new Map<string, { scheduled: number; done: number }>(); // `${prop}|${module}`
    const reqMonths = new Map<string, Set<string>>(); // prop -> months submitted

    // ── Simple sources ──────────────────────────────────────────────────────
    let waterSourceProperty = new Map<string, string>();
    if (MODULES.some(m => m.source?.scope === 'water')) {
        const { rows, error } = await fetchAll((a, b) =>
            supabaseAdmin.from('water_sources').select('id, property_id').in('property_id', propertyIds).order('id').range(a, b));
        if (error) {
            if (!isMissingRelation(error)) console.error('[app-usage] water_sources:', error.message);
            unavailable.push('water');
        } else {
            waterSourceProperty = new Map(rows.map(r => [String(r.id), String(r.property_id)]));
        }
    }

    await Promise.all(MODULES.filter(m => m.source).map(async (m) => {
        const s = m.source as Source;
        const scopeCol = s.scope === 'water' ? 'source_id' : 'property_id';
        const scopeIds = s.scope === 'water' ? Array.from(waterSourceProperty.keys()) : propertyIds;
        if (!scopeIds.length || unavailable.includes(m.key)) return;

        const read = (withUser: boolean) => fetchAll((a, b) => {
            let q = supabaseAdmin
                .from(s.table)
                .select([scopeCol, s.dateCol, withUser ? s.userCol : null].filter(Boolean).join(', '))
                .in(scopeCol, scopeIds);
            q = s.dateType === 'date'
                ? q.gte(s.dateCol, from).lte(s.dateCol, to)
                : q.gte(s.dateCol, fromTs).lt(s.dateCol, toTsExclusive);
            return q.order('id').range(a, b);
        });

        let { rows, error, truncated: cut } = await read(true);
        if (error && isMissingColumn(error)) ({ rows, error, truncated: cut } = await read(false)); // e.g. visitor_logs.created_by not migrated
        if (cut) truncated.push(m.key);
        if (error) {
            if (!isMissingRelation(error)) console.error(`[app-usage] ${s.table}:`, error.message);
            unavailable.push(m.key);
            return;
        }
        for (const r of rows) {
            const propertyId = s.scope === 'water' ? waterSourceProperty.get(String(r.source_id)) ?? null : str(r.property_id);
            if (!propertyId || !propertySet.has(propertyId)) continue;
            events.push({ module: m.key, propertyId, userId: str(r[s.userCol]), day: istDay(r[s.dateCol]) });
        }
    }));

    // ── SOP checklists: completed vs scheduled ──────────────────────────────
    {
        const fetched = await fetchAll((a, b) =>
            supabaseAdmin.from('sop_completions')
                .select('id, property_id, status, completed_by, completed_at, due_at')
                .in('property_id', propertyIds)
                .gte('due_at', fromTs).lt('due_at', dueBefore)
                .order('id').range(a, b));
        const { rows, error } = fetched;
        if (fetched.truncated) truncated.push('checklists');
        if (error) {
            if (!isMissingRelation(error)) console.error('[app-usage] sop_completions:', error.message);
            unavailable.push('checklists');
        } else {
            for (const r of rows) {
                const propertyId = str(r.property_id);
                if (!propertyId) continue;
                const k = `${propertyId}|checklists`;
                const agg = scheduled.get(k) || { scheduled: 0, done: 0 };
                agg.scheduled++;
                const done = r.status === 'completed' || !!r.completed_at;
                if (done) {
                    agg.done++;
                    events.push({ module: 'checklists', propertyId, userId: str(r.completed_by), day: istDay(r.completed_at) ?? istDay(r.due_at) });
                }
                scheduled.set(k, agg);
            }
        }
    }

    // ── PPM: done vs planned ────────────────────────────────────────────────
    {
        const { rows, error } = await fetchAll((a, b) =>
            supabaseAdmin.from('ppm_schedules')
                .select('id, property_id, planned_date, done_date, status, attachments')
                .in('property_id', propertyIds)
                .gte('planned_date', from).lte('planned_date', to)
                .order('id').range(a, b));
        if (error) {
            if (!isMissingRelation(error)) console.error('[app-usage] ppm_schedules:', error.message);
            unavailable.push('ppm');
        } else {
            for (const r of rows) {
                const propertyId = str(r.property_id);
                if (!propertyId) continue;
                const k = `${propertyId}|ppm`;
                const agg = scheduled.get(k) || { scheduled: 0, done: 0 };
                agg.scheduled++;
                const status = String(r.status || '').toLowerCase();
                const notDone = ['postponed', 'skipped', 'cancelled', 'pending'].includes(status);
                if (status === 'completed' || status === 'done' || (r.done_date && !notDone)) {
                    agg.done++;
                    // PPM keeps the completing user inside the attachments JSON, not as a column.
                    const att = r.attachments && typeof r.attachments === 'object' && !Array.isArray(r.attachments)
                        ? (r.attachments as Record<string, unknown>) : {};
                    events.push({ module: 'ppm', propertyId, userId: str(att.completed_by), day: istDay(r.done_date) ?? istDay(att.completed_at) });
                }
                scheduled.set(k, agg);
            }
        }
    }

    // ── Monthly requisitions: months submitted ──────────────────────────────
    {
        const years = Array.from(new Set(months.map(m => Number(m.slice(0, 4)))));
        const { rows, error } = await fetchAll((a, b) =>
            supabaseAdmin.from('property_monthly_requisitions')
                .select('id, property_id, uploaded_by, requisition_month, requisition_year, created_at')
                .in('property_id', propertyIds)
                .in('requisition_year', years)
                .order('id').range(a, b));
        if (error) {
            if (!isMissingRelation(error)) console.error('[app-usage] property_monthly_requisitions:', error.message);
            unavailable.push('requisitions');
        } else {
            for (const r of rows) {
                const propertyId = str(r.property_id);
                const month = `${r.requisition_year}-${String(r.requisition_month).padStart(2, '0')}`;
                if (!propertyId || !months.includes(month)) continue;
                if (!reqMonths.has(propertyId)) reqMonths.set(propertyId, new Set());
                (reqMonths.get(propertyId) as Set<string>).add(month);
                events.push({ module: 'requisitions', propertyId, userId: str(r.uploaded_by), day: istDay(r.created_at) });
            }
        }
    }

    // ── Org-wide modules (no property column) ───────────────────────────────
    const orgWide: { key: string; label: string; actions: number; users: number | null; available: boolean }[] = [];
    await Promise.all(ORG_MODULES.map(async (m) => {
        const { rows, error } = await fetchAll((a, b) =>
            supabaseAdmin.from(m.table)
                .select(m.userCol ? `id, ${m.userCol}, created_at` : 'id, created_at')
                .eq('organization_id', access.organizationId)
                .gte('created_at', fromTs).lt('created_at', toTsExclusive)
                .order('id').range(a, b));
        if (error) {
            if (!isMissingRelation(error)) console.error(`[app-usage] ${m.table}:`, error.message);
            orgWide.push({ key: m.key, label: m.label, actions: 0, users: null, available: false });
            return;
        }
        const users = new Set<string>();
        for (const r of rows) {
            const userId = m.userCol ? str(r[m.userCol]) : null;
            if (userId) users.add(userId);
            events.push({ module: m.key, propertyId: null, userId, day: istDay(r.created_at) });
        }
        orgWide.push({ key: m.key, label: m.label, actions: rows.length, users: m.userCol ? users.size : null, available: true });
    }));
    orgWide.sort((a, b) => ORG_MODULES.findIndex(m => m.key === a.key) - ORG_MODULES.findIndex(m => m.key === b.key));

    // ── Aggregate ───────────────────────────────────────────────────────────
    const inRange = (day: string | null): day is string => !!day && dayIndex.has(day);

    const cellActions = new Map<string, number>();
    const cellUnits = new Map<string, Set<number | string>>();
    const userRows = new Map<string, { userId: string; propertyId: string | null; byModule: Record<string, number>; days: Set<string> }>();
    const dailyUsers = days.map(() => new Set<string>());
    const dailyActions = days.map(() => 0);

    for (const e of events) {
        if (e.propertyId && inRange(e.day)) {
            const k = `${e.propertyId}|${e.module}`;
            cellActions.set(k, (cellActions.get(k) || 0) + 1);
            const mod = MODULES.find(m => m.key === e.module);
            if (mod && (mod.cadence === 'daily' || mod.cadence === 'weekly')) {
                if (!cellUnits.has(k)) cellUnits.set(k, new Set());
                (cellUnits.get(k) as Set<number | string>).add(mod.cadence === 'daily' ? e.day : weekOf(e.day));
            }
        }
        if (inRange(e.day)) {
            dailyActions[dayIndex.get(e.day) as number]++;
            if (e.userId) dailyUsers[dayIndex.get(e.day) as number].add(e.userId);
        }
        if (!e.userId) continue;
        const uk = `${e.userId}|${e.propertyId ?? 'org'}`;
        if (!userRows.has(uk)) userRows.set(uk, { userId: e.userId, propertyId: e.propertyId, byModule: {}, days: new Set() });
        const u = userRows.get(uk)!;
        u.byModule[e.module] = (u.byModule[e.module] || 0) + 1;
        if (inRange(e.day)) u.days.add(e.day);
    }

    const cells: Record<string, Record<string, { actions: number; pct: number | null; detail: string }>> = {};
    for (const pid of propertyIds) {
        cells[pid] = {};
        for (const m of MODULES) {
            const k = `${pid}|${m.key}`;
            const actions = cellActions.get(k) || 0;
            let pct: number | null = null;
            let detail = '';
            if (unavailable.includes(m.key)) {
                detail = 'Data not available';
            } else if (m.cadence === 'scheduled') {
                const agg = scheduled.get(k);
                if (agg && agg.scheduled > 0) {
                    pct = Math.round((agg.done / agg.scheduled) * 100);
                    detail = `${agg.done} of ${agg.scheduled} completed`;
                } else {
                    detail = 'Nothing scheduled in this period';
                }
            } else if (m.cadence === 'daily') {
                const used = cellUnits.get(k)?.size || 0;
                pct = Math.round((used / days.length) * 100);
                detail = `Used on ${used} of ${days.length} days`;
            } else if (m.cadence === 'weekly') {
                const used = cellUnits.get(k)?.size || 0;
                pct = Math.round((used / weekCount) * 100);
                detail = `Used in ${used} of ${weekCount} weeks`;
            } else {
                const done = reqMonths.get(pid)?.size || 0;
                pct = Math.round((done / months.length) * 100);
                detail = `Submitted for ${done} of ${months.length} month${months.length === 1 ? '' : 's'}`;
            }
            cells[pid][m.key] = { actions, pct, detail };
        }
    }

    // ── People: names and roles ─────────────────────────────────────────────
    const userIds = Array.from(new Set(Array.from(userRows.values()).map(u => u.userId)));
    const names = new Map<string, { name: string; email: string | null }>();
    const propRoles = new Map<string, string>();
    const orgRoles = new Map<string, string>();
    for (let i = 0; i < userIds.length; i += 200) {
        const chunk = userIds.slice(i, i + 200);
        const [usersRes, propRes, orgRes] = await Promise.all([
            supabaseAdmin.from('users').select('id, full_name, email').in('id', chunk),
            supabaseAdmin.from('property_memberships').select('user_id, property_id, role').in('user_id', chunk).in('property_id', propertyIds).eq('is_active', true),
            supabaseAdmin.from('organization_memberships').select('user_id, role').in('user_id', chunk).eq('organization_id', access.organizationId),
        ]);
        if (usersRes.error) console.error('[app-usage] users lookup:', usersRes.error.message);
        (usersRes.data || []).forEach(u => names.set(u.id, { name: u.full_name || u.email || 'Unknown user', email: u.email ?? null }));
        (propRes.data || []).forEach(m => { if (m.role) propRoles.set(`${m.user_id}|${m.property_id}`, m.role); });
        (orgRes.data || []).forEach(m => { if (m.role) orgRoles.set(m.user_id, m.role); });
    }

    const users = Array.from(userRows.values()).map(u => {
        const sortedDays = Array.from(u.days).sort();
        return {
            userId: u.userId,
            name: names.get(u.userId)?.name || 'Unknown user',
            email: names.get(u.userId)?.email || null,
            role: (u.propertyId && propRoles.get(`${u.userId}|${u.propertyId}`)) || orgRoles.get(u.userId) || null,
            propertyId: u.propertyId,
            byModule: u.byModule,
            total: Object.values(u.byModule).reduce((a, b) => a + b, 0),
            activeDays: u.days.size,
            lastActive: sortedDays.length ? sortedDays[sortedDays.length - 1] : null,
        };
    }).sort((a, b) => b.total - a.total);

    return NextResponse.json({
        organizationId: access.organizationId,
        range: { from, to, days: days.length, weeks: weekCount, months: months.length },
        properties: access.properties.map(p => ({ id: p.id, name: p.name })),
        modules: MODULES.map(m => ({ key: m.key, label: m.label, cadence: m.cadence })),
        cells,
        orgWide,
        users,
        daily: days.map((d, i) => ({ date: d, activeUsers: dailyUsers[i].size, actions: dailyActions[i] })),
        unavailable,
        truncated,
        generatedAt: new Date().toISOString(),
    });
}
