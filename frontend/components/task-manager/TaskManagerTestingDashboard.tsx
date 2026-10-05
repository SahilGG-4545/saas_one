"use client";

import React, { useState, useEffect, useRef } from 'react';
import {
    FlaskConical,
    Shield,
    CheckCircle2,
    AlertCircle,
    UserCheck,
    UserX,
    Users,
    Send,
    RefreshCw,
    Search,
    Phone,
    Mail,
    Building2,
    Sparkles,
    ArrowRight,
    MessageSquare,
    HelpCircle,
    Clock,
    Zap,
    Play,
    Check,
    Settings2
} from 'lucide-react';

interface EmployeeItem {
    id: string;
    user_id?: string;
    first_name: string;
    last_name?: string;
    email: string;
    phone: string;
    department: string;
    department_id: string;
    task_role: 'employee' | 'reporting_manager' | 'superuser';
    is_active: boolean;
}

interface TechSummary {
    manager: EmployeeItem | null;
    members: EmployeeItem[];
}

/**
 * 12-Hour Time Picker with AM/PM toggle and compact grid selectors
 * - No scrolling lists
 * - Tapping Hour shows 1-12 grid
 * - Tapping Minute shows 00-55 grid (with exact minute field)
 * - Emits strict 24-hour "HH:mm" to parent
 */
