import { NextRequest, NextResponse } from 'next/server';
import { TaskReminderService } from '@/task-manager/TaskReminderService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/cron/task-manager?action=[eod_nudge|morning_digest|superuser_rollup|auto]
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
        if (action === 'eod_nudge') {
            const result = await TaskReminderService.sendDailyReportNudges({ dryRun });
            return NextResponse.json({ ok: true, action: 'eod_nudge', result });
        }

        if (action === 'morning_digest') {
            const result = await TaskReminderService.sendMorningTaskDigest({ dryRun });
            return NextResponse.json({ ok: true, action: 'morning_digest', result });
        }

        if (action === 'superuser_rollup') {
            const result = await TaskReminderService.sendSuperuserEveningRollup({ dryRun });
            return NextResponse.json({ ok: true, action: 'superuser_rollup', result });
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

        if (istHour >= 9 && istHour < 12) {
            // Morning 9:00 - 12:00 IST -> Morning pending tasks digest
            const result = await TaskReminderService.sendMorningTaskDigest({ dryRun });
            return NextResponse.json({ ok: true, action: 'morning_digest', istHour, result });
        } else if (istHour >= 18 && istHour < 20) {
            // Evening 18:00 - 20:00 IST -> EOD Daily report nudges for missing employees
            const result = await TaskReminderService.sendDailyReportNudges({ dryRun });
            return NextResponse.json({ ok: true, action: 'eod_nudge', istHour, result });
        } else if (istHour >= 20 || istHour < 23) {
            // Night 20:00 - 23:00 IST -> Superuser leadership rollup
            const result = await TaskReminderService.sendSuperuserEveningRollup({ dryRun });
            return NextResponse.json({ ok: true, action: 'superuser_rollup', istHour, result });
        }

        return NextResponse.json({
            ok: true,
            action: 'idle',
            istHour,
            message: `Current IST hour (${istHour}:00) is outside scheduled cron dispatch windows (09-12, 18-20, 20-23). Use ?action=... to trigger explicitly.`,
        });
    } catch (err: any) {
        console.error('[TaskReminderCron] Error executing action:', err);
        return NextResponse.json({ ok: false, error: err?.message || 'Internal error' }, { status: 500 });
    }
}
