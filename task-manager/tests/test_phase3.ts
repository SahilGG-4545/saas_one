import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function runTests() {
    const { TaskManagerService } = await import('../TaskManagerService');
    const { handleTaskManagerMessage } = await import('../router');
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');

    console.log('🧪 Starting Phase 3 Task Manager Integration Tests...\n');

    const testPhone = '8433649199';
    const otherPhone = '9999999999';

    // 1. Resolve test user
    const { data: user } = await supabaseAdmin
        .from('users')
        .select('id, full_name, phone')
        .or(`phone.eq.${testPhone},phone.ilike.%${testPhone}`)
        .single();

    if (!user) {
        console.error('❌ Test user with phone', testPhone, 'not found in DB!');
        process.exit(1);
    }
    console.log(`👤 Using test user: ${user.full_name} (${user.id})`);

    // Clean up any old test tasks for a clean test run
    await supabaseAdmin.from('tm_tasks').delete().eq('employee_id', user.id);
    await supabaseAdmin.from('tm_daily_reports').delete().eq('user_id', user.id);

    // ── Test 1: Router ignores unauthorized phone ──────────────────────────────
    console.log('\n--- Test 1: Safety check on unauthorized phone ---');
    const handledOther = await handleTaskManagerMessage({
        senderPhone: otherPhone,
        messageText: 'create task: Should not be handled',
        user: { id: 'other-user', full_name: 'Other' },
    });
    console.log('Result for other phone (expected false):', handledOther);
    if (handledOther !== false) throw new Error('Safety guard failed: other phone was handled!');
    console.log('✅ Passed Test 1: Other phone correctly bypassed Task Manager.');

    // ── Test 2: Router ignores normal maintenance ticket message ───────────────
    console.log('\n--- Test 2: Non-task messages fall through ---');
    const handledTicket = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'The cafeteria AC is leaking water on the floor',
        user,
    });
    console.log('Result for maintenance ticket (expected false):', handledTicket);
    if (handledTicket !== false) throw new Error('Maintenance ticket was wrongly intercepted by Task Manager!');
    console.log('✅ Passed Test 2: Maintenance message correctly passed to ticket flow.');

    // ── Test 3: Create Task via Router ─────────────────────────────────────────
    console.log('\n--- Test 3: Create task via router ---');
    const handledCreate1 = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'create task: Verify fire extinguishers on 4th floor',
        user,
    });
    const handledCreate2 = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'add task: Prepare quarterly vendor audit report',
        user,
    });
    console.log('Task create 1 handled:', handledCreate1);
    console.log('Task create 2 handled:', handledCreate2);
    if (!handledCreate1 || !handledCreate2) throw new Error('Failed to create tasks via router');

    const tasksInDb = await TaskManagerService.listTasks({ userId: user.id, statusFilter: 'all' });
    console.log(`Created ${tasksInDb.length} tasks in DB:`, tasksInDb.map(t => `#${t.title} (${t.status})`));
    if (tasksInDb.length !== 2) throw new Error('Expected 2 tasks in database');
    console.log('✅ Passed Test 3: Tasks created successfully in DB.');

    // ── Test 4: List Tasks via Router ──────────────────────────────────────────
    console.log('\n--- Test 4: List tasks via router ---');
    const handledList = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'my tasks',
        user,
    });
    console.log('List tasks handled:', handledList);
    if (!handledList) throw new Error('Failed to list tasks via router');
    console.log('✅ Passed Test 4: Task listing handled successfully.');

    // ── Test 5: Update Task Progress via Router ────────────────────────────────
    console.log('\n--- Test 5: Update task progress via router ---');
    // Task #1 in active list is the most recent (quarterly vendor audit report)
    const handledUpdate = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'update #1 65%: Finished reviewing invoice data',
        user,
    });
    console.log('Update progress handled:', handledUpdate);
    if (!handledUpdate) throw new Error('Failed to update task progress');

    const updatedTask = await TaskManagerService.resolveTask(user.id, '1');
    console.log('Updated task progress in DB:', updatedTask?.progress_percentage, '% (status:', updatedTask?.status, ')');
    if (updatedTask?.progress_percentage !== 65 || updatedTask?.status !== 'in_progress') {
        throw new Error('Task progress did not update properly in DB');
    }
    console.log('✅ Passed Test 5: Task progress updated to 65% in DB.');

    // ── Test 6: Complete Task via Router ───────────────────────────────────────
    console.log('\n--- Test 6: Complete task via router ---');
    const handledDone = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'done #1',
        user,
    });
    console.log('Complete task handled:', handledDone);
    if (!handledDone) throw new Error('Failed to complete task');

    const completedTask = await TaskManagerService.resolveTask(user.id, updatedTask!.id);
    console.log('Completed task in DB:', completedTask?.title, 'progress:', completedTask?.progress_percentage, 'status:', completedTask?.status);
    if (completedTask?.status !== 'completed' || completedTask?.progress_percentage !== 100) {
        throw new Error('Task completion status mismatch in DB');
    }
    console.log('✅ Passed Test 6: Task completed successfully.');

    // ── Test 7: Submit Daily Work Report ───────────────────────────────────────
    console.log('\n--- Test 7: Submit daily work report via router ---');
    const handledDaily = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'daily report: Completed quarterly vendor audit and inspected 4th floor extinguishers.',
        user,
    });
    console.log('Daily report handled:', handledDaily);
    if (!handledDaily) throw new Error('Failed to submit daily report');

    const today = new Date().toISOString().slice(0, 10);
    const { data: reportInDb } = await supabaseAdmin
        .from('tm_daily_reports')
        .select('*')
        .eq('user_id', user.id)
        .eq('report_date', today)
        .maybeSingle();

    console.log('Daily report in DB:', reportInDb?.summary);
    if (!reportInDb || !reportInDb.summary.includes('quarterly vendor audit')) {
        throw new Error('Daily report not found in DB');
    }
    console.log('✅ Passed Test 7: Daily report stored cleanly.');

    console.log('\n🎉 ALL 7 PHASE 3 INTEGRATION TESTS PASSED CLEANLY! 🎉\n');
}

runTests().catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
