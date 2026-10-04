import { NextRequest, NextResponse } from 'next/server';
import { TaskDailyGeneratorService } from '@/task-manager/TaskDailyGeneratorService';
import { TaskNotificationService } from '@/task-manager/TaskNotificationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/cron/task-manager?action=[daily_tasks|morning_digest|auto]
 * Secure automated cron job for Task Manager notifications.
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

    try {
        if (action === 'daily_tasks') {
            const result = await TaskDailyGeneratorService.generateDailyFixedTasks();
            return NextResponse.json({ ok: true, action: 'daily_tasks', result });
        }

        if (action === 'morning_digest') {
            // First generate tasks, then send morning notifications
            await TaskDailyGeneratorService.generateDailyFixedTasks();
            const result = await TaskNotificationService.sendMorningNotifications({ dryRun });
            return NextResponse.json({ ok: true, action: 'morning_digest', result });
        }

        // Auto mode based on current IST hour
        const istHour = parseInt(
            new Date().toLocaleTimeString('en-US', {
                timeZone: 'Asia/Kolkata',
                hour: 'numeric',
                hour12: false,
            }),
            10
        );

        if (istHour >= 8 && istHour < 12) {
            // Morning 8:00 - 12:00 IST -> Fixed task generation + Morning task digest
            await TaskDailyGeneratorService.generateDailyFixedTasks();
            const result = await TaskNotificationService.sendMorningNotifications({ dryRun });
            return NextResponse.json({ ok: true, action: 'morning_digest', istHour, result });
        }

        return NextResponse.json({
            ok: true,
            action: 'idle',
            istHour,
            message: `Current IST hour (${istHour}:00) is outside scheduled cron dispatch window (08:00-12:00 IST). Use ?action=morning_digest or ?action=daily_tasks to trigger explicitly.`,
        });
    } catch (err: any) {
        console.error('[TaskReminderCron] Error executing action:', err);
        return NextResponse.json({ ok: false, error: err?.message || 'Internal error' }, { status: 500 });
    }
}
