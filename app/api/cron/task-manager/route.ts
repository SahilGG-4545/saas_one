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

        // ── Auto Mode (Heartbeat Evaluator) ──────────────────────────────────
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
        const currentMinutes = nowIST.getHours() * 60 + nowIST.getMinutes();
        const currentISTTime = `${String(nowIST.getHours()).padStart(2, '0')}:${String(nowIST.getMinutes()).padStart(2, '0')}`;

        // 3. Deduplication check (ensure it runs at most once per calendar day)
        if (!force && config.cronLastRunDate === todayIST) {
            return NextResponse.json({
                ok: true,
                action: 'already_executed_today',
                todayIST,
                lastRunDate: config.cronLastRunDate,
                message: `Daily tasks have already been generated and dispatched for today (${todayIST}).`
            });
        }

        // 4. Check if scheduled time has arrived
        const [targetHour, targetMin] = (config.cronTiming || '09:00').split(':').map(Number);
        const targetMinutes = (targetHour || 9) * 60 + (targetMin || 0);

        if (!force && currentMinutes < targetMinutes) {
            return NextResponse.json({
                ok: true,
                action: 'waiting',
                currentIST: currentISTTime,
                scheduledIST: config.cronTiming || '09:00',
                message: `Scheduled time (${config.cronTiming || '09:00'} IST) has not arrived yet. Current IST: ${currentISTTime}`
            });
        }

        // 5. Evening cutoff safety (avoid sending morning tasks at night)
        if (!force && currentMinutes > 20 * 60) {
            return NextResponse.json({
                ok: true,
                action: 'outside_operational_window',
                currentIST: currentISTTime,
                message: `Current time (${currentISTTime} IST) is past evening operational cutoff (20:00 IST).`
            });
        }

        // 6. Execute task generation & notification dispatch (locked to Tech department)
        const genResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
            date: todayIST,
            departmentId: deptId
        });

        const notifResult = await TaskNotificationService.sendMorningNotifications({
            date: todayIST,
            departmentId: deptId,
            dryRun
        });

        const summary = `Generated ${genResult.tasksGenerated} tasks (${genResult.tasksAlreadyExisting} existing). Sent ${notifResult.notificationsSent} digests (${notifResult.skippedNoTasks} skipped).`;

        // 7. Stamp run date & summary in DB
        await TaskDatabaseService.saveTestingConfig({
            cronLastRunDate: todayIST,
            cronLastRunSummary: summary
        });

        return NextResponse.json({
            ok: true,
            action: 'dispatched',
            todayIST,
            currentIST: currentISTTime,
            summary,
            genResult,
            notifResult
        });
    } catch (err: any) {
        console.error('[TaskReminderCron] Error executing action:', err);
        return NextResponse.json({ ok: false, error: err?.message || 'Internal error' }, { status: 500 });
    }
}