function TwelveHourTimePicker({
    value,
    onChange
}: {
    value: string;
    onChange: (val24: string) => void;
}) {
    const [showHourPicker, setShowHourPicker] = useState(false);
    const [showMinutePicker, setShowMinutePicker] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);

    // Parse 24-hr value ("HH:mm") into 12-hr parts
    const parse24 = (v: string) => {
        const [hRaw, mRaw] = (v || '09:00').split(':');
        let h = parseInt(hRaw, 10);
        if (isNaN(h) || h < 0 || h > 23) h = 9;
        const m = parseInt(mRaw, 10);
        const safeM = isNaN(m) || m < 0 || m > 59 ? '00' : String(m).padStart(2, '0');
        const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
        let h12 = h % 12;
        if (h12 === 0) h12 = 12;
        return { hour12: h12, minuteStr: safeM, period };
    };

    const { hour12, minuteStr, period } = parse24(value);

    // Reconstruct 24-hr string
    const emitChange = (h12: number, mStr: string, p: 'AM' | 'PM') => {
        let h24 = h12 % 12;
        if (p === 'PM') h24 += 12;
        const safeM = String(mStr).padStart(2, '0');
        onChange(`${String(h24).padStart(2, '0')}:${safeM}`);
    };

    // Close on outside click or Escape
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
                setShowHourPicker(false);
                setShowMinutePicker(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowHourPicker(false);
                setShowMinutePicker(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const handleHourSelect = (selectedH: number) => {
        emitChange(selectedH, minuteStr, period);
        setShowHourPicker(false);
        setShowMinutePicker(true); // Smooth auto-advance to minute selection
    };

    const handleMinuteSelect = (selectedM: string) => {
        emitChange(hour12, selectedM, period);
        setShowMinutePicker(false);
    };

    const handlePeriodChange = (newP: 'AM' | 'PM') => {
        if (newP === period) return;
        emitChange(hour12, minuteStr, newP);
    };

    return (
        <div className="relative w-full" ref={pickerRef}>
            <div className="flex items-center gap-2">
                {/* Main display input container */}
                <div className="flex-1 flex items-center bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold shadow-xs hover:border-slate-400 transition-colors focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary">
                    <Clock className="w-4 h-4 text-slate-400 mr-2 flex-shrink-0" />

                    {/* Hour trigger */}
                    <button
                        type="button"
                        onClick={() => {
                            setShowHourPicker(prev => !prev);
                            setShowMinutePicker(false);
                        }}
                        className={`px-2 py-1 rounded-lg text-slate-800 hover:bg-slate-100 font-mono transition-colors text-sm md:text-base font-extrabold ${
                            showHourPicker ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-400' : ''
                        }`}
                        title="Click to select Hour"
                    >
                        {String(hour12).padStart(2, '0')}
                    </button>

                    <span className="text-slate-400 font-bold px-0.5 select-none">:</span>

                    {/* Minute trigger */}
                    <button
                        type="button"
                        onClick={() => {
                            setShowMinutePicker(prev => !prev);
                            setShowHourPicker(false);
                        }}
                        className={`px-2 py-1 rounded-lg text-slate-800 hover:bg-slate-100 font-mono transition-colors text-sm md:text-base font-extrabold ${
                            showMinutePicker ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-400' : ''
                        }`}
                        title="Click to select Minute"
                    >
                        {minuteStr}
                    </button>

                    <div className="ml-auto pl-2">
                        <span className="text-xs font-mono font-bold text-slate-400">
                            IST
                        </span>
                    </div>
                </div>

                {/* AM / PM Toggle buttons side-by-side */}
                <div className="flex items-center p-1 bg-slate-200/80 rounded-xl border border-slate-300/80 shadow-xs flex-shrink-0">
                    <button
                        type="button"
                        onClick={() => handlePeriodChange('AM')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black tracking-wider transition-all ${
                            period === 'AM'
                                ? 'bg-slate-900 text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                    >
                        AM
                    </button>
                    <button
                        type="button"
                        onClick={() => handlePeriodChange('PM')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black tracking-wider transition-all ${
                            period === 'PM'
                                ? 'bg-slate-900 text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                    >
                        PM
                    </button>
                </div>
            </div>

            {/* Popover Grid: Hours (1 to 12) */}
            {showHourPicker && (
                <div className="absolute top-full left-0 mt-2 z-50 w-64 bg-white border border-slate-200 rounded-2xl p-3 shadow-xl animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                            Select Hour
                        </span>
                        <span className="text-xs font-bold text-slate-700 font-mono">
                            {period}
                        </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => (
                            <button
                                key={h}
                                type="button"
                                onClick={() => handleHourSelect(h)}
                                className={`h-10 rounded-xl text-sm font-bold font-mono transition-all flex items-center justify-center ${
                                    hour12 === h
                                        ? 'bg-primary text-white shadow-sm shadow-primary/30 font-black scale-105'
                                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 active:scale-95'
                                }`}
                            >
                                {h}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Popover Grid: Minutes (00 to 55 + exact minute field) */}
            {showMinutePicker && (
                <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-white border border-slate-200 rounded-2xl p-3 shadow-xl animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                            Select Minute
                        </span>
                        <span className="text-xs font-bold text-slate-700 font-mono">
                            {hour12}:{minuteStr} {period}
                        </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                        {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => handleMinuteSelect(m)}
                                className={`h-10 rounded-xl text-sm font-bold font-mono transition-all flex items-center justify-center ${
                                    minuteStr === m
                                        ? 'bg-primary text-white shadow-sm shadow-primary/30 font-black scale-105'
                                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 active:scale-95'
                                }`}
                            >
                                :{m}
                            </button>
                        ))}
                    </div>
                    {/* Exact Minute Input */}
                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-500">Exact Minute:</span>
                        <div className="flex items-center gap-1.5">
                            <input
                                type="number"
                                min="0"
                                max="59"
                                defaultValue={minuteStr}
                                placeholder="00-59"
                                className="w-16 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-center focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val) && val >= 0 && val <= 59) {
                                        emitChange(hour12, String(val).padStart(2, '0'), period);
                                    }
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowMinutePicker(false)}
                                className="px-2.5 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-bold hover:bg-slate-800 transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function TaskManagerTestingDashboard({ orgId }: { orgId?: string }) {
    const [employees, setEmployees] = useState<EmployeeItem[]>([]);
    const [techSummary, setTechSummary] = useState<TechSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
    const [sendKickoff, setSendKickoff] = useState(true);

    // Cron Schedule & Immediate Trigger State
    const [cronTiming, setCronTiming] = useState('09:00');
    const [cronEnabled, setCronEnabled] = useState(true);
    const [whitelistEnabled, setWhitelistEnabled] = useState(false);
    const [cronLastRunDate, setCronLastRunDate] = useState<string | null>(null);
    const [cronLastRunSummary, setCronLastRunSummary] = useState<string | null>(null);
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [triggerLoading, setTriggerLoading] = useState(false);
    const [dryRunMode, setDryRunMode] = useState(true);
    const [currentISTDisplay, setCurrentISTDisplay] = useState('');

    useEffect(() => {
        const updateIST = () => {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', {
                timeZone: 'Asia/Kolkata',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
            setCurrentISTDisplay(timeStr);
        };
        updateIST();
        const interval = setInterval(updateIST, 1000);
        return () => clearInterval(interval);
    }, []);

    const setTimeOffset = (minutesAhead: number) => {
        const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        d.setMinutes(d.getMinutes() + minutesAhead);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        setCronTiming(`${h}:${m}`);
    };

    const [statusMessage, setStatusMessage] = useState<{
        type: 'success' | 'error';
        title: string;
        details?: string;
    } | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/task-manager/manager-role');
            const data = await res.json();
            if (data.success) {
                setEmployees(data.employees || []);
                setTechSummary(data.techSummary || null);

                // Auto-select Sahil Gorde if nothing selected
                if (!selectedEmployeeId) {
                    const sahil = (data.employees || []).find((e: EmployeeItem) =>
                        e.phone?.includes('8433649199') ||
                        (e.first_name?.toLowerCase().includes('sahil') && e.last_name?.toLowerCase().includes('gorde'))
                    );
                    if (sahil) setSelectedEmployeeId(sahil.id);
                    else if (data.employees?.[0]) setSelectedEmployeeId(data.employees[0].id);
                }
            }

            // Also load Testing & Cron Configuration
            try {
                const configRes = await fetch('/api/task-manager/testing-config');
                const configData = await configRes.json();
                if (configData.success && configData.config) {
                    setCronTiming(configData.config.cronTiming || '09:00');
                    setCronEnabled(configData.config.cronEnabled !== false);
                    setWhitelistEnabled(Boolean(configData.config.enabled));
                    setCronLastRunDate(configData.config.cronLastRunDate || null);
                    setCronLastRunSummary(configData.config.cronLastRunSummary || null);
                }
            } catch (cfgErr) {
                console.warn('[TaskManagerTestingDashboard] Failed to load testing config:', cfgErr);
            }
        } catch (err: any) {
            console.error('Failed to load employee list:', err);
            setStatusMessage({
                type: 'error',
                title: 'Error loading employees',
                details: err.message
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSaveSchedule = async () => {
        if (!cronTiming || !/^\d{1,2}:\d{2}$/.test(cronTiming.trim())) {
            setStatusMessage({
                type: 'error',
                title: 'Invalid Time Selected',
                details: 'Please enter a valid dispatch time in HH:mm format (e.g., 09:00 or 12:45).'
            });
            return;
        }
        setSavingSchedule(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cronTiming,
                    cronEnabled,
                    enabled: whitelistEnabled,
                    employees: whitelistEnabled
                        ? [{ name: 'Sahil Gorde', phone: '8433649199' }]
                        : []
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save schedule');
            setStatusMessage({
                type: 'success',
                title: 'Schedule Updated Successfully',
                details: `Cron timing set to ${cronTiming} IST. Master status: ${cronEnabled ? 'Active' : 'Paused'}. Whitelist: ${whitelistEnabled ? 'ON (Only Sahil Gorde)' : 'OFF (All Tech Staff)'}.`
            });
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Failed to update schedule',
                details: err.message
            });
        } finally {
            setSavingSchedule(false);
        }
    };

    const handleManualTrigger = async (action: 'trigger_generate' | 'trigger_dispatch') => {
        setTriggerLoading(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    dryRun: dryRunMode
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to trigger run');

            setStatusMessage({
                type: 'success',
                title: action === 'trigger_generate' ? 'Task Generation Completed' : 'Morning Notification Run Completed',
                details: data.message
            });

            // Refresh to update latest run date and summary
            await fetchData();
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Trigger Execution Failed',
                details: err.message
            });
        } finally {
            setTriggerLoading(false);
        }
    };

    const [animationStep, setAnimationStep] = useState(0);

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        if (loading) {
            setAnimationStep(0);
            return;
        }

        setAnimationStep(0);
        const t1 = setTimeout(() => setAnimationStep(1), 50);
        const t2 = setTimeout(() => setAnimationStep(2), 150);
        const t3 = setTimeout(() => setAnimationStep(3), 280);
        const t4 = setTimeout(() => setAnimationStep(4), 400);
        const t5 = setTimeout(() => setAnimationStep(5), 520);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
            clearTimeout(t4);
            clearTimeout(t5);
        };
    }, [loading]);

    // Filter employees for dropdown
    const filteredEmployees = employees.filter(e => {
        const full = `${e.first_name || ''} ${e.last_name || ''} ${e.email || ''} ${e.phone || ''} ${e.department || ''}`.toLowerCase();
        return full.includes(searchQuery.toLowerCase());
    });

    const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

    // Handle Assign, Remove Role, or Employee Kickoff
    const handleRoleAction = async (action: 'assign_manager' | 'remove_manager' | 'send_employee_kickoff') => {
        if (!selectedEmployee) return;
        setActionLoading(true);
        setStatusMessage(null);

        try {
            const res = await fetch('/api/task-manager/manager-role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId: selectedEmployee.id,
                    action,
                    sendKickoff
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to execute action');
            }

            setStatusMessage({
                type: 'success',
                title: data.message,
                details: data.whatsappDetails || (data.details ? JSON.stringify(data.details) : undefined)
            });

            // Refresh data
            await fetchData();
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                title: 'Operation Failed',
                details: err.message
            });
        } finally {
            setActionLoading(false);
        }
    };

    // Quick select helper
    const quickSelect = (term: string) => {
        const found = employees.find(e =>
            e.phone?.includes(term) ||
            e.first_name?.toLowerCase().includes(term.toLowerCase()) ||
            e.email?.toLowerCase().includes(term.toLowerCase())
        );
        if (found) setSelectedEmployeeId(found.id);
    };

    // Sleek Loading State matching Task Manager
    if (loading) {
        return (
            <div className="w-full min-h-[480px] flex flex-col items-center justify-center p-8 text-center space-y-4 tm-root max-w-[1600px] mx-auto" style={{ zoom: '0.85' }}>
                <div className="relative flex items-center justify-center">
                    <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200/60 flex items-center justify-center shadow-xl shadow-amber-500/10">
                        <FlaskConical className="w-8 h-8 text-amber-600 animate-pulse" />
                    </div>
                    <div className="absolute -inset-2.5 border-2 border-amber-500/20 border-t-amber-600 rounded-3xl animate-spin" />
                </div>
                <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-800">
                        Loading Task Testing Hub...
                    </h3>
                    <p className="text-xs text-slate-400">
                        Syncing live employee roles, whitelist config & automated cron schedule
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div 
            className="w-full space-y-4 p-2 sm:p-4 tm-root overflow-x-hidden max-w-[1600px] mx-auto"
            style={{ zoom: '0.85' }}
        >
            {/* Header Banner */}
            <div className={`bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 ${animationStep >= 1 ? 'tm-slide-down-visible' : 'tm-slide-down-hidden'}`}>
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-amber-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/30 flex-shrink-0">
                        <FlaskConical className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                                Task Manager Testing & Manager Role Manager
                            </h1>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-500 text-white">
                                Beta
                            </span>
                        </div>
                        <p className="text-slate-500 text-sm mt-0.5">
                            Test the reporting manager workflow, switch roles on the fly, and send official WhatsApp kickoff templates.
                        </p>
                    </div>
                </div>

                <button
                    onClick={fetchData}
                    disabled={loading || actionLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-bold text-xs shadow-sm transition-all self-start md:self-auto"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Notification / Toast Alert */}
            {statusMessage && (
                <div className={`p-4 rounded-2xl border flex items-start gap-3 transition-all ${
                    statusMessage.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}>
                    {statusMessage.type === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                    ) : (
                        <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 text-sm">
                        <p className="font-bold">{statusMessage.title}</p>
                        {statusMessage.details && (
                            <p className="text-xs mt-0.5 opacity-90 font-mono">{statusMessage.details}</p>
                        )}
                    </div>
                    <button
                        onClick={() => setStatusMessage(null)}
                        className="text-xs font-bold opacity-60 hover:opacity-100"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Top Grid: Department Live Status */}
            <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${animationStep >= 2 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
                {/* Tech Manager Card */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-primary" /> Active Tech Manager
                    </p>
                    {techSummary?.manager ? (
                        <div>
                            <h3 className="text-base font-bold text-slate-900">
                                {techSummary.manager.first_name} {techSummary.manager.last_name || ''}
                            </h3>
                            <p className="text-xs text-slate-500 font-mono mt-0.5 flex items-center gap-1">
                                <Phone className="w-3 h-3 text-slate-400" />
                                {techSummary.manager.phone || 'No phone'}
                            </p>
                            <span className="inline-block mt-2 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[10px] font-bold">
                                Active Reporting Manager
                            </span>
                        </div>
                    ) : (
                        <div>
                            <p className="text-sm font-bold text-amber-600">No Manager Assigned</p>
                            <p className="text-xs text-slate-400 mt-1">Assign yourself or Lohit below.</p>
                        </div>
                    )}
                </div>

                {/* Team Members in Tech */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm md:col-span-2">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-primary" /> Tech Department Members ({techSummary?.members?.length || 0})
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1">
                        {techSummary?.members?.map(m => (
                            <button
                                key={m.id}
                                onClick={() => setSelectedEmployeeId(m.id)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                                    selectedEmployeeId === m.id
                                        ? 'bg-primary text-white border-primary shadow-sm'
                                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                }`}
                            >
                                <span>{m.first_name} {m.last_name || ''}</span>
                                <span className={`text-[9px] px-1.5 py-0.2 rounded font-extrabold uppercase ${
                                    m.task_role === 'reporting_manager'
                                        ? selectedEmployeeId === m.id ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'
                                        : selectedEmployeeId === m.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                                }`}>
                                    {m.task_role === 'reporting_manager' ? 'Manager' : 'Employee'}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Automated Daily Routine & Cron Timing Card (Phase 3 & 4) */}
            <div className={`bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6 ${animationStep >= 3 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <Clock className="w-5 h-5 text-amber-500" />
                            <h2 className="text-lg font-black text-slate-900 tracking-tight">
                                Automated Daily Routine & Cron Timing
                            </h2>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
                                In-App Schedule
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                            Configure when daily fixed tasks and morning digests are sent to the Tech department. Modifying the time here applies immediately without redeploying.
                        </p>
                    </div>

                    {/* Master Active / Paused Pill */}
                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                            cronEnabled
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                            <span className={`w-2 h-2 rounded-full ${cronEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                            {cronEnabled ? 'Heartbeat Active' : 'Automation Paused'}
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2 border-t border-slate-100">
                    {/* Left: Schedule Configuration */}
                    <div className="space-y-4 bg-slate-50/70 border border-slate-200 rounded-2xl p-5">
                        <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                            <Settings2 className="w-3.5 h-3.5 text-primary" />
                            Schedule Settings
                        </h3>

                        {/* Target Dispatch Time Section */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-700">
                                    Target Dispatch Time (IST)
                                </label>
                                {currentISTDisplay && (
                                    <span className="text-[10px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-xs">
                                        Current IST: {currentISTDisplay}
                                    </span>
                                )}
                            </div>

                            <TwelveHourTimePicker
                                value={cronTiming}
                                onChange={(val) => setCronTiming(val)}
                            />

                            {/* Quick Test Chips */}
                            <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Quick:</span>
                                <button
                                    type="button"
                                    onClick={() => setTimeOffset(2)}
                                    className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-md text-[10px] font-bold transition-colors"
                                    title="Set to 2 minutes from current IST for testing"
                                >
                                    +2m Test
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTimeOffset(5)}
                                    className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-md text-[10px] font-bold transition-colors"
                                    title="Set to 5 minutes from current IST for testing"
                                >
                                    +5m Test
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTimeOffset(10)}
                                    className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-md text-[10px] font-bold transition-colors"
                                    title="Set to 10 minutes from current IST"
                                >
                                    +10m Test
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCronTiming('09:00')}
                                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[10px] font-bold transition-colors"
                                    title="Reset to 09:00 AM standard daily dispatch"
                                >
                                    09:00 AM Standard
                                </button>
                            </div>
                        </div>

                        {/* Automation State Toggle Section */}
                        <div className="pt-1">
                            <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                Automated Daily Routine State
                            </label>
                            <button
                                type="button"
                                onClick={() => setCronEnabled(!cronEnabled)}
                                className={`w-full px-4 py-2.5 rounded-xl border text-sm font-bold transition-all flex items-center justify-between shadow-xs ${
                                    cronEnabled
                                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100/60'
                                        : 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100/60'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <span className={`w-2.5 h-2.5 rounded-full ${cronEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                                    {cronEnabled ? 'Heartbeat: Enabled' : 'Heartbeat: Paused'}
                                </span>
                                <span className="text-xs font-semibold underline opacity-75">
                                    {cronEnabled ? 'Click to Pause' : 'Click to Enable'}
                                </span>
                            </button>
                        </div>

                        {/* Whitelist Protection Toggle */}
                        <div className="pt-1">
                            <label className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100/70 transition-colors">
                                <div>
                                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                        <Shield className="w-3.5 h-3.5 text-primary" />
                                        Testing Whitelist Protection (Sandbox)
                                    </span>
                                    <span className="text-[11px] text-slate-500 block mt-0.5">
                                        {whitelistEnabled ? '🔒 ON: Digests go ONLY to you (Sahil Gorde).' : '👥 OFF: Digests go to all 3 Tech staff (Sahil, Lohit, Harsh).'}
                                    </span>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={whitelistEnabled}
                                    onChange={(e) => setWhitelistEnabled(e.target.checked)}
                                    className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary ml-3 flex-shrink-0"
                                />
                            </label>
                        </div>

                        <button
                            type="button"
                            disabled={savingSchedule}
                            onClick={handleSaveSchedule}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                        >
                            {savingSchedule ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            {savingSchedule ? 'Saving Schedule...' : 'Save Schedule (Applies Instantly)'}
                        </button>
                    </div>

                    {/* Right: Immediate Manual Trigger Actions */}
                    <div className="space-y-4 bg-slate-50/70 border border-slate-200 rounded-2xl p-5">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5 text-amber-500" />
                                Instant Test Actions (Zero-Wait)
                            </h3>

                            {/* Dry-run safety toggle */}
                            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600">
                                <input
                                    type="checkbox"
                                    checked={dryRunMode}
                                    onChange={(e) => setDryRunMode(e.target.checked)}
                                    className="w-3.5 h-3.5 text-primary rounded border-slate-300"
                                />
                                <span>Dry-Run (Simulate)</span>
                            </label>
                        </div>

                        <p className="text-xs text-slate-500">
                            Trigger generation or outbound notification immediately without waiting for the scheduled time. {dryRunMode ? '🛡️ Dry-Run active (simulates digest, 0 WhatsApp messages sent).' : '⚠️ Live Mode: Real WhatsApp messages will be dispatched!'}
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                            <button
                                type="button"
                                disabled={triggerLoading}
                                onClick={() => handleManualTrigger('trigger_generate')}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                            >
                                {triggerLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" /> : <Play className="w-3.5 h-3.5 text-primary" />}
                                {triggerLoading ? 'Processing...' : '⚡ Generate Tasks Now'}
                            </button>

                            <button
                                type="button"
                                disabled={triggerLoading}
                                onClick={() => handleManualTrigger('trigger_dispatch')}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                            >
                                {triggerLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                {triggerLoading ? 'Dispatching...' : '📤 Send Digest Now'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Execution Status Bar */}
                <div className="p-3.5 bg-slate-100/80 border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-600">Latest Run Today:</span>
                        <span className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                            cronLastRunDate === new Date().toISOString().slice(0, 10)
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-700'
                        }`}>
                            {cronLastRunDate === new Date().toISOString().slice(0, 10)
                                ? `✅ Dispatched (${cronLastRunDate})`
                                : `⏳ Pending / Ready for ${cronTiming} IST`}
                        </span>
                    </div>

                    <div className="text-slate-500 font-mono text-[11px] truncate max-w-md">
                        {cronLastRunSummary || 'No runs recorded for today.'}
                    </div>
                </div>
            </div>

            {/* Main Interactive Control Card */}
            <div className={`bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6 ${animationStep >= 4 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
                <div>
                    <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                        <UserCheck className="w-5 h-5 text-primary" />
                        Manager Role Assignment & WhatsApp Kickoff
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                        Select an employee to promote to Reporting Manager or demote back to Employee. When promoted, an official Meta-approved kickoff template is sent to open their 24h WhatsApp window.
                    </p>
                </div>

                {/* Quick Shortcuts */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="font-bold text-slate-400">Quick Select:</span>
                    <button
                        type="button"
                        onClick={() => quickSelect('8433649199')}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition-colors"
                    >
                        👤 Myself (Sahil Gorde)
                    </button>
                    <button
                        type="button"
                        onClick={() => quickSelect('9100256500')}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition-colors"
                    >
                        👑 Lohitaksha Ranganathan
                    </button>
                    <button
                        type="button"
                        onClick={() => quickSelect('7028232515')}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition-colors"
                    >
                        ⚡ Harsh Patil
                    </button>
                </div>

                {/* Dropdown Selector */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                            Select Employee
                        </label>
                        <select
                            value={selectedEmployeeId}
                            onChange={(e) => setSelectedEmployeeId(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        >
                            {employees.map(emp => (
                                <option key={emp.id} value={emp.id}>
                                    {emp.first_name} {emp.last_name || ''} ({emp.department || 'No Dept'}) — [{emp.task_role}]
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Kickoff Template Toggle */}
                    <div className="flex items-center">
                        <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer w-full hover:bg-slate-100/70 transition-colors">
                            <input
                                type="checkbox"
                                checked={sendKickoff}
                                onChange={(e) => setSendKickoff(e.target.checked)}
                                className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary"
                            />
                            <div>
                                <span className="text-xs font-bold text-slate-900 block">
                                    Send Meta-approved WhatsApp Kickoff Template
                                </span>
                                <span className="text-[11px] text-slate-500 block">
                                    Dispatches campaign template to invite the user and open the 24-hr session.
                                </span>
                            </div>
                        </label>
                    </div>
                </div>

                {/* Selected Employee Card */}
                {selectedEmployee && (
                    <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-black text-slate-900">
                                    {selectedEmployee.first_name} {selectedEmployee.last_name || ''}
                                </span>
                                <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                                    selectedEmployee.task_role === 'reporting_manager'
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-slate-300 text-slate-700'
                                }`}>
                                    Current: {selectedEmployee.task_role}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 font-medium">
                                <span className="flex items-center gap-1 font-mono">
                                    <Phone className="w-3 h-3 text-slate-400" />
                                    {selectedEmployee.phone || 'No phone set'}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Mail className="w-3 h-3 text-slate-400" />
                                    {selectedEmployee.email}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Building2 className="w-3 h-3 text-slate-400" />
                                    {selectedEmployee.department || 'Unassigned'}
                                </span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
                            {/* Assign Role Button */}
                            <button
                                type="button"
                                disabled={actionLoading || !selectedEmployee.phone}
                                onClick={() => handleRoleAction('assign_manager')}
                                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-sm hover:shadow transition-all disabled:opacity-50"
                            >
                                {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                                {actionLoading ? 'Assigning...' : 'Assign Reporting Manager & Kickoff'}
                            </button>

                            {/* Send Employee Kickoff Button */}
                            <button
                                type="button"
                                disabled={actionLoading || !selectedEmployee.phone}
                                onClick={() => {
                                    if (window.confirm(`Send official Employee Kickoff (tm_employee_kickoff_v1) to ${selectedEmployee.first_name} on ${selectedEmployee.phone}?`)) {
                                        handleRoleAction('send_employee_kickoff');
                                    }
                                }}
                                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-sm hover:shadow transition-all disabled:opacity-50"
                            >
                                {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                {actionLoading ? 'Sending Kickoff...' : 'Send Employee Kickoff'}
                            </button>

                            {/* Remove Role Button */}
                            <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() => handleRoleAction('remove_manager')}
                                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                            >
                                {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin text-rose-500" /> : <UserX className="w-4 h-4 text-rose-500" />}
                                {actionLoading ? 'Removing...' : 'Remove Manager Role (Revert)'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Meta Approved Templates & WhatsApp Quick Reply Cheatsheet */}
            <div className={`bg-slate-900 text-white rounded-3xl p-6 md:p-8 space-y-5 ${animationStep >= 5 ? 'tm-slide-up-visible' : 'tm-slide-up-hidden'}`}>
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-black tracking-tight flex items-center gap-2 text-white">
                        <Sparkles className="w-5 h-5 text-emerald-400" />
                        Meta Approved Templates & Quick Reply Actions
                    </h3>
                    <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded-lg border border-emerald-800">
                        Meta Approved
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Template 1: Manager */}
                    <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-2xl space-y-2.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-emerald-400 uppercase tracking-wider">
                                Template 1: Manager Kickoff
                            </span>
                            <span className="text-[10px] font-mono bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800">
                                tm_manager_kickoff_v1
                            </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed font-sans">
                            &quot;Greetings from Autopilot Offices 👋<br/>
                            Hello <strong>[Manager]</strong>, you have been assigned as Reporting Manager for <strong>[Tech]</strong>.<br/>
                            Team members: <strong>[Sahil, Harsh]</strong>...&quot;
                        </p>
                        <div className="pt-2 border-t border-slate-700/60 flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-slate-400">Interactive Buttons:</span>
                            <span className="text-[11px] font-mono px-2 py-0.5 bg-slate-700 text-emerald-300 rounded border border-slate-600">
                                [View Team Tasks] → team status
                            </span>
                            <span className="text-[11px] font-mono px-2 py-0.5 bg-slate-700 text-emerald-300 rounded border border-slate-600">
                                [Assign Task] → assign guide
                            </span>
                        </div>
                    </div>

                    {/* Template 2: Employee */}
                    <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-2xl space-y-2.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-indigo-400 uppercase tracking-wider">
                                Template 2: Employee Kickoff
                            </span>
                            <span className="text-[10px] font-mono bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded border border-indigo-800">
                                tm_employee_kickoff_v1
                            </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed font-sans">
                            &quot;Greetings from Autopilot Offices 👋<br/>
                            Hello <strong>[Employee]</strong>, welcome to Autopilot Task Manager.<br/>
                            Department: <strong>[Tech]</strong>. Reporting Manager: <strong>[Lohitaksha]</strong>...&quot;
                        </p>
                        <div className="pt-2 border-t border-slate-700/60 flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-slate-400">Interactive Buttons:</span>
                            <span className="text-[11px] font-mono px-2 py-0.5 bg-slate-700 text-indigo-300 rounded border border-slate-600">
                                [View Tasks] → my tasks list
                            </span>
                        </div>
                    </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center gap-2 text-xs text-slate-400">
                    <MessageSquare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>Tapping any quick reply button immediately opens Meta&apos;s 24-hour conversational window for rich interactive task management.</span>
                </div>
            </div>

            {/* Animation & Responsive Spacing System matching TaskAssignmentDashboard */}
            <style>{`
                .tm-root {
                    zoom: 0.85;
                }
                @media (max-width: 640px) {
                    .tm-root {
                        zoom: 0.92;
                    }
                }

                /* ── Slide Transitions (Shared Base) ─────────────────────────── */
                .tm-slide-left-hidden, .tm-slide-right-hidden,
                .tm-slide-down-hidden, .tm-slide-up-hidden {
                    opacity: 0 !important;
                    pointer-events: none !important;
                    will-change: opacity, transform;
                }

                .tm-slide-left-visible, .tm-slide-right-visible,
                .tm-slide-down-visible, .tm-slide-up-visible {
                    opacity: 1 !important;
                    transform: translate(0, 0) !important;
                    pointer-events: auto !important;
                    will-change: opacity, transform;
                }

                /* Horizontal slides */
                .tm-slide-left-hidden, .tm-slide-left-visible,
                .tm-slide-right-hidden, .tm-slide-right-visible {
                    transition: opacity 800ms cubic-bezier(0.16, 1, 0.3, 1), transform 900ms cubic-bezier(0.16, 1, 0.3, 1) !important;
                }
                .tm-slide-left-hidden  { transform: translateX(-40px) !important; }
                .tm-slide-right-hidden { transform: translateX(40px) !important; }

                /* Vertical slides */
                .tm-slide-down-hidden, .tm-slide-down-visible,
                .tm-slide-up-hidden, .tm-slide-up-visible {
                    transition: opacity 800ms cubic-bezier(0.16, 1, 0.3, 1), transform 900ms cubic-bezier(0.16, 1, 0.3, 1) !important;
                }
                .tm-slide-down-hidden { transform: translateY(-30px) !important; }
                .tm-slide-up-hidden   { transform: translateY(30px) !important; }
            `}</style>
        </div>
    );
}
