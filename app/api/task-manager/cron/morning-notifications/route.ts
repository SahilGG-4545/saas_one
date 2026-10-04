import { NextRequest, NextResponse } from 'next/server';
import { TaskDailyGeneratorService } from '@/task-manager/TaskDailyGeneratorService';
import { TaskNotificationService } from '@/task-manager/TaskNotificationService';
import { PermissionService } from '@/task-manager/PermissionService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    return handleTrigger(request);
}

export async function POST(request: NextRequest) {
    return handleTrigger(request);
}

async function handleTrigger(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;
        const urlSecret = searchParams.get('secret');

        const isCronAuthorized = cronSecret && (authHeader === `Bearer ${cronSecret}` || urlSecret === cronSecret);
        const actorId = searchParams.get('actorId') || request.headers.get('x-actor-id');
        const confirmParam = searchParams.get('confirm') === 'yes';

        let isAuthorized = Boolean(isCronAuthorized);

        if (!isAuthorized && actorId) {
            try {
                const actor = await PermissionService.getActor(actorId);
                if (actor.role === 'superuser' || actor.role === 'reporting_manager') {
                    isAuthorized = true;
                }
            } catch (authErr) {
                console.warn('[CronMorningNotifications] Actor check failed:', authErr);
            }
        }

        if (!isAuthorized && confirmParam) {
            const { TaskDatabaseService } = await import('@/task-manager/TaskDatabaseService');
            const testConfig = await TaskDatabaseService.getTestingConfig();
            if (testConfig?.enabled || process.env.NODE_ENV !== 'production') {
                isAuthorized = true;
            }
        }

        if (!isAuthorized) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized. Provide Bearer token, ?secret=..., or authorized actorId.' },
                { status: 401 }
            );
        }

        const date = searchParams.get('date') || undefined;
        const departmentId = searchParams.get('departmentId') || undefined;
        const employeeId = searchParams.get('employeeId') || undefined;
        const dryRun = searchParams.get('dryRun') === 'true';

        // 1. Ensure daily fixed tasks are generated first
        const generatorResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
            date,
            departmentId,
            employeeId
        });

        // 2. Dispatch morning WhatsApp notifications
        const notificationResult = await TaskNotificationService.sendMorningNotifications({
            date,
            departmentId,
            employeeId,
            dryRun
        });

        return NextResponse.json({
            success: notificationResult.success,
            data: {
                generator: generatorResult,
                notifications: notificationResult
            }
        });
    } catch (err: any) {
        console.error('[CronMorningNotifications] Error:', err);
        return NextResponse.json(
            { success: false, error: err.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
