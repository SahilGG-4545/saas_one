"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/frontend/context/AuthContext';
import {
    FlaskConical,
    Save,
    Send,
    Plus,
    Trash2,
    CheckCircle2,
    AlertCircle,
    UserCheck,
    Users,
    Shield,
    Phone,
    Info,
    RefreshCw
} from 'lucide-react';

interface TestEmployee {
    name: string;
    phone: string;
}

interface TestingConfig {
    enabled: boolean;
    manager: {
        name: string;
        phone: string;
    };
    notifyManager: boolean;
    employees: TestEmployee[];
}

export default function TaskManagerTestingDashboard({ orgId }: { orgId?: string }) {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [sendingDigest, setSendingDigest] = useState(false);
    const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Form state
    const [enabled, setEnabled] = useState(false);
    const [managerName, setManagerName] = useState('');
    const [managerPhone, setManagerPhone] = useState('');
    const [notifyManager, setNotifyManager] = useState(false);

    // Employee List
    const [employees, setEmployees] = useState<TestEmployee[]>([]);
    const [newEmpName, setNewEmpName] = useState('');
    const [newEmpPhone, setNewEmpPhone] = useState('');

    // Load config on mount
    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/task-manager/testing-config');
            const data = await res.json();
            if (data.success && data.config) {
                setEnabled(Boolean(data.config.enabled));
                setManagerName(data.config.manager?.name || '');
                setManagerPhone(data.config.manager?.phone || '');
                setNotifyManager(Boolean(data.config.notifyManager));
                setEmployees(data.config.employees || []);
            }
        } catch (err: any) {
            console.error('[TestingDashboard] Load error:', err);
            setStatusMessage({ type: 'error', text: 'Failed to load testing configuration' });
        } finally {
            setLoading(false);
        }
    };

    const handleAddEmployee = (e: React.FormEvent) => {
        e.preventDefault();
        const name = newEmpName.trim();
        const phone = newEmpPhone.trim();

        if (!name || !phone) {
            alert('Please enter both name and phone number');
            return;
        }

        if (phone.replace(/\D/g, '').length < 10) {
            alert('Please enter a valid 10-digit phone number');
            return;
        }

        setEmployees(prev => [...prev, { name, phone }]);
        setNewEmpName('');
        setNewEmpPhone('');
    };

    const handleRemoveEmployee = (index: number) => {
        setEmployees(prev => prev.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        setSaving(true);
        setStatusMessage(null);

        const payload: TestingConfig = {
            enabled,
            manager: {
                name: managerName.trim(),
                phone: managerPhone.trim()
            },
            notifyManager,
            employees
        };

        try {
            const res = await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (data.success) {
                setStatusMessage({ type: 'success', text: 'Testing configuration saved successfully!' });
            } else {
                setStatusMessage({ type: 'error', text: data.error || 'Failed to save configuration' });
            }
        } catch (err: any) {
            setStatusMessage({ type: 'error', text: err?.message || 'Network error saving config' });
        } finally {
            setSaving(false);
        }
    };

    const handleSendTestDigest = async () => {
        if (!confirm('This will trigger the WhatsApp task digest for the whitelisted phone numbers. Continue?')) {
            return;
        }

        setSendingDigest(true);
        setStatusMessage(null);

        try {
            // First save latest config to ensure whitelist is up to date
            await fetch('/api/task-manager/testing-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: true, // Auto-enable test mode during test trigger
                    manager: { name: managerName.trim(), phone: managerPhone.trim() },
                    notifyManager,
                    employees
                })
            });
            setEnabled(true);

            // Trigger morning notification
            const actorParam = user?.id ? `&actorId=${user.id}` : '';
            const res = await fetch(`/api/task-manager/cron/morning-notifications?confirm=yes${actorParam}`);
            const data = await res.json();

            if (data.success) {
                const count = data.notificationResult?.notificationsSent ?? 0;
                setStatusMessage({
                    type: 'success',
                    text: `WhatsApp digest dispatched! ${count} message(s) sent to whitelisted test recipients.`
                });
            } else {
                setStatusMessage({ type: 'error', text: data.error || 'Failed to trigger test notification' });
            }
        } catch (err: any) {
            setStatusMessage({ type: 'error', text: err?.message || 'Error triggering notification' });
        } finally {
            setSendingDigest(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12 text-zinc-500">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                <span>Loading testing configuration...</span>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
            {/* Header Banner */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                            <FlaskConical className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                                Task Manager Testing & Whitelist
                                <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full uppercase ${
                                    enabled
                                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700'
                                }`}>
                                    {enabled ? 'Active (Restricted)' : 'Disabled (Org-Wide)'}
                                </span>
                            </h2>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                Ensure WhatsApp task messages are sent only to specific people during your test.
                            </p>
                        </div>
                    </div>

                    {/* Master Switch */}
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => setEnabled(e.target.checked)}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-emerald-600"></div>
                        <span className="ml-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                            {enabled ? 'Testing Whitelist ON' : 'Testing Whitelist OFF'}
                        </span>
                    </label>
                </div>

                {enabled && (
                    <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                            <strong>Safeguard Active:</strong> Real employees will <u>never</u> receive WhatsApp messages or notifications while this is enabled. Only the numbers configured below can send and receive task messages.
                        </div>
                    </div>
                )}
            </div>

            {/* Status Alert Toast */}
            {statusMessage && (
                <div className={`p-4 rounded-xl text-sm flex items-center justify-between gap-3 ${
                    statusMessage.type === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                        : 'bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                }`}>
                    <div className="flex items-center gap-2">
                        {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                        <span>{statusMessage.text}</span>
                    </div>
                    <button
                        onClick={() => setStatusMessage(null)}
                        className="text-xs opacity-70 hover:opacity-100 font-bold"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Card 1: Reporting Manager */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                    <UserCheck className="w-4 h-4 text-indigo-500" />
                    <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                        1. Designated Reporting Manager (Tester)
                    </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">
                            Manager Full Name
                        </label>
                        <input
                            type="text"
                            value={managerName}
                            onChange={(e) => setManagerName(e.target.value)}
                            placeholder="e.g. Sahil"
                            className="w-full px-3.5 py-2 rounded-xl text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">
                            Manager WhatsApp Phone Number
                        </label>
                        <input
                            type="text"
                            value={managerPhone}
                            onChange={(e) => setManagerPhone(e.target.value)}
                            placeholder="e.g. 9930123456"
                            className="w-full px-3.5 py-2 rounded-xl text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                <div className="pt-2">
                    <label className="flex items-center gap-2.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={notifyManager}
                            onChange={(e) => setNotifyManager(e.target.checked)}
                            className="rounded border-zinc-300 dark:border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>Send morning task digest notification to Reporting Manager as well</span>
                    </label>
                </div>
            </div>

            {/* Card 2: Test Employee Recipients */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-emerald-500" />
                        <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                            2. Test Employee Recipients ({employees.length})
                        </h3>
                    </div>
                    <span className="text-xs text-zinc-400">Who receives the test WhatsApp messages</span>
                </div>

                {/* Add new recipient input row */}
                <form onSubmit={handleAddEmployee} className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
                    <input
                        type="text"
                        value={newEmpName}
                        onChange={(e) => setNewEmpName(e.target.value)}
                        placeholder="Employee Name"
                        className="w-full sm:flex-1 px-3.5 py-2 rounded-xl text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                        type="text"
                        value={newEmpPhone}
                        onChange={(e) => setNewEmpPhone(e.target.value)}
                        placeholder="WhatsApp Phone Number"
                        className="w-full sm:flex-1 px-3.5 py-2 rounded-xl text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                        type="submit"
                        className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition flex items-center justify-center gap-1.5 shrink-0"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Add Person</span>
                    </button>
                </form>

                {/* Recipients Table / List */}
                {employees.length === 0 ? (
                    <div className="p-6 text-center text-xs text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
                        No test recipients added yet. Add a name and WhatsApp phone number above.
                    </div>
                ) : (
                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                        {employees.map((emp, index) => (
                            <div key={index} className="p-3 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition">
                                <div className="flex items-center gap-3">
                                    <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center justify-center">
                                        {index + 1}
                                    </div>
                                    <div>
                                        <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{emp.name}</div>
                                        <div className="text-xs text-zinc-400 flex items-center gap-1">
                                            <Phone className="w-3 h-3" />
                                            <span>{emp.phone}</span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleRemoveEmployee(index)}
                                    className="p-1.5 text-zinc-400 hover:text-rose-500 transition rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                    title="Remove from test list"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Bottom Actions Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <div className="text-xs text-zinc-500">
                    💡 Tip: Click <strong>"Save Configuration"</strong> before triggering messages.
                </div>

                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 sm:flex-initial px-5 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold text-sm rounded-xl hover:opacity-90 transition flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span>Save Configuration</span>
                    </button>

                    <button
                        type="button"
                        onClick={handleSendTestDigest}
                        disabled={sendingDigest || (employees.length === 0 && !managerPhone)}
                        className="flex-1 sm:flex-initial px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm"
                    >
                        {sendingDigest ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        <span>Send Test Message Now</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
