"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/frontend/context/AuthContext';
import {
    ClipboardList,
    Plus,
    CheckCircle2,
    Clock,
    UserCheck,
    Building2,
    Calendar,
    Search,
    Filter,
    Shield,
    RefreshCw,
    X,
    Layers,
    AlertCircle,
    User,
    Check,
    TrendingUp,
    BarChart3,
    Trash2,
    Zap
} from 'lucide-react';
import TaskProgressGauge from './TaskProgressGauge';
import { createClient } from '@/frontend/utils/supabase/client';

interface Department {
    id: string;
    name: string;
    code?: string;
}

interface Employee {
    id: string;
    profile_id?: string;
    name: string;
    phone_number: string;
    department_id: string | null;
    department_name: string | null;
    role: 'employee' | 'reporting_manager' | 'superuser';
}

interface TaskTemplate {
    id: string;
    title: string;
    description: string | null;
    department_id: string | null;
    task_type: 'fixed' | 'assigned';
}

interface TaskAssignmentItem {
    id: string;
    task_template_id: string | null;
    title: string;
    description: string | null;
    employee_id: string;
    assigned_date: string;
    status: 'pending' | 'in_progress' | 'completed';
    assigned_by: string | null;
    completed_at: string | null;
    created_at: string;
    employee?: {
        id: string;
        full_name: string;
        phone: string;
    };
    template?: TaskTemplate;
}

