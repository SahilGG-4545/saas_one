import { NextRequest, NextResponse } from 'next/server';
import { TaskDailyGeneratorService } from '@/task-manager/TaskDailyGeneratorService';
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

        const isCronAuthorized = cronSecret && authHeader === `Bearer ${cronSecret}`;
        const actorId = searchParams.get('actorId') || request.headers.get('x-actor-id');
        const confirmParam = searchParams.get('confirm') === 'yes';

        let isAuthorized = isCronAuthorized;

        // In dev or with actorId check
        if (!isAuthorized && actorId) {
            try {
                const actor = await PermissionService.getActor(actorId);
                if (actor.role === 'superuser' || actor.role === 'reporting_manager') {
                    isAuthorized = true;
                }
            } catch (authErr) {
                console.warn('[CronDailyTasks] Actor auth check failed:', authErr);
            }
        }

        // Allow localhost development test with ?confirm=yes if no secret is configured
        if (!isAuthorized && confirmParam && process.env.NODE_ENV !== 'production') {
            isAuthorized = true;
        }

        if (!isAuthorized) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized. Provide valid Bearer token or authorized actorId.' },
                { status: 401 }
            );
        }

        const date = searchParams.get('date') || undefined;
        const departmentId = searchParams.get('departmentId') || undefined;
        const employeeId = searchParams.get('employeeId') || undefined;

        const result = await TaskDailyGeneratorService.generateDailyFixedTasks({
            date,
            departmentId,
            employeeId
        });

        return NextResponse.json({
            success: result.success,
            data: result
        });
    } catch (err: any) {
        console.error('[CronDailyTasks] Unhandled exception:', err);
        return NextResponse.json(
            { success: false, error: err.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
