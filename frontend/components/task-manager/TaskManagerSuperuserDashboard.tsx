"use client";

import React, { useEffect, useState, useMemo } from 'react';
import {
    ClipboardList,
    CheckCircle2,
    Clock,
    AlertTriangle,
    Building2,
    Users,
    Search,
    Filter,
    Plus,
    RefreshCw,
    ShieldCheck,
    Calendar,
    Send,
    ChevronRight,
    TrendingUp,
    FileText,
    AlertCircle,
    UserCheck,
    Check,
    Bell
} from 'lucide-react';

const CORPORATE_DEPARTMENTS = [
    'Tech',
    'Operations',
    'Procurement',
    'Business Development & Growth',
    'Human Resources',
    'Accounts',
    'Legal',
    'Design',
    'IT',
    'Marketing',
    'Management',
    'Infrastructure'
];

interface TaskItem {
    id: string;
    title: string;
    description: string | null;
    employee_id: string;
    department: string | null;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    progress_percentage: number;
    due_date: string | null;
    completed_at: string | null;
    created_at: string;
    employee?: {
        id: string;
        full_name: string;
        phone: string;
    };
}

interface DailyReport {
    id: string;
    user_id: string;
    report_date: string;
    summary: string;
    tasks_completed: any;
    blockers: string | null;
    created_at: string;
    user?: {
        id: string;
        full_name: string;
        phone: string;
    };
}

interface Member {
    id: string;
    user_id: string;
    phone: string;
    full_name: string;
    department: string;
    designation: string | null;
    is_superuser: boolean;
    is_active: boolean;
}