// Count-up hook — rolls a number from 0 to target over ~700ms easeOut cubic
function useCountUp(target: number, active: boolean, decimals = 0): string {
    const [display, setDisplay] = useState(0);
    const rafRef = useRef<number | null>(null);
    useEffect(() => {
        if (!active) { setDisplay(0); return; }
        const start = performance.now();
        const duration = 700;
        const tick = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(parseFloat((eased * target).toFixed(decimals)));
            if (progress < 1) rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [target, active]);
    return decimals > 0 ? display.toFixed(decimals) : Math.round(display).toString();
}

export default function TaskAssignmentDashboard({ 
    orgId,
    isSuperuserView = false
}: { 
    orgId?: string;
    isSuperuserView?: boolean;
}) {
    const { user } = useAuth();
    const actorId = user?.id || '';

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Animation gate — setTimeout(60) ensures browser paints opacity:0 BEFORE we add tm-visible
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => { const t = setTimeout(() => setIsMounted(true), 60); return () => clearTimeout(t); }, []);

    // Floating CTA card — springs up 1.5s after mount, session-dismissible
    const [showFloatingCTA, setShowFloatingCTA] = useState(false);
    const [floatingCTADismissed, setFloatingCTADismissed] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setShowFloatingCTA(true), 1500);
        return () => clearTimeout(t);
    }, []);

    // Animated progress bar — fills from 0 → real% after mount
    const [animatedPct, setAnimatedPct] = useState(0);

    // Core Data
    const [actor, setActor] = useState<Employee | null>(null);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [tasks, setTasks] = useState<TaskAssignmentItem[]>([]);
    const [templates, setTemplates] = useState<TaskTemplate[]>([]);
    const [progressData, setProgressData] = useState<any>(null);

    // Filters
    const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));

    // Modals
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [showTemplateModal, setShowTemplateModal] = useState(false);

    // Form: Assign Task
    const [assignTargetEmpId, setAssignTargetEmpId] = useState('');
    const [assignTitle, setAssignTitle] = useState('');
    const [assignDesc, setAssignDesc] = useState('');
    const [assignTemplateId, setAssignTemplateId] = useState<string>('');
    const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);

    // Form: Create Template
    const [newTemplateTitle, setNewTemplateTitle] = useState('');
    const [newTemplateDesc, setNewTemplateDesc] = useState('');
    const [newTemplateType, setNewTemplateType] = useState<'fixed' | 'assigned'>('fixed');
    const [isSubmittingTemplate, setIsSubmittingTemplate] = useState(false);

    // Fetch dashboard data
    const fetchData = async (isManualRefresh = false) => {
        if (!actorId) return;
        if (isManualRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams({
                actorId,
                date: selectedDate,
            });
            if (selectedDeptId && selectedDeptId !== 'all') {
                params.set('departmentId', selectedDeptId);
            }
            if (selectedEmployeeId && selectedEmployeeId !== 'all') {
                params.set('employeeId', selectedEmployeeId);
            }
            if (statusFilter !== 'all') {
                params.set('status', statusFilter);
            }

            const res = await fetch(`/api/task-manager/tasks?${params.toString()}`);
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to load task dashboard data');
            }

            setActor(data.actor);
            setDepartments(data.departments || []);
            setEmployees(data.employees || []);
            setTasks(data.tasks || []);
            setTemplates(data.templates || []);

            // Fetch 3-Level Progress Hierarchy
            try {
                const progRes = await fetch(`/api/task-manager/progress?actorId=${actorId}&date=${selectedDate}`);
                const progJson = await progRes.json();
                if (progJson.success) {
                    setProgressData(progJson.data);
                }
            } catch (progErr) {
                console.warn('[TaskAssignmentDashboard] Progress load error:', progErr);
            }

            // Set initial selected department for manager if locked
            if (data.actor?.role === 'reporting_manager' && data.actor.department_id) {
                setSelectedDeptId(data.actor.department_id);
            }
        } catch (err: any) {
            console.error('[TaskAssignmentDashboard] Fetch error:', err);
            setError(err.message || 'Error loading dashboard');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [actorId, selectedDate, selectedDeptId, selectedEmployeeId, statusFilter]);

    // Realtime Postgres change subscription for live updates (e.g. WhatsApp completions)
    useEffect(() => {
        if (!actorId) return;
        const supabase = createClient();
        const channel = supabase
            .channel('realtime_task_assignments')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, () => {
                fetchData(true);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [actorId, selectedDate, selectedDeptId, selectedEmployeeId, statusFilter]);

    // Derived: Employees available for task assignment
    const assignableEmployees = useMemo(() => {
        if (!actor) return [];
        let list = employees;
        if (actor.role === 'reporting_manager') {
            list = employees.filter(e => e.department_id === actor.department_id);
        } else if (actor.role === 'superuser' && selectedDeptId !== 'all') {
            list = employees.filter(e => e.department_id === selectedDeptId);
        }
        const seen = new Set<string>();
        return list.filter(e => {
            if (!e.id || seen.has(e.id)) return false;
            seen.add(e.id);
            return true;
        });
    }, [employees, actor, selectedDeptId]);

    // Handle Task Assignment Submit
    const handleAssignTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assignTargetEmpId || !assignTitle.trim()) {
            alert('Please select an employee and provide a task title.');
            return;
        }

        setIsSubmittingAssign(true);
        try {
            const res = await fetch('/api/task-manager/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'assign_task',
                    actorId,
                    targetEmployeeId: assignTargetEmpId,
                    title: assignTitle.trim(),
                    description: assignDesc.trim() || undefined,
                    templateId: assignTemplateId || undefined,
                    assignedDate: selectedDate
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to assign task');
            }

            // Reset form and refresh list
            setAssignTitle('');
            setAssignDesc('');
            setAssignTemplateId('');
            setShowAssignModal(false);
            await fetchData(true);
        } catch (err: any) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsSubmittingAssign(false);
        }
    };

    // Handle Create Template Submit
    const handleCreateTemplate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTemplateTitle.trim()) return;

        setIsSubmittingTemplate(true);
        try {
            const deptId = actor?.role === 'reporting_manager' ? actor.department_id : (selectedDeptId !== 'all' ? selectedDeptId : undefined);

            const res = await fetch('/api/task-manager/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_template',
                    actorId,
                    title: newTemplateTitle.trim(),
                    description: newTemplateDesc.trim() || undefined,
                    departmentId: deptId,
                    taskType: newTemplateType
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to create template');
            }

            setNewTemplateTitle('');
            setNewTemplateDesc('');
            setShowTemplateModal(false);
            await fetchData(true);
        } catch (err: any) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsSubmittingTemplate(false);
        }
    };

    // Handle Complete Task
    const handleToggleTaskStatus = async (taskId: string, currentStatus: string) => {
        const nextStatus = currentStatus === 'completed' ? 'pending' : 'completed';
        const isNowCompleted = nextStatus === 'completed';

        // 1. Instant optimistic update to tasks array
        setTasks(prev => prev.map(t => t.id === taskId ? { 
            ...t, 
            status: nextStatus, 
            completed_at: isNowCompleted ? new Date().toISOString() : null 
        } : t));

        // 2. Instant optimistic update to progressData (gauge & matrix)
        setProgressData((prev: any) => {
            if (!prev) return prev;
            const delta = isNowCompleted ? 1 : -1;
            const newCompleted = Math.max(0, (prev.completed ?? 0) + delta);
            const newPending = Math.max(0, (prev.pending ?? 0) - delta);
            const total = prev.total || 1;
            const newPercentage = Math.round((newCompleted / total) * 100);

            const targetTask = tasks.find(t => t.id === taskId);
            const empDeptId = employees.find(e => e.id === targetTask?.employee_id)?.department_id;

            const updatedDepts = prev.departmentProgress?.map((dp: any) => {
                if (dp.departmentId === empDeptId) {
                    const deptCompleted = Math.max(0, dp.completed + delta);
                    const deptTotal = dp.total || 1;
                    return {
                        ...dp,
                        completed: deptCompleted,
                        pending: Math.max(0, dp.pending - delta),
                        percentage: Math.round((deptCompleted / deptTotal) * 100)
                    };
                }
                return dp;
            });

            return {
                ...prev,
                completed: newCompleted,
                pending: newPending,
                percentage: newPercentage,
                departmentProgress: updatedDepts || prev.departmentProgress
            };
        });

        // 3. Persist to API and silently verify with backend
        try {
            const res = await fetch('/api/task-manager/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_status',
                    actorId,
                    taskId,
                    status: nextStatus
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to update task status');
            }

            // Silent sync with backend progress endpoint
            fetch(`/api/task-manager/progress?actorId=${actorId}&date=${selectedDate}`)
                .then(r => r.json())
                .then(json => { if (json.success) setProgressData(json.data); })
                .catch(() => {});
        } catch (err: any) {
            alert(`Action failed: ${err.message}`);
            fetchData(true);
        }
    };

    const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

    const handleDeleteTask = async (taskId: string, title: string) => {
        if (!window.confirm(`Are you sure you want to delete task: "${title}"?`)) return;
        setDeletingTaskId(taskId);
        try {
            const res = await fetch('/api/task-manager/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_task',
                    actorId,
                    taskId
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to delete task');
            }

            // Remove task from state optimistically
            setTasks(prev => prev.filter(t => t.id !== taskId));
        } catch (err: any) {
            alert(`Delete failed: ${err.message}`);
        } finally {
            setDeletingTaskId(null);
        }
    };

    // Filtered tasks display
    const filteredTasks = useMemo(() => {
        return tasks.filter(t => {
            if (searchQuery) {
                const match = t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              (t.employee?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()));
                if (!match) return false;
            }
            return true;
        });
    }, [tasks, searchQuery]);

    const isReportingManager = actor?.role === 'reporting_manager';
    const isSuperuser = actor?.role === 'superuser' || isSuperuserView;

    // Derived 3-tier gauge metrics for Super User Dashboard
    const gaugeMetrics = useMemo(() => {
        // 1. Level 3: Organisation Progress (Outer Arc)
        const orgCompleted = tasks.length > 0 
            ? tasks.filter(t => t.status === 'completed').length 
            : (progressData?.completed ?? 0);
        const orgTotal = tasks.length > 0 
            ? tasks.length 
            : (progressData?.total ?? 0);
        const orgPct = orgTotal > 0 ? Math.round((orgCompleted / orgTotal) * 100) : (progressData?.percentage ?? 100);

        // 2. Level 2: Department Progress (Middle Arc)
        let deptTotal = 0;
        let deptCompleted = 0;
        let deptPct = 100;
        let deptLabel = 'Department Scope';
        let deptSublabel = `${departments.length} Departments`;

        if (selectedDeptId !== 'all') {
            const dData = progressData?.departmentProgress?.find((dp: any) => dp.departmentId === selectedDeptId);
            const deptObj = departments.find(d => d.id === selectedDeptId);
            deptLabel = dData?.departmentName || deptObj?.name || 'Selected Dept';
            const deptEmpIds = new Set(employees.filter(e => e.department_id === selectedDeptId).map(e => e.id));
            const deptTasks = tasks.filter(t => deptEmpIds.has(t.employee_id));
            deptTotal = deptTasks.length || (dData?.total ?? 0);
            deptCompleted = deptTasks.filter(t => t.status === 'completed').length;
            deptPct = deptTotal > 0 ? Math.round((deptCompleted / deptTotal) * 100) : (dData?.percentage ?? 100);
            deptSublabel = `Filtered: ${deptLabel}`;
        } else if (progressData?.departmentProgress && progressData.departmentProgress.length > 0) {
            const deptsWithTasks = progressData.departmentProgress.filter((dp: any) => dp.total > 0);
            if (deptsWithTasks.length > 0) {
                deptTotal = deptsWithTasks.reduce((sum: number, dp: any) => sum + dp.total, 0);
                deptCompleted = deptsWithTasks.reduce((sum: number, dp: any) => sum + dp.completed, 0);
                deptPct = Math.round((deptCompleted / deptTotal) * 100);
            } else {
                deptPct = 100;
            }
            deptLabel = 'All Departments';
            deptSublabel = `Avg across ${progressData.departmentProgress.length} depts`;
        }

        // 3. Level 1: Employee Progress (Inner Arc)
        let empTotal = 0;
        let empCompleted = 0;
        let empPct = 100;
        let empLabel = 'Employee Scope';
        let empSublabel = `${employees.length} Staff Members`;

        if (selectedEmployeeId !== 'all') {
            const empObj = employees.find(e => e.id === selectedEmployeeId);
            empLabel = empObj?.name || 'Selected Employee';
            const empTasks = tasks.filter(t => t.employee_id === selectedEmployeeId);
            empTotal = empTasks.length;
            empCompleted = empTasks.filter(t => t.status === 'completed').length;
            empPct = empTotal > 0 ? Math.round((empCompleted / empTotal) * 100) : 100;
            empSublabel = `Staff: ${empLabel}`;
        } else {
            const allEmpProgs = progressData?.departmentProgress?.flatMap((dp: any) => dp.employeeProgress || []) || [];
            const activeEmpProgs = allEmpProgs.filter((ep: any) => ep.total > 0);
            if (activeEmpProgs.length > 0) {
                empTotal = activeEmpProgs.reduce((sum: number, ep: any) => sum + ep.total, 0);
                empCompleted = activeEmpProgs.reduce((sum: number, ep: any) => sum + ep.completed, 0);
                empPct = Math.round((empCompleted / empTotal) * 100);
                empSublabel = `Avg across ${activeEmpProgs.length} active staff`;
            } else if (tasks.length > 0) {
                empTotal = tasks.length;
                empCompleted = tasks.filter(t => t.status === 'completed').length;
                empPct = Math.round((empCompleted / empTotal) * 100);
            }
        }

        return {
            org: {
                percentage: orgPct,
                completed: orgCompleted,
                total: orgTotal,
                label: 'Organisation Progress',
                sublabel: 'Company-wide Rollup'
            },
            dept: {
                percentage: deptPct,
                completed: deptCompleted,
                total: deptTotal,
                label: deptLabel,
                sublabel: deptSublabel
            },
            employee: {
                percentage: empPct,
                completed: empCompleted,
                total: empTotal,
                label: empLabel,
                sublabel: empSublabel
            }
        };
    }, [progressData, tasks, selectedDeptId, selectedEmployeeId, departments, employees]);

    // Derived quick-stat numbers
    const totalTasks = tasks.length;
    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const pendingCount = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
    const completionRate = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

    // Count-up animated values for stat cards (using top-level hook defined above component)
    const countTotal     = useCountUp(totalTasks,     isMounted);
    const countCompleted = useCountUp(completedCount, isMounted);
    const countPending   = useCountUp(pendingCount,   isMounted);
    const countRate      = useCountUp(completionRate, isMounted);

    // Animated progress bar \u2014 fills from 0 \u2192 real% after progressData loads
    useEffect(() => {
        if (!progressData) return;
        const target = Math.min(100, progressData.percentage ?? 0);
        setAnimatedPct(0);
        const t = setTimeout(() => setAnimatedPct(target), 120);
        return () => clearTimeout(t);
    }, [progressData]);

    return (
        <div className="w-full space-y-5 p-4 sm:p-6 tm-root">

            {/* ── Top Header Bar ──────────────────────────────────────────────── */}
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 tm-slide-up ${isMounted ? 'tm-visible' : ''}`} style={{ transitionDelay: '0ms' }}>
                {/* Left: Title + Role badge */}
                <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center shadow-lg shadow-indigo-500/25 flex-shrink-0">
                        <ClipboardList className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-tight truncate">
                                {isReportingManager
                                    ? 'Manager Task Console'
                                    : isSuperuser
                                    ? 'Task Operations Hub'
                                    : 'Daily Task Console'}
                            </h1>
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide flex-shrink-0 ${
                                isSuperuser
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40'
                                    : isReportingManager
                                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/40'
                                    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-700/40'
                            }`}>
                                <Shield className="w-2.5 h-2.5" />
                                {actor?.role ? actor.role.replace('_', ' ').toUpperCase() : 'USER'}
                            </span>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            {isReportingManager
                                ? `Managing: ${actor?.department_name || 'My Department'}`
                                : isSuperuser
                                ? 'Organisation-wide task assignment & oversight'
                                : 'Your personal task deliverables'}
                        </p>
                    </div>
                </div>

                {/* Right: Controls */}
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap flex-shrink-0">
                    {/* Date Picker */}
                    <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all duration-200 hover:shadow-md">
                        <Calendar className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="bg-transparent border-none text-zinc-700 dark:text-zinc-200 text-sm font-medium focus:outline-none cursor-pointer"
                        />
                    </div>

                    {/* Refresh */}
                    <button
                        onClick={() => fetchData(true)}
                        disabled={refreshing}
                        className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-200 shadow-sm disabled:opacity-50 hover:scale-105 active:scale-95"
                        title="Refresh data"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>

                    {/* Action Buttons */}
                    {(isReportingManager || isSuperuser) && (
                        <>
                            <button
                                onClick={() => setShowTemplateModal(true)}
                                className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all duration-200 shadow-sm hover:shadow-md hover:-translate-y-px active:scale-[0.97] active:shadow-none"
                            >
                                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                                Template
                            </button>
                            <button
                                onClick={() => {
                                    setAssignTargetEmpId(assignableEmployees[0]?.id || '');
                                    setShowAssignModal(true);
                                }}
                                className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/40 transition-all duration-200 hover:-translate-y-px active:scale-[0.96] active:shadow-none"
                            >
                                <Plus className="w-4 h-4" />
                                Assign Task
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Error Banner ────────────────────────────────────────────────── */}
            {error && (
                <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 rounded-2xl text-red-700 dark:text-red-300 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1">{error}</span>
                    <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* ── Quick Stats Row ──────────────────────────────────────────────── */}
            {!loading && totalTasks > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                        {
                            label: 'Total Tasks',
                            displayValue: countTotal,
                            icon: <ClipboardList className="w-4 h-4" />,
                            color: 'text-zinc-600 dark:text-zinc-300',
                            bg: 'bg-zinc-50 dark:bg-zinc-800/60',
                            iconBg: 'bg-zinc-200/70 dark:bg-zinc-700',
                        },
                        {
                            label: 'Completed',
                            displayValue: countCompleted,
                            icon: <CheckCircle2 className="w-4 h-4" />,
                            color: 'text-emerald-700 dark:text-emerald-400',
                            bg: 'bg-emerald-50 dark:bg-emerald-950/30',
                            iconBg: 'bg-emerald-200/70 dark:bg-emerald-900/60',
                        },
                        {
                            label: 'Pending',
                            displayValue: countPending,
                            icon: <Clock className="w-4 h-4" />,
                            color: 'text-amber-700 dark:text-amber-400',
                            bg: 'bg-amber-50 dark:bg-amber-950/30',
                            iconBg: 'bg-amber-200/70 dark:bg-amber-900/60',
                        },
                        {
                            label: 'Completion Rate',
                            displayValue: `${countRate}%`,
                            icon: <TrendingUp className="w-4 h-4" />,
                            color: completionRate >= 80 ? 'text-indigo-700 dark:text-indigo-400' : 'text-orange-700 dark:text-orange-400',
                            bg: completionRate >= 80 ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'bg-orange-50 dark:bg-orange-950/30',
                            iconBg: completionRate >= 80 ? 'bg-indigo-200/70 dark:bg-indigo-900/60' : 'bg-orange-200/70 dark:bg-orange-900/60',
                        },
                    ].map((stat, i) => (
                        <div
                            key={i}
                            className={`${stat.bg} rounded-2xl p-4 border border-transparent flex items-center gap-3 tm-slide-up ${isMounted ? 'tm-visible' : ''}`}
                            style={{ transitionDelay: `${100 + i * 70}ms` }}
                        >
                            <div className={`${stat.iconBg} ${stat.color} w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0`}>
                                {stat.icon}
                            </div>
                            <div className="min-w-0">
                                <div className={`text-xl font-bold tabular-nums ${stat.color} leading-tight`}>{stat.displayValue}</div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{stat.label}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── 3-Arc Dynamic Progress Gauge (Superuser only) ───────────────── */}
            {isSuperuser && (
                <div className={`tm-slide-up ${isMounted ? 'tm-visible' : ''}`} style={{ transitionDelay: '160ms' }}>
                    <TaskProgressGauge
                        orgProgress={gaugeMetrics.org}
                        deptProgress={gaugeMetrics.dept}
                        employeeProgress={gaugeMetrics.employee}
                    />
                </div>
            )}

            {/* ── Progress Overview Card ───────────────────────────────────────── */}
            {progressData && (
                <div className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm tm-slide-up ${isMounted ? 'tm-visible' : ''}`} style={{ transitionDelay: '200ms' }}>
                    {/* Card Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800/80">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                                <TrendingUp className="w-4 h-4" />
                            </div>
                            <div>
                                <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                    {isSuperuser
                                        ? 'Organisation Progress'
                                        : isReportingManager
                                        ? `${actor?.department_name || 'Department'} Progress`
                                        : 'Your Task Progress'}
                                </h2>
                                <p className="text-xs text-zinc-400 mt-0.5">
                                    {isSuperuser
                                        ? `Consolidated across ${progressData.totalDepartments ?? departments.length} departments`
                                        : 'Real-time daily task completion status'}
                                </p>
                            </div>
                        </div>

                        {/* Metric badges */}
                        <div className="flex items-center gap-2 text-xs font-semibold flex-wrap">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                                <Layers className="w-3 h-3 text-zinc-400" />
                                <span>{progressData.total ?? tasks.length} Total</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                <span>{progressData.completed ?? 0} Done</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
                                <Clock className="w-3 h-3 text-amber-500" />
                                <span>{progressData.pending ?? 0} Pending</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold">
                                <BarChart3 className="w-3 h-3 text-indigo-500" />
                                <span>{progressData.percentage ?? 0}%</span>
                            </div>
                        </div>
                    </div>

                    {/* Progress Bar — animates from 0 → real% on mount */}
                    <div className="px-5 pt-4 pb-1">
                        <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden">
                            <div
                                className="bg-gradient-to-r from-indigo-500 via-emerald-500 to-teal-400 h-full rounded-full"
                                style={{
                                    width: `${animatedPct}%`,
                                    transition: 'width 900ms cubic-bezier(0.16, 1, 0.3, 1)'
                                }}
                            />
                        </div>
                    </div>

                    {/* Department Progress Matrix (Superuser View) */}
                    {isSuperuser && progressData.departmentProgress && progressData.departmentProgress.length > 0 && (
                        <div className="px-5 pb-5 pt-4">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                                    Department Breakdown · {progressData.departmentProgress.length} depts
                                </span>
                                <span className="text-[11px] text-zinc-400">Click to filter</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-2">
                                {progressData.departmentProgress.map((dp: any, dIdx: number) => {
                                    const isDeptActive = selectedDeptId === dp.departmentId;
                                    const isComplete = dp.percentage === 100;
                                    return (
                                        <button
                                            key={dp.departmentId}
                                            onClick={() => {
                                                setSelectedDeptId(isDeptActive ? 'all' : dp.departmentId);
                                                setSelectedEmployeeId('all');
                                            }}
                                            className={`group p-3 rounded-xl border text-left transition-all duration-200 text-xs flex flex-col justify-between gap-2 hover:scale-[1.03] hover:-translate-y-px active:scale-[0.97] tm-slide-up ${isMounted ? 'tm-visible' : ''} ${
                                                isDeptActive
                                                    ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-400/30 shadow-sm'
                                                    : 'bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700/60 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-white dark:hover:bg-zinc-800/80 hover:shadow-md'
                                            }`}
                                            style={{ transitionDelay: `${220 + dIdx * 55}ms` }}
                                        >
                                            <div className={`font-semibold leading-tight truncate ${isDeptActive ? 'text-indigo-800 dark:text-indigo-200' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                                {dp.departmentName}
                                            </div>
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-zinc-400 dark:text-zinc-500">{dp.completed}/{dp.total}</span>
                                                    <span className={`font-bold ${isComplete ? 'text-emerald-600 dark:text-emerald-400' : isDeptActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                                                        {dp.percentage}%
                                                    </span>
                                                </div>
                                                <div className="w-full bg-zinc-200 dark:bg-zinc-700 h-1 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full ${isComplete ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                                                        style={{
                                                            width: isMounted ? `${dp.percentage}%` : '0%',
                                                            transition: `width 600ms cubic-bezier(0.16, 1, 0.3, 1) ${240 + dIdx * 55}ms`
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Main Content Grid ────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

                {/* Left Column: Scope Selectors */}
                <div className={`lg:col-span-4 xl:col-span-3 space-y-4 tm-slide-up ${isMounted ? 'tm-visible' : ''}`} style={{ transitionDelay: '240ms' }}>

                    {/* Department Scope Card */}
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/80">
                            <div className="flex items-center gap-2">
                                <Building2 className="w-3.5 h-3.5 text-zinc-400" />
                                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Department</span>
                            </div>
                            <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-full">
                                Step 1
                            </span>
                        </div>

                        <div className="p-4">
                            {isReportingManager ? (
                                <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/60 rounded-xl">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center flex-shrink-0">
                                        <Building2 className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 leading-tight truncate">
                                            {actor?.department_name || 'My Department'}
                                        </div>
                                        <div className="text-[11px] text-indigo-500 dark:text-indigo-400 mt-0.5">Scope locked to your department</div>
                                    </div>
                                </div>
                            ) : isSuperuser ? (
                                <div className="space-y-2">
                                    <label className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Filter by department</label>
                                    <select
                                        value={selectedDeptId}
                                        onChange={(e) => {
                                            setSelectedDeptId(e.target.value);
                                            setSelectedEmployeeId('all');
                                        }}
                                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-800 dark:text-zinc-200 font-medium focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all cursor-pointer"
                                    >
                                        <option value="all">All Departments ({departments.length})</option>
                                        {departments.map(d => (
                                            <option key={d.id} value={d.id}>{d.name}</option>
                                        ))}
                                    </select>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {/* Employee Selector Card */}
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/80">
                            <div className="flex items-center gap-2">
                                <UserCheck className="w-3.5 h-3.5 text-zinc-400" />
                                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Staff</span>
                            </div>
                            <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-full">
                                {assignableEmployees.length}
                            </span>
                        </div>

                        <div className="max-h-[420px] overflow-y-auto">
                            <div className="p-2 space-y-0.5">
                                {/* All Staff button */}
                                <button
                                    onClick={() => setSelectedEmployeeId('all')}
                                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 flex items-center justify-between hover:translate-x-0.5 active:scale-[0.98] ${
                                        selectedEmployeeId === 'all'
                                            ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400'
                                    }`}
                                >
                                    <span className="flex items-center gap-2.5 text-sm">
                                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                            selectedEmployeeId === 'all' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                                        }`}>
                                            <Layers className="w-3.5 h-3.5" />
                                        </span>
                                        <span className="font-semibold">All Staff</span>
                                    </span>
                                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                                        selectedEmployeeId === 'all'
                                            ? 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300'
                                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                                    }`}>
                                        {tasks.length}
                                    </span>
                                </button>

                                {/* Divider */}
                                {assignableEmployees.length > 0 && (
                                    <div className="my-1 border-t border-zinc-100 dark:border-zinc-800/80 mx-2" />
                                )}

                                {/* Employee list */}
                                {assignableEmployees.map(emp => {
                                    const empTasks = tasks.filter(t => t.employee_id === emp.id);
                                    const empCompleted = empTasks.filter(t => t.status === 'completed').length;
                                    const empPct = empTasks.length > 0 ? Math.round((empCompleted / empTasks.length) * 100) : null;
                                    const isSelected = selectedEmployeeId === emp.id;
                                    const initials = emp.name.trim().split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();

                                    return (
                                        <button
                                            key={emp.id}
                                            onClick={() => setSelectedEmployeeId(emp.id)}
                                            className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 flex items-center justify-between hover:translate-x-0.5 active:scale-[0.98] ${
                                                isSelected
                                                    ? 'bg-indigo-50 dark:bg-indigo-950/40'
                                                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-black ${
                                                    isSelected
                                                        ? 'bg-indigo-600 text-white'
                                                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                                                }`}>
                                                    {initials}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className={`text-sm font-semibold leading-tight truncate ${isSelected ? 'text-indigo-800 dark:text-indigo-200' : 'text-zinc-800 dark:text-zinc-200'}`}>
                                                        {emp.name}
                                                    </div>
                                                    <div className="text-[11px] text-zinc-400 leading-tight truncate">
                                                        {emp.department_name || 'Staff'}
                                                    </div>
                                                </div>
                                            </div>
                                            {empPct !== null ? (
                                                <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${
                                                    empPct === 100
                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                        : isSelected
                                                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300'
                                                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                                                }`}>
                                                    {empPct}%
                                                </span>
                                            ) : (
                                                <span className="text-[11px] text-zinc-300 dark:text-zinc-600 font-medium flex-shrink-0">—</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Task List */}
                <div className={`lg:col-span-8 xl:col-span-9 space-y-4 tm-slide-up ${isMounted ? 'tm-visible' : ''}`} style={{ transitionDelay: '280ms' }}>

                    {/* Filter / Search Bar */}
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-4 py-3 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 w-full sm:w-auto">
                            <Filter className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                            {/* Status tab switcher */}
                            <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl gap-0.5">
                                {([
                                    { key: 'all' as const, label: 'All', count: tasks.length },
                                    { key: 'pending' as const, label: 'Pending', count: pendingCount },
                                    { key: 'completed' as const, label: 'Done', count: completedCount },
                                ]).map(tab => (
                                    <button
                                        key={tab.key}
                                        onClick={() => setStatusFilter(tab.key)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 ${
                                            statusFilter === tab.key
                                                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                                        }`}
                                    >
                                        {tab.label}
                                        {tab.count > 0 && (
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                                statusFilter === tab.key
                                                    ? tab.key === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                    : tab.key === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                                    : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                                                    : 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                                            }`}>
                                                {tab.count}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Search input */}
                        <div className="relative w-full sm:w-60">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search tasks or staff..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Task Cards Area */}
                    {loading ? (
                        /* Loading skeleton */
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-sm animate-pulse">
                                    <div className="flex items-start gap-3">
                                        <div className="w-5 h-5 rounded-md bg-zinc-200 dark:bg-zinc-700 flex-shrink-0 mt-0.5" />
                                        <div className="flex-1 space-y-2">
                                            <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded-lg w-2/3" />
                                            <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg w-1/3" />
                                        </div>
                                        <div className="h-6 w-16 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : filteredTasks.length === 0 ? (
                        /* Empty state */
                        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-12 shadow-sm text-center flex flex-col items-center gap-3">
                            <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                                <ClipboardList className="w-7 h-7 text-zinc-300 dark:text-zinc-600" />
                            </div>
                            <div>
                                <div className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                                    {searchQuery ? 'No matching tasks' : 'No tasks for this date'}
                                </div>
                                <p className="text-xs text-zinc-400 mt-1">
                                    {searchQuery
                                        ? 'Try a different search term or clear the filter.'
                                        : 'Use "Assign Task" to delegate a deliverable to a staff member.'}
                                </p>
                            </div>
                            {(isReportingManager || isSuperuser) && !searchQuery && (
                                <button
                                    onClick={() => {
                                        setAssignTargetEmpId(assignableEmployees[0]?.id || '');
                                        setShowAssignModal(true);
                                    }}
                                    className="mt-1 flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/20 transition-all"
                                >
                                    <Plus className="w-4 h-4" />
                                    Assign First Task
                                </button>
                            )}
                        </div>
                    ) : (
                        /* Task list */
                        <div className="space-y-2">
                            {filteredTasks.map((task, tIdx) => {
                                const isDone = task.status === 'completed';
                                const isDeleting = deletingTaskId === task.id;
                                return (
                                    <div
                                        key={task.id}
                                        className={`group bg-white dark:bg-zinc-900 border rounded-2xl px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-px tm-slide-up ${isMounted ? 'tm-visible' : ''} ${
                                            isDone
                                                ? 'border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10'
                                                : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                                        }`}
                                        style={{ transitionDelay: `${320 + tIdx * 45}ms` }}
                                    >
                                        <div className="flex items-start gap-3">
                                            {/* Checkbox */}
                                            <button
                                                onClick={() => handleToggleTaskStatus(task.id, task.status)}
                                                className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 flex-shrink-0 hover:scale-110 active:scale-90 ${
                                                    isDone
                                                        ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                                                        : 'border-zinc-300 dark:border-zinc-600 hover:border-indigo-400 dark:hover:border-indigo-500 text-transparent hover:bg-indigo-50 dark:hover:bg-indigo-950/30'
                                                }`}
                                                title={isDone ? 'Mark as pending' : 'Mark as completed'}
                                            >
                                                <Check className="w-3 h-3" />
                                            </button>

                                            {/* Task content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className={`text-sm font-semibold leading-snug transition-all duration-300 ${
                                                                isDone
                                                                    ? 'line-through text-zinc-400 dark:text-zinc-500'
                                                                    : 'text-zinc-900 dark:text-zinc-100'
                                                            }`}>
                                                                {task.title}
                                                            </span>
                                                            {task.template && (
                                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 border border-blue-200/60 dark:border-blue-900/60 flex-shrink-0">
                                                                    {task.template.task_type === 'fixed'
                                                                        ? <Zap className="w-2.5 h-2.5" />
                                                                        : <Layers className="w-2.5 h-2.5" />}
                                                                    {task.template.task_type.toUpperCase()}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {task.description && (
                                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-1">
                                                                {task.description}
                                                            </p>
                                                        )}

                                                        {/* Meta row */}
                                                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                            <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                                                <div className="w-4 h-4 rounded-md bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[9px] font-black text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                                                                    {(task.employee?.full_name || 'S').charAt(0).toUpperCase()}
                                                                </div>
                                                                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                                                                    {task.employee?.full_name || 'Staff Member'}
                                                                </span>
                                                            </div>
                                                            <span className="text-zinc-300 dark:text-zinc-700">·</span>
                                                            <span className="text-xs text-zinc-400">{task.assigned_date}</span>
                                                            {task.completed_at && (
                                                                <>
                                                                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                                                                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                                        <CheckCircle2 className="w-3 h-3" />
                                                                        {new Date(task.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Status + delete */}
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all duration-300 ${
                                                            isDone
                                                                ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                                                : 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                                                        }`}>
                                                            {isDone ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                                                            {isDone ? 'Done' : 'Pending'}
                                                        </span>

                                                        {(actor?.role === 'reporting_manager' || actor?.role === 'superuser' || task.assigned_by === actorId) && (
                                                            <button
                                                                type="button"
                                                                disabled={isDeleting}
                                                                onClick={() => handleDeleteTask(task.id, task.title)}
                                                                className="opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 p-1.5 text-zinc-300 dark:text-zinc-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-all duration-200 disabled:opacity-30 hover:scale-110 active:scale-90"
                                                                title="Delete task"
                                                            >
                                                                {isDeleting ? (
                                                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                                ) : (
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Syncing indicator */}
                    {refreshing && !loading && (
                        <div className="flex items-center justify-center gap-2 py-3 text-xs text-zinc-400">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Syncing latest data...
                        </div>
                    )}
                </div>
            </div>

            {/* ── Modal: Assign Task ───────────────────────────────────────────── */}
            {showAssignModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
                >
                    <div
                        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden"
                        style={{ animation: 'tmModalIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-zinc-100 dark:border-zinc-800">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/30">
                                    <Plus className="w-4 h-4" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Assign New Task</h3>
                                    <p className="text-xs text-zinc-400 mt-0.5">Delegate a deliverable for {selectedDate}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowAssignModal(false)}
                                className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handleAssignTask} className="px-6 py-5 space-y-4">
                            {/* Assignee */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                    Assignee <span className="text-rose-500">*</span>
                                </label>
                                <select
                                    value={assignTargetEmpId}
                                    onChange={(e) => setAssignTargetEmpId(e.target.value)}
                                    required
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 font-medium focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all"
                                >
                                    {assignableEmployees.map(emp => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.name} — {emp.department_name || 'Staff'}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Template quick-select */}
                            {templates.length > 0 && (
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                        Template <span className="text-zinc-400 font-normal normal-case">(optional)</span>
                                    </label>
                                    <select
                                        value={assignTemplateId}
                                        onChange={(e) => {
                                            const tId = e.target.value;
                                            setAssignTemplateId(tId);
                                            const tmpl = templates.find(t => t.id === tId);
                                            if (tmpl) {
                                                setAssignTitle(tmpl.title);
                                                if (tmpl.description) setAssignDesc(tmpl.description);
                                            }
                                        }}
                                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all"
                                    >
                                        <option value="">Custom task (no template)</option>
                                        {templates.map(tmpl => (
                                            <option key={tmpl.id} value={tmpl.id}>
                                                [{tmpl.task_type.toUpperCase()}] {tmpl.title}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Title */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                    Task Title <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Clean Room 101, Prepare Q3 Audit"
                                    value={assignTitle}
                                    onChange={(e) => setAssignTitle(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all"
                                />
                            </div>

                            {/* Description */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                    Notes <span className="text-zinc-400 font-normal normal-case">(optional)</span>
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="Additional instructions or context..."
                                    value={assignDesc}
                                    onChange={(e) => setAssignDesc(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all resize-none"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                                <button
                                    type="button"
                                    onClick={() => setShowAssignModal(false)}
                                    className="px-4 py-2 text-sm font-semibold rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all duration-150 active:scale-95"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmittingAssign}
                                    className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-px active:scale-[0.96] active:shadow-none"
                                >
                                    {isSubmittingAssign ? (
                                        <>
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            Assigning...
                                        </>
                                    ) : (
                                        <>
                                            <Check className="w-3.5 h-3.5" />
                                            Assign Task
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal: Create Template ────────────────────────────────────────── */}
            {showTemplateModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
                >
                    <div
                        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden"
                        style={{ animation: 'tmModalIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-zinc-100 dark:border-zinc-800">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-violet-500/30">
                                    <Layers className="w-4 h-4" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Create Task Template</h3>
                                    <p className="text-xs text-zinc-400 mt-0.5">Reusable template for recurring deliverables</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowTemplateModal(false)}
                                className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateTemplate} className="px-6 py-5 space-y-4">
                            {/* Template Title */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                    Template Title <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Clean Meeting Room A, Submit Daily Report"
                                    value={newTemplateTitle}
                                    onChange={(e) => setNewTemplateTitle(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all"
                                />
                            </div>

                            {/* Task Type */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">Task Type</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setNewTemplateType('fixed')}
                                        className={`p-3 rounded-xl border text-sm font-semibold transition-all flex flex-col items-center gap-1.5 ${
                                            newTemplateType === 'fixed'
                                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-400/20'
                                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                        }`}
                                    >
                                        <Zap className={`w-4 h-4 ${newTemplateType === 'fixed' ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'}`} />
                                        Fixed Daily
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setNewTemplateType('assigned')}
                                        className={`p-3 rounded-xl border text-sm font-semibold transition-all flex flex-col items-center gap-1.5 ${
                                            newTemplateType === 'assigned'
                                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-400/20'
                                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                        }`}
                                    >
                                        <UserCheck className={`w-4 h-4 ${newTemplateType === 'assigned' ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'}`} />
                                        Ad-Hoc
                                    </button>
                                </div>
                            </div>

                            {/* Description */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                    SOP Note <span className="text-zinc-400 font-normal normal-case">(optional)</span>
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="Standard operating procedure or instructions..."
                                    value={newTemplateDesc}
                                    onChange={(e) => setNewTemplateDesc(e.target.value)}
                                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:outline-none transition-all resize-none"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                                <button
                                    type="button"
                                    onClick={() => setShowTemplateModal(false)}
                                    className="px-4 py-2 text-sm font-semibold rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all duration-150 active:scale-95"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmittingTemplate}
                                    className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-px active:scale-[0.96] active:shadow-none"
                                >
                                    {isSubmittingTemplate ? (
                                        <>
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Check className="w-3.5 h-3.5" />
                                            Save Template
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Floating Quick-Assign CTA Card ─────────────────────────────── */}
            {(isReportingManager || isSuperuser) && !floatingCTADismissed && (
                <div
                    className="fixed bottom-6 right-6 z-40 w-72"
                    style={{
                        animation: showFloatingCTA
                            ? 'tmFloatIn 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
                            : 'none',
                        opacity: showFloatingCTA ? 1 : 0,
                        pointerEvents: showFloatingCTA ? 'auto' : 'none',
                    }}
                >
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl shadow-black/10 overflow-hidden">
                        {/* Gradient accent strip */}
                        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-600" />
                        <div className="p-4">
                            <div className="flex items-start justify-between mb-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/25 flex-shrink-0">
                                    <Plus className="w-5 h-5 text-white" />
                                </div>
                                <button
                                    onClick={() => setFloatingCTADismissed(true)}
                                    className="p-1 text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 rounded-lg transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <div className="mb-3">
                                <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                                    Ready to assign tasks?
                                </h4>
                                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                                    Delegate daily deliverables to your team in seconds.
                                </p>
                            </div>
                            <div className="space-y-1.5 mb-4">
                                {[
                                    { icon: <Check className="w-3 h-3" />, text: 'Pick an employee' },
                                    { icon: <Check className="w-3 h-3" />, text: 'Set task title & notes' },
                                    { icon: <Check className="w-3 h-3" />, text: 'Track completion live' },
                                ].map((item, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                        <span className="w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
                                            {item.icon}
                                        </span>
                                        {item.text}
                                    </div>
                                ))}
                            </div>
                            <button
                                onClick={() => {
                                    setAssignTargetEmpId(assignableEmployees[0]?.id || '');
                                    setShowAssignModal(true);
                                    setFloatingCTADismissed(true);
                                }}
                                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all duration-200 hover:-translate-y-px active:scale-[0.97]"
                            >
                                <Plus className="w-4 h-4" />
                                Assign First Task
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Animation system */}
            <style>{`
                /* ── Entrance: fade + slide-up ─────────────────────────────────── */
                .tm-slide-up {
                    opacity: 0;
                    transform: translateY(18px);
                    transition:
                        opacity 480ms cubic-bezier(0.16, 1, 0.3, 1),
                        transform 480ms cubic-bezier(0.16, 1, 0.3, 1);
                }
                .tm-slide-up.tm-visible {
                    opacity: 1;
                    transform: translateY(0);
                }

                /* ── Modal spring-in ──────────────────────────────────────────── */
                @keyframes tmModalIn {
                    from { opacity: 0; transform: scale(0.93) translateY(10px); }
                    to   { opacity: 1; transform: scale(1) translateY(0); }
                }

                /* ── Floating CTA card spring-up from bottom ──────────────────── */
                @keyframes tmFloatIn {
                    0%   { opacity: 0; transform: translateY(60px) scale(0.92); }
                    60%  { opacity: 1; }
                    100% { opacity: 1; transform: translateY(0) scale(1); }
                }

                /* ── prefers-reduced-motion: kill all entrance + micro-animations ── */
                @media (prefers-reduced-motion: reduce) {
                    .tm-slide-up,
                    .tm-slide-up.tm-visible {
                        opacity: 1 !important;
                        transform: none !important;
                        transition: none !important;
                    }
                    .tm-root * {
                        transition-duration: 0.01ms !important;
                        animation-duration: 0.01ms !important;
                    }
                }
            `}</style>
        </div>
    );
}
