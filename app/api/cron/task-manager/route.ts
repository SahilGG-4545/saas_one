import { NextRequest, NextResponse } from 'next/server';
import { TaskDailyGeneratorService } from '@/task-manager/TaskDailyGeneratorService';
import { TaskNotificationService } from '@/task-manager/TaskNotificationService';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TECH_DEPARTMENT_ID = '94a74961-2dd8-453d-9728-f6f2b9ade99b';

/**
 * GET/POST /api/cron/task-manager?action=[daily_tasks|morning_digest|auto]
 * Secure automated cron job for Task Manager notifications.
 * In 'auto' mode, acts as a heartbeat that checks DB-configured timing & daily deduplication.
 */
export async function GET(request: NextRequest) {
    return handleRequest(request);
}

export async function POST(request: NextRequest) {
    return handleRequest(request);
}

async function handleRequest(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    const urlSecret = request.nextUrl.searchParams.get('secret');
    const cronSecret = process.env.CRON_SECRET;

    // Secure authorization gate
    const isAuthorized =
        (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
        (cronSecret && urlSecret === cronSecret) ||
        process.env.NODE_ENV === 'development';

    if (!isAuthorized) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const action = request.nextUrl.searchParams.get('action') || 'auto';
    const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true';
    const deptId = request.nextUrl.searchParams.get('departmentId') || TECH_DEPARTMENT_ID;
    const targetDate = request.nextUrl.searchParams.get('date') || undefined;
    const force = request.nextUrl.searchParams.get('force') === 'true';

    try {
        if (action === 'daily_tasks') {
            const result = await TaskDailyGeneratorService.generateDailyFixedTasks({
                date: targetDate,
                departmentId: deptId
            });
            return NextResponse.json({ ok: true, action: 'daily_tasks', result });
        }

        if (action === 'morning_digest') {
            // First generate tasks, then send morning notifications
            const genResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
                date: targetDate,
                departmentId: deptId
            });
            const notifResult = await TaskNotificationService.sendMorningNotifications({
                date: targetDate,
                departmentId: deptId,
                dryRun
            });
            return NextResponse.json({
                ok: true,
                action: 'morning_digest',
                genResult,
                notifResult
            });
        }

        // ── Auto Mode (Multi-Rule Heartbeat Evaluator) ───────────────────────
        const config = await TaskDatabaseService.getTestingConfig();

        // 1. Check master toggle
        if (config.cronEnabled === false) {
            return NextResponse.json({
                ok: true,
                action: 'paused',
                message: 'Task Manager automated daily cron is currently paused in settings.'
            });
        }

        // 2. Compute current IST date and time
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const todayIST = targetDate || `${nowIST.getFullYear()}-${String(nowIST.getMonth() + 1).padStart(2, '0')}-${String(nowIST.getDate()).padStart(2, '0')}`;
        const currentDayOfWeek = nowIST.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
        const currentMinutes = nowIST.getHours() * 60 + nowIST.getMinutes();
        const currentISTTime = `${String(nowIST.getHours()).padStart(2, '0')}:${String(nowIST.getMinutes()).padStart(2, '0')}`;

        const targetRuleId = request.nextUrl.searchParams.get('ruleId') || undefined;

        // Rules to evaluate: either a specific requested rule or all active rules
        const rules = config.rules || TaskDatabaseService.getDefaultNotificationRules(config.cronTiming);
        const candidates = targetRuleId ? rules.filter(r => r.id === targetRuleId) : rules;

        if (candidates.length === 0) {
            return NextResponse.json({
                ok: false,
                error: targetRuleId ? `Rule '${targetRuleId}' not found.` : 'No notification rules configured.'
            }, { status: 404 });
        }

        const ruleResults: Array<{
            ruleId: string;
            ruleName: string;
            status: 'dispatched' | 'waiting' | 'already_executed_today' | 'disabled' | 'not_scheduled_today' | 'outside_operational_window';
            message?: string;
            summary?: string;
        }> = [];

        let executedCount = 0;

        for (const rule of candidates) {
            // Check individual rule toggle
            if (rule.enabled === false) {
                ruleResults.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    status: 'disabled',
                    message: `Rule '${rule.name}' is currently paused.`
                });
                continue;
            }

            // Check active day of week (e.g. skip Sunday unless forced)
            if (!force && rule.daysOfWeek && !rule.daysOfWeek.includes(currentDayOfWeek)) {
                ruleResults.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    status: 'not_scheduled_today',
                    message: `Rule '${rule.name}' is not scheduled for today (Day ${currentDayOfWeek}).`
                });
                continue;
            }

            // Deduplication check per rule
            if (!force && rule.lastRunDate === todayIST) {
                ruleResults.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    status: 'already_executed_today',
                    message: `Rule '${rule.name}' already dispatched for today (${todayIST}).`
                });
                continue;
            }

            // Check if scheduled time has arrived
            const [targetHour, targetMin] = (rule.targetTimeIST || '09:00').split(':').map(Number);
            const targetMinutes = (targetHour || 9) * 60 + (targetMin || 0);

            if (!force && currentMinutes < targetMinutes) {
                ruleResults.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    status: 'waiting',
                    message: `Scheduled time (${rule.targetTimeIST} IST) has not arrived yet. Current IST: ${currentISTTime}`
                });
                continue;
            }

            // Evening cutoff safety (after 20:30 IST)
            if (!force && currentMinutes > 20 * 60 + 30) {
                ruleResults.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    status: 'outside_operational_window',
                    message: `Current time (${currentISTTime} IST) is past evening operational cutoff (20:30 IST).`
                });
                continue;
            }

            // Execute tasks & notification for this rule
            const genResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
                date: todayIST,
                departmentId: deptId
            });

            const notifResult = await TaskNotificationService.sendMorningNotifications({
                date: todayIST,
                departmentId: deptId,
                dryRun,
                rule
            });


            const summary = `Generated ${genResult.tasksGenerated} tasks (${genResult.tasksAlreadyExisting} existing). Sent ${notifResult.notificationsSent} digests (${notifResult.skippedNoTasks} skipped).`;

            // Stamp rule execution in DB
            await TaskDatabaseService.updateNotificationRule(rule.id, {
                lastRunDate: todayIST,
                lastRunSummary: summary
            });

            // If it's the primary morning digest, maintain legacy fields too
            if (rule.id === 'rule_morning_digest' || rule.ruleType === 'morning_digest') {
                await TaskDatabaseService.saveTestingConfig({
                    cronLastRunDate: todayIST,
                    cronLastRunSummary: summary
                });
            }

            ruleResults.push({
                ruleId: rule.id,
                ruleName: rule.name,
                status: 'dispatched',
                summary
            });
            executedCount++;
        }

        let overallAction: string = 'evaluated';
        let overallMessage: string | undefined = undefined;

        if (executedCount > 0) {
            overallAction = 'dispatched';
            overallMessage = ruleResults.find(r => r.status === 'dispatched')?.summary;
        } else if (ruleResults.some(r => r.status === 'waiting')) {
            overallAction = 'waiting';
            overallMessage = ruleResults.find(r => r.status === 'waiting')?.message;
        } else if (ruleResults.length > 0 && ruleResults.every(r => r.status === 'already_executed_today')) {
            overallAction = 'already_executed_today';
            overallMessage = 'All scheduled notification rules have already been executed for today.';
        } else if (ruleResults.length > 0 && ruleResults.every(r => r.status === 'disabled')) {
            overallAction = 'paused';
            overallMessage = 'All notification rules are currently paused.';
        }

        return NextResponse.json({
            ok: true,
            action: overallAction,
            message: overallMessage,
            todayIST,
            currentIST: currentISTTime,
            rulesEvaluated: ruleResults.length,
            rulesDispatched: executedCount,
            results: ruleResults
        });


    } catch (err: any) {
        console.error('[TaskReminderCron] Error executing action:', err);
        return NextResponse.json({ ok: false, error: err?.message || 'Internal error' }, { status: 500 });
    }
}
