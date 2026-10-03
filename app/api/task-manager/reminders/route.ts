import { NextRequest, NextResponse } from 'next/server';
import { TaskReminderService } from '@/task-manager/TaskReminderService';

export const dynamic = 'force-dynamic';

/**
 * POST /api/task-manager/reminders
 * Trigger reminders manually from the Super Admin Console.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { action = 'eod_nudge', dryRun = false } = body;

        if (action === 'nudge_member') {
            const { phone, name } = body;
            if (!phone) {
                return NextResponse.json({ ok: false, error: 'Phone number is required' }, { status: 400 });
            }
            const result = await TaskReminderService.sendSingleMemberNudge({ phone, name, dryRun });
            return NextResponse.json({
                ok: result.success,
                message: result.message || (result.success ? `Sent WhatsApp nudge to ${name}` : result.error),
                result,
            }, { status: result.success ? 200 : 400 });
        }

        if (action === 'eod_nudge') {
            const result = await TaskReminderService.sendDailyReportNudges({ dryRun });
            return NextResponse.json({
                ok: true,
                message: `Sent EOD report reminders to ${result.nudgedMembers.length} team members.`,
                result,
            });
        }

        if (action === 'morning_digest') {
            const result = await TaskReminderService.sendMorningTaskDigest({ dryRun });
            return NextResponse.json({
                ok: true,
                message: `Sent morning priority digest to ${result.sentCount} team members.`,
                result,
            });
        }

        if (action === 'superuser_rollup') {
            const result = await TaskReminderService.sendSuperuserEveningRollup({ dryRun });
            return NextResponse.json({
                ok: true,
                message: `Dispatched daily rollup to ${result.superusersNotified.length} leadership members.`,
                result,
            });
        }

        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    } catch (err: any) {
        console.error('[TaskManagerRemindersAPI] Error:', err);
        return NextResponse.json({ ok: false, error: err?.message || 'Internal server error' }, { status: 500 });
    }
}
