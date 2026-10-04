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
        const {
            enabled = false,
            manager = { name: '', phone: '' },
            notifyManager = false,
            employees = []
        } = body;

        // If manager phone provided, ensure role is reporting_manager in employee_profiles
        if (manager?.phone) {
            const last10 = manager.phone.replace(/\D/g, '').slice(-10);
            if (last10.length === 10) {
                await supabaseAdmin
                    .from('employee_profiles')
                    .update({ task_role: 'reporting_manager' })
                    .or(`phone.eq.${last10},phone.ilike.%${last10}`);
            }
        }

        const configToSave = {
            enabled: Boolean(enabled),
            manager: {
                name: (manager?.name || '').trim(),
                phone: (manager?.phone || '').trim()
            },
            notifyManager: Boolean(notifyManager),
            employees: Array.isArray(employees)
                ? employees.map((e: any) => ({
                    name: (e.name || '').trim(),
                    phone: (e.phone || '').trim()
                })).filter((e: any) => e.name || e.phone)
                : []
        };

        await TaskDatabaseService.saveTestingConfig(configToSave);

        return NextResponse.json({
            success: true,
            message: 'Testing configuration updated successfully',
            config: configToSave
        });
    } catch (err: any) {
        console.error('[TestingConfigAPI] POST error:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Failed to save config' }, { status: 500 });
    }
}
