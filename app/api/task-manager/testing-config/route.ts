import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const config = await TaskDatabaseService.getTestingConfig();
        return NextResponse.json({ success: true, config });
    } catch (err: any) {
        console.error('[TestingConfigAPI] GET error:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Failed to fetch config' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));

        // ── Phase 3: Immediate Manual Triggers ──────────────────────────────
        const TECH_DEPARTMENT_ID = '94a74961-2dd8-453d-9728-f6f2b9ade99b';

        if (body.action === 'trigger_generate') {
            const { TaskDailyGeneratorService } = await import('@/task-manager/TaskDailyGeneratorService');
            const genResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
                departmentId: body.departmentId || TECH_DEPARTMENT_ID
            });
            return NextResponse.json({
                success: true,
                message: `Fixed tasks generated: ${genResult.tasksGenerated} created, ${genResult.tasksAlreadyExisting} already existed for today.`,
                result: genResult
            });
        }

        if (body.action === 'trigger_dispatch') {
            const { TaskDailyGeneratorService } = await import('@/task-manager/TaskDailyGeneratorService');
            const { TaskNotificationService } = await import('@/task-manager/TaskNotificationService');
            const dryRun = body.dryRun !== false; // default true for safety in test trigger
            const deptId = body.departmentId || TECH_DEPARTMENT_ID;

            // 1. Ensure tasks exist first
            const genResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
                departmentId: deptId
            });

            // 2. Dispatch notifications
            const notifResult = await TaskNotificationService.sendMorningNotifications({
                departmentId: deptId,
                dryRun
            });

            const summary = `${dryRun ? '[Dry-Run] ' : ''}Generated ${genResult.tasksGenerated} tasks (${genResult.tasksAlreadyExisting} existing). Notified ${notifResult.notificationsSent} employees (${notifResult.skippedNoTasks} skipped).`;

            if (!dryRun) {
                const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
                const todayIST = `${nowIST.getFullYear()}-${String(nowIST.getMonth() + 1).padStart(2, '0')}-${String(nowIST.getDate()).padStart(2, '0')}`;
                await TaskDatabaseService.saveTestingConfig({
                    cronLastRunDate: todayIST,
                    cronLastRunSummary: summary
                });
            }

            return NextResponse.json({
                success: true,
                message: summary,
                dryRun,
                result: {
                    generator: genResult,
                    notifications: notifResult
                }
            });
        }

        // ── Phase 1 & 2: Update Configuration ───────────────────────────────
        const updatePayload: Record<string, any> = {};

        if (body.enabled !== undefined) updatePayload.enabled = Boolean(body.enabled);
        if (body.notifyManager !== undefined) updatePayload.notifyManager = Boolean(body.notifyManager);

        // If manager phone provided, ensure role is reporting_manager in employee_profiles
        if (body.manager !== undefined) {
            updatePayload.manager = {
                name: (body.manager?.name || '').trim(),
                phone: (body.manager?.phone || '').trim()
            };

            if (updatePayload.manager.phone) {
                const last10 = updatePayload.manager.phone.replace(/\D/g, '').slice(-10);
                if (last10.length === 10) {
                    await supabaseAdmin
                        .from('employee_profiles')
                        .update({ task_role: 'reporting_manager' })
                        .or(`phone.eq.${last10},phone.ilike.%${last10}`);
                }
            }
        }

        if (body.employees !== undefined && Array.isArray(body.employees)) {
            updatePayload.employees = body.employees.map((e: any) => ({
                name: (e.name || '').trim(),
                phone: (e.phone || '').trim()
            })).filter((e: any) => e.name || e.phone);
        }

        if (body.cronTiming !== undefined) {
            updatePayload.cronTiming = String(body.cronTiming).trim();
        }
        if (body.cronEnabled !== undefined) {
            updatePayload.cronEnabled = Boolean(body.cronEnabled);
        }
        if (body.cronLastRunDate !== undefined) {
            updatePayload.cronLastRunDate = body.cronLastRunDate ? String(body.cronLastRunDate) : null;
        }
        if (body.cronLastRunSummary !== undefined) {
            updatePayload.cronLastRunSummary = body.cronLastRunSummary ? String(body.cronLastRunSummary) : null;
        }

        const savedConfig = await TaskDatabaseService.saveTestingConfig(updatePayload);

        return NextResponse.json({
            success: true,
            message: 'Testing configuration updated successfully',
            config: savedConfig
        });
    } catch (err: any) {
        console.error('[TestingConfigAPI] POST error:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Failed to save config' }, { status: 500 });
    }
}