export default function TaskManagerSuperuserDashboard({ orgId }: { orgId?: string }) {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [activeView, setActiveView] = useState<'deliverables' | 'reports' | 'roster'>('deliverables');

    // Data State
    const [metrics, setMetrics] = useState<any>({
        totalTasks: 0,
        completedTasks: 0,
        inProgressTasks: 0,
        pendingTasks: 0,
        reportsSubmittedToday: 0,
        missingReportsCount: 0,
        totalEnrolledMembers: 0
    });
    const [departments, setDepartments] = useState<any[]>([]);
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [dailyReports, setDailyReports] = useState<DailyReport[]>([]);
    const [missingReports, setMissingReports] = useState<any[]>([]);
    const [members, setMembers] = useState<Member[]>([]);

    // Filters
    const [selectedDept, setSelectedDept] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));

    // Modals
    const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
    const [showEnrollModal, setShowEnrollModal] = useState(false);

    // Form states
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskDept, setNewTaskDept] = useState('Tech');
    const [newTaskEmployeeId, setNewTaskEmployeeId] = useState('');

    const [enrollName, setEnrollName] = useState('');
    const [enrollPhone, setEnrollPhone] = useState('');
    const [enrollDept, setEnrollDept] = useState('Tech');
    const [enrollDesignation, setEnrollDesignation] = useState('');
    const [enrollIsSuperuser, setEnrollIsSuperuser] = useState(false);
    const [sendingAction, setSendingAction] = useState<string | null>(null);
    const [nudgingPhone, setNudgingPhone] = useState<string | null>(null);

    const handleNudgeSingleMember = async (member: { name: string; phone: string }) => {
        if (!member.phone) {
            alert('❌ Missing phone number for this member');
            return;
        }
        setNudgingPhone(member.phone);
        try {
            const res = await fetch('/api/task-manager/reminders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'nudge_member',
                    phone: member.phone,
                    name: member.name,
                }),
            });
            const data = await res.json();
            if (data.ok) {
                alert(`✅ ${data.message || `Nudge sent to ${member.name} via Autopilot Offices Bot!`}`);
            } else {
                alert(`❌ Failed: ${data.error || 'Delivery failed'}`);
            }
        } catch (err: any) {
            alert(`❌ Error: ${err?.message || 'Failed to dispatch nudge'}`);
        } finally {
            setNudgingPhone(null);
        }
    };

    const triggerReminderAction = async (action: 'eod_nudge' | 'morning_digest' | 'superuser_rollup') => {
        setSendingAction(action);
        try {
            const res = await fetch('/api/task-manager/reminders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            const data = await res.json();
            if (data.ok) {
                alert(`✅ ${data.message}`);
                fetchData();
            } else {
                alert(`❌ Failed: ${data.error || 'Unknown error'}`);
            }
        } catch (err: any) {
            alert(`❌ Error: ${err?.message || 'Failed to dispatch'}`);
        } finally {
            setSendingAction(null);
        }
    };

    const fetchData = async () => {
        setRefreshing(true);
        try {
            const params = new URLSearchParams();
            if (selectedDept !== 'all') params.set('department', selectedDept);
            if (statusFilter !== 'all') params.set('status', statusFilter);
            if (searchQuery) params.set('search', searchQuery);
            if (selectedDate) params.set('date', selectedDate);

            const res = await fetch(`/api/task-manager/dashboard?${params.toString()}`);
            const data = await res.json();
            if (data.success) {
                setMetrics(data.metrics || {});
                setDepartments(data.departments || []);
                setTasks(data.tasks || []);
                setDailyReports(data.dailyReports || []);
                setMissingReports(data.missingReports || []);
                setMembers(data.members || []);
            }
        } catch (err) {
            console.error('Failed to fetch task manager dashboard data:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [selectedDept, statusFilter, selectedDate]);

    // Handle Create Task
    const handleCreateTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskTitle.trim() || !newTaskEmployeeId) return;

        try {
            const res = await fetch('/api/task-manager/dashboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_task',
                    title: newTaskTitle.trim(),
                    department: newTaskDept,
                    employeeId: newTaskEmployeeId
                })
            });
            const data = await res.json();
            if (data.success) {
                setShowCreateTaskModal(false);
                setNewTaskTitle('');
                fetchData();
            }
        } catch (err) {
            console.error('Error creating task:', err);
        }
    };

    // Handle Enroll Member
    const handleEnrollMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!enrollName.trim() || !enrollPhone.trim()) return;

        try {
            const res = await fetch('/api/task-manager/dashboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'enroll_member',
                    fullName: enrollName.trim(),
                    phone: enrollPhone.trim(),
                    department: enrollDept,
                    designation: enrollDesignation.trim(),
                    isSuperuser: enrollIsSuperuser
                })
            });
            const data = await res.json();
            if (data.success) {
                setShowEnrollModal(false);
                setEnrollName('');
                setEnrollPhone('');
                setEnrollDesignation('');
                fetchData();
            }
        } catch (err) {
            console.error('Error enrolling member:', err);
        }
    };

    // Handle Task Status Toggle
    const handleUpdateTaskStatus = async (taskId: string, newStatus: string) => {
        try {
            await fetch('/api/task-manager/dashboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_task',
                    taskId,
                    status: newStatus,
                    progress: newStatus === 'completed' ? 100 : undefined
                })
            });
            fetchData();
        } catch (err) {
            console.error('Error updating task:', err);
        }
    };

    // Filtered tasks by search
    const filteredTasks = useMemo(() => {
        if (!searchQuery) return tasks;
        const q = searchQuery.toLowerCase();
        return tasks.filter(t =>
            t.title.toLowerCase().includes(q) ||
            t.employee?.full_name.toLowerCase().includes(q) ||
            t.department?.toLowerCase().includes(q)
        );
    }, [tasks, searchQuery]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed':
                return <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Completed</span>;
            case 'blocked':
                return <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Blocked</span>;
            default:
                return <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" /> Pending</span>;
        }
    };

    return (
        <div className="space-y-6 pb-12">
            {/* ── 1. Header ──────────────────────────────────────────────────────── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-6 rounded-2xl shadow-xs">
                <div>
                    <div className="flex items-center gap-2 mb-1.5">
                        <span className="p-2 rounded-xl bg-[#587e85]/10 text-[#587e85]">
                            <ClipboardList className="w-5 h-5" />
                        </span>
                        <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                            Head Office Task Manager
                        </h1>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#587e85] text-white">
                            Super Admin Cockpit
                        </span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                        Monitor cross-department deliverables, employee daily reports, and WhatsApp activity in real-time.
                    </p>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                    <button
                        onClick={fetchData}
                        disabled={refreshing}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-xl transition-all"
                        title="Refresh Data"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                    </button>

                    <button
                        onClick={() => triggerReminderAction('eod_nudge')}
                        disabled={sendingAction === 'eod_nudge'}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 rounded-xl transition-all"
                        title="Send WhatsApp EOD reminder to missing employees"
                    >
                        <Bell className={`w-3.5 h-3.5 ${sendingAction === 'eod_nudge' ? 'animate-bounce' : ''}`} />
                        <span>{sendingAction === 'eod_nudge' ? 'Sending Nudges...' : 'Nudge Missing EOD'}</span>
                    </button>

                    <button
                        onClick={() => setShowEnrollModal(true)}
                        className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-200/60 dark:bg-slate-800 hover:bg-slate-300/80 rounded-xl transition-all"
                    >
                        <Users className="w-3.5 h-3.5" />
                        <span>Enroll Member</span>
                    </button>

                    <button
                        onClick={() => setShowCreateTaskModal(true)}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#587e85] hover:bg-[#48686e] rounded-xl shadow-xs transition-all active:scale-95"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Assign Deliverable</span>
                    </button>
                </div>
            </div>

            {/* ── 2. Top Metric KPI Cards ────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
                    <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Active Deliverables</span>
                        <TrendingUp className="w-4 h-4 text-blue-500" />
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                        {metrics.inProgressTasks + metrics.pendingTasks}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                        {metrics.inProgressTasks} in progress · {metrics.pendingTasks} pending
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
                    <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Completed Deliverables</span>
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                        {metrics.completedTasks}
                    </div>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">
                        {metrics.totalTasks > 0 ? Math.round((metrics.completedTasks / metrics.totalTasks) * 100) : 0}% completion rate
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
                    <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Today's Daily EOD Reports</span>
                        <FileText className="w-4 h-4 text-[#587e85]" />
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                        {metrics.reportsSubmittedToday}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                        Submitted for {selectedDate}
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 rounded-2xl shadow-xs">
                    <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider">Missing Submissions</span>
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-amber-600 dark:text-amber-400">
                        {metrics.missingReportsCount}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                        Active staff pending report
                    </p>
                </div>
            </div>

            {/* ── 3. Department Filter Bar ────────────────────────────────────────── */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                <button
                    onClick={() => setSelectedDept('all')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all ${
                        selectedDept === 'all'
                            ? 'bg-[#587e85] text-white shadow-xs'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 border border-slate-200 dark:border-slate-800'
                    }`}
                >
                    All Departments ({metrics.totalTasks})
                </button>
                {departments.map((dept) => (
                    <button
                        key={dept.name}
                        onClick={() => setSelectedDept(dept.name)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all ${
                            selectedDept === dept.name
                                ? 'bg-[#587e85] text-white shadow-xs'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 border border-slate-200 dark:border-slate-800'
                        }`}
                    >
                        {dept.name} ({dept.total})
                    </button>
                ))}
            </div>

            {/* ── 4. Main Cockpit Navigation Tabs ─────────────────────────────────── */}
            <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800">
                <button
                    onClick={() => setActiveView('deliverables')}
                    className={`pb-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                        activeView === 'deliverables'
                            ? 'border-[#587e85] text-[#587e85]'
                            : 'border-transparent text-slate-500 hover:text-slate-900'
                    }`}
                >
                    <ClipboardList className="w-4 h-4" />
                    <span>Company Deliverables</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600">
                        {filteredTasks.length}
                    </span>
                </button>

                <button
                    onClick={() => setActiveView('reports')}
                    className={`pb-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                        activeView === 'reports'
                            ? 'border-[#587e85] text-[#587e85]'
                            : 'border-transparent text-slate-500 hover:text-slate-900'
                    }`}
                >
                    <FileText className="w-4 h-4" />
                    <span>Daily EOD Reports</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600">
                        {dailyReports.length}
                    </span>
                </button>

                <button
                    onClick={() => setActiveView('roster')}
                    className={`pb-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                        activeView === 'roster'
                            ? 'border-[#587e85] text-[#587e85]'
                            : 'border-transparent text-slate-500 hover:text-slate-900'
                    }`}
                >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Team Roster & Accountability</span>
                    {metrics.missingReportsCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">
                            {metrics.missingReportsCount} pending
                        </span>
                    )}
                </button>
            </div>

            {/* ── 5. Tab Content: Deliverables Board ──────────────────────────────── */}
            {activeView === 'deliverables' && (
                <div className="space-y-4">
                    {/* Search & Status Filters */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
                        <div className="relative w-full sm:w-80">
                            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search by task title or employee..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-[#587e85]"
                            />
                        </div>

                        <div className="flex items-center gap-1.5 self-end sm:self-auto overflow-x-auto w-full sm:w-auto">
                            {['all', 'active', 'in_progress', 'completed', 'blocked'].map((st) => (
                                <button
                                    key={st}
                                    onClick={() => setStatusFilter(st)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all ${
                                        statusFilter === st
                                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                            : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    {st.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Task List Table */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
                        {loading ? (
                            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
                                <RefreshCw className="w-6 h-6 animate-spin text-[#587e85]" />
                                <span>Loading company deliverables...</span>
                            </div>
                        ) : filteredTasks.length === 0 ? (
                            <div className="p-12 text-center text-slate-400">
                                <ClipboardList className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                                <p className="font-bold text-sm text-slate-600 dark:text-slate-300">No deliverables found</p>
                                <p className="text-xs text-slate-400 mt-0.5">Try selecting another department or filter.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {filteredTasks.map((task) => (
                                    <div
                                        key={task.id}
                                        className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                                    >
                                        <div className="space-y-1.5 max-w-xl">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 uppercase">
                                                    {task.department || 'General'}
                                                </span>
                                                <span className="text-xs text-slate-400">
                                                    Assignee: <strong className="text-slate-700 dark:text-slate-200">{task.employee?.full_name || 'Staff Member'}</strong>
                                                </span>
                                            </div>

                                            <h3 className={`text-sm font-bold ${task.status === 'completed' ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}>
                                                {task.title}
                                            </h3>

                                            {task.description && (
                                                <p className="text-xs text-slate-500 line-clamp-1">{task.description}</p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3 shrink-0">
                                            {getStatusBadge(task.status)}

                                            {/* Quick Status Toggle Button */}
                                            {task.status !== 'completed' ? (
                                                <button
                                                    onClick={() => handleUpdateTaskStatus(task.id, 'completed')}
                                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-emerald-600 hover:border-emerald-500 transition-colors"
                                                    title="Mark Completed"
                                                >
                                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                                    <span>Mark Done</span>
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleUpdateTaskStatus(task.id, 'pending')}
                                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-400 hover:text-amber-600 hover:border-amber-500 transition-colors"
                                                    title="Re-open Task"
                                                >
                                                    <span>Re-open</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── 6. Tab Content: Daily EOD Reports Feed ─────────────────────────── */}
            {activeView === 'reports' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                        <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-[#587e85]" />
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Report Date:</span>
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="px-3 py-1.5 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 border-none font-bold"
                            />
                        </div>
                        <span className="text-xs text-slate-400 font-medium">
                            {dailyReports.length} reports logged for this day
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {dailyReports.length === 0 ? (
                            <div className="col-span-2 p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-400">
                                <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                                <p className="font-bold text-sm text-slate-600 dark:text-slate-300">No EOD reports logged for {selectedDate}</p>
                                <p className="text-xs text-slate-400 mt-0.5">Staff report updates via WhatsApp by typing "daily report: [summary]".</p>
                            </div>
                        ) : (
                            dailyReports.map((report) => (
                                <div
                                    key={report.id}
                                    className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3"
                                >
                                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-[#587e85]/10 text-[#587e85] flex items-center justify-center font-bold text-xs">
                                                {report.user?.full_name?.charAt(0) || 'U'}
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                                                    {report.user?.full_name || 'Team Member'}
                                                </h4>
                                                <p className="text-[11px] text-slate-400">
                                                    {report.user?.phone || ''}
                                                </p>
                                            </div>
                                        </div>
                                        <span className="text-[11px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                                            {new Date(report.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>

                                    <div className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                                        {report.summary}
                                    </div>

                                    {report.blockers && (
                                        <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs">
                                            <strong className="block mb-0.5 font-bold">⚠️ Blockers Identified:</strong>
                                            {report.blockers}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* ── 7. Tab Content: Team Roster & Accountability ───────────────────── */}
            {activeView === 'roster' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column: Missing Reports Radar */}
                    <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-xs space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500" />
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                                    Missing Today's EOD ({missingReports.length})
                                </h3>
                            </div>
                            {missingReports.length > 0 && (
                                <button
                                    onClick={() => triggerReminderAction('eod_nudge')}
                                    disabled={sendingAction === 'eod_nudge'}
                                    className="px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 hover:bg-amber-200 dark:hover:bg-amber-900/60 rounded-lg transition-all flex items-center gap-1.5"
                                    title="Send WhatsApp EOD reminder to all missing members"
                                >
                                    <Send className={`w-3 h-3 ${sendingAction === 'eod_nudge' ? 'animate-pulse' : ''}`} />
                                    <span>{sendingAction === 'eod_nudge' ? 'Nudging...' : 'Nudge All (WhatsApp)'}</span>
                                </button>
                            )}
                        </div>

                        {missingReports.length === 0 ? (
                            <div className="text-center py-8 text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-8 h-8 mx-auto mb-1.5" />
                                <p className="font-bold text-xs">100% Submissions!</p>
                                <p className="text-[11px] text-slate-400 mt-0.5">All active team members logged their EOD report.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[450px] overflow-y-auto">
                                {missingReports.map((member) => (
                                    <div key={member.userId || member.phone} className="py-2.5 flex items-center justify-between">
                                        <div>
                                            <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{member.name}</p>
                                            <p className="text-[10px] text-slate-400">{member.department} · {member.designation || 'Staff'}</p>
                                        </div>
                                        <button
                                            onClick={() => handleNudgeSingleMember(member)}
                                            disabled={nudgingPhone === member.phone}
                                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#587e85]/10 text-[#587e85] hover:bg-[#587e85] hover:text-white transition-colors disabled:opacity-50"
                                            title={`Send WhatsApp reminder via Autopilot Offices Bot to ${member.name}`}
                                        >
                                            {nudgingPhone === member.phone ? 'Sending...' : 'Nudge (Bot)'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right Column: Enrolled Members in tm_members */}
                    <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-xs space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-[#587e85]" />
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                                    Enrolled Task Manager Roster ({members.length})
                                </h3>
                            </div>
                            <span className="text-[11px] text-slate-400">Only enrolled members can use WhatsApp Task Manager</span>
                        </div>

                        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[450px] overflow-y-auto">
                            {members.map((m) => (
                                <div key={m.id} className="py-3 flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <p className="text-xs font-bold text-slate-900 dark:text-white">{m.full_name}</p>
                                            {m.is_superuser && (
                                                <span className="px-2 py-0.2 rounded-full text-[9px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                                                    Superuser
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-slate-400">
                                            {m.department} · {m.designation || 'Staff'} · {m.phone}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500" title="Active" />
                                        <span className="text-xs font-bold text-emerald-600">Active</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Modal: Assign / Create Deliverable ───────────────────────────────── */}
            {showCreateTaskModal && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <h3 className="font-bold text-base text-slate-900 dark:text-white">Assign New Deliverable</h3>
                            <button onClick={() => setShowCreateTaskModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                        </div>

                        <form onSubmit={handleCreateTask} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Deliverable Title</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Review vendor NDA and draft counter terms"
                                    value={newTaskTitle}
                                    onChange={(e) => setNewTaskTitle(e.target.value)}
                                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Department</label>
                                <select
                                    value={newTaskDept}
                                    onChange={(e) => setNewTaskDept(e.target.value)}
                                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                >
                                    {CORPORATE_DEPARTMENTS.map((d) => (
                                        <option key={d} value={d}>{d}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Assignee</label>
                                <select
                                    value={newTaskEmployeeId}
                                    onChange={(e) => setNewTaskEmployeeId(e.target.value)}
                                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                    required
                                >
                                    <option value="">Select team member...</option>
                                    {members.map((m) => (
                                        <option key={m.user_id} value={m.user_id}>
                                            {m.full_name} ({m.department})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateTaskModal(false)}
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#587e85] hover:bg-[#48686e]"
                                >
                                    Assign Deliverable
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal: Enroll Team Member ───────────────────────────────────────── */}
            {showEnrollModal && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <h3 className="font-bold text-base text-slate-900 dark:text-white">Enroll Team Member</h3>
                            <button onClick={() => setShowEnrollModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                        </div>

                        <form onSubmit={handleEnrollMember} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Full Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Priya Sharma"
                                    value={enrollName}
                                    onChange={(e) => setEnrollName(e.target.value)}
                                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">WhatsApp Phone Number</label>
                                <input
                                    type="text"
                                    placeholder="e.g. 9876543210"
                                    value={enrollPhone}
                                    onChange={(e) => setEnrollPhone(e.target.value)}
                                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Department</label>
                                    <select
                                        value={enrollDept}
                                        onChange={(e) => setEnrollDept(e.target.value)}
                                        className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                    >
                                        {CORPORATE_DEPARTMENTS.map((d) => (
                                            <option key={d} value={d}>{d}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Designation</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Senior Frontend Dev"
                                        value={enrollDesignation}
                                        onChange={(e) => setEnrollDesignation(e.target.value)}
                                        className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                                <input
                                    type="checkbox"
                                    id="superuserCheckbox"
                                    checked={enrollIsSuperuser}
                                    onChange={(e) => setEnrollIsSuperuser(e.target.checked)}
                                    className="rounded-md border-slate-300 text-[#587e85] focus:ring-[#587e85]"
                                />
                                <label htmlFor="superuserCheckbox" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                    Grant Superuser Privileges (can query cross-department progress)
                                </label>
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowEnrollModal(false)}
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#587e85] hover:bg-[#48686e]"
                                >
                                    Enroll in Task Manager
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
