import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function runTests() {
    const { TaskManagerService } = await import('../TaskManagerService');
    const { handleTaskManagerMessage } = await import('../router');
    const { detectTaskIntent } = await import('../intentDetector');
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');

    console.log('🧪 Starting Phase 5 Corporate Task Manager & Superuser Oversight Tests...\n');

    const superuserPhone = '8433649199'; // Sahil Gorde
    const regularPhone = '9876543210';
    const nonEnrolledPhone = '9999999999';

    // 1. Resolve test user
    const { data: user } = await supabaseAdmin
        .from('users')
        .select('id, full_name, phone')
        .or(`phone.eq.${superuserPhone},phone.ilike.%${superuserPhone}`)
        .single();

    if (!user) {
        console.error('❌ Test user with phone', superuserPhone, 'not found in DB!');
        process.exit(1);
    }
    console.log(`👤 Using primary superuser: ${user.full_name} (${user.id})`);

    // Clean up test tasks & reports for a clean test run
    await supabaseAdmin.from('tm_tasks').delete().eq('employee_id', user.id);
    await supabaseAdmin.from('tm_daily_reports').delete().eq('user_id', user.id);

    // ── Test 1: Corporate Intent Classification ────────────────────────────────
    console.log('\n--- Test 1: Corporate Knowledge Work Intent Detection ---');

    const t1 = await detectTaskIntent('create task: Review NDA for client partnership');
    console.log('T1: create_task ->', t1.action, '| title:', t1.task_title);
    if (t1.action !== 'create_task') throw new Error(`Expected create_task, got ${t1.action}`);

    const t2 = await detectTaskIntent('The pitch deck is 70% complete');
    console.log('T2: update_progress ->', t2.action, '| pct:', t2.progress_percentage);
    if (t2.action !== 'update_progress') throw new Error(`Expected update_progress, got ${t2.action}`);

    const t3 = await detectTaskIntent('What did Tech work on today?', { isSuperuser: true });
    console.log('T3: query_department_progress ->', t3.action, '| dept:', t3.target_department);
    if (t3.action !== 'query_department_progress') throw new Error(`Expected query_department_progress, got ${t3.action}`);

    const t4 = await detectTaskIntent('Show pending tasks for Sahil', { isSuperuser: true });
    console.log('T4: query_employee_progress ->', t4.action, '| emp:', t4.target_employee);
    if (t4.action !== 'query_employee_progress') throw new Error(`Expected query_employee_progress, got ${t4.action}`);

    const t5 = await detectTaskIntent('Who has not submitted their daily report today?', { isSuperuser: true });
    console.log('T5: query_missing_reports ->', t5.action);
    if (t5.action !== 'query_missing_reports') throw new Error(`Expected query_missing_reports, got ${t5.action}`);

    console.log('✅ Passed Test 1: All corporate & leadership intents classified cleanly.');

    // ── Test 2: Seed Tasks & Daily Reports ─────────────────────────────────────
    console.log('\n--- Test 2: Seed Tasks for Tech Department ---');
    const task1 = await TaskManagerService.createTask({
        userId: user.id,
        title: 'Review NDA for client partnership',
        department: 'Tech',
        priority: 'high'
    });
    const task2 = await TaskManagerService.createTask({
        userId: user.id,
        title: 'Prepare pitch deck for investor meeting',
        department: 'Tech',
        priority: 'urgent'
    });
    console.log(`Created Task 1: ${task1.title}`);
    console.log(`Created Task 2: ${task2.title}`);

    // Update progress on Task 2
    await TaskManagerService.updateTaskProgress({
        taskId: task2.id,
        userId: user.id,
        progress: 70,
        remark: 'Finished first 10 slides'
    });

    // Submit daily report
    await TaskManagerService.submitDailyReport({
        userId: user.id,
        summary: 'Completed 3 candidate interviews for backend role and closed investor deck draft.'
    });
    console.log('✅ Passed Test 2: Seeded tasks and daily report.');

    // ── Test 3: Superuser Query via Router - Department Progress ───────────────
    console.log('\n--- Test 3: Superuser Query via Router - Department Progress ---');
    const deptQueryHandled = await handleTaskManagerMessage({
        senderPhone: superuserPhone,
        messageText: 'What did Tech work on today?',
        user
    });
    console.log('Dept query handled by router:', deptQueryHandled);
    if (!deptQueryHandled) throw new Error('Router failed to handle department progress query!');
    console.log('✅ Passed Test 3: Superuser department progress query handled.');

    // ── Test 4: Superuser Query via Router - Employee Progress ─────────────────
    console.log('\n--- Test 4: Superuser Query via Router - Employee Progress ---');
    const empQueryHandled = await handleTaskManagerMessage({
        senderPhone: superuserPhone,
        messageText: 'Show pending tasks for Sahil',
        user
    });
    console.log('Emp query handled by router:', empQueryHandled);
    if (!empQueryHandled) throw new Error('Router failed to handle employee progress query!');
    console.log('✅ Passed Test 4: Superuser employee progress query handled.');

    // ── Test 5: Superuser Query via Router - Missing Reports ───────────────────
    console.log('\n--- Test 5: Superuser Query via Router - Missing Reports ---');
    const missingQueryHandled = await handleTaskManagerMessage({
        senderPhone: superuserPhone,
        messageText: 'Who has not submitted their daily report today?',
        user
    });
    console.log('Missing reports query handled by router:', missingQueryHandled);
    if (!missingQueryHandled) throw new Error('Router failed to handle missing reports query!');
    console.log('✅ Passed Test 5: Superuser missing reports query handled.');

    // ── Test 6: Non-Enrolled Phone Isolation ───────────────────────────────────
    console.log('\n--- Test 6: Safety Check - Non-Enrolled Phone Bypasses ---');
    const handledNonEnrolled = await handleTaskManagerMessage({
        senderPhone: nonEnrolledPhone,
        messageText: 'What did Tech work on today?',
        user: { id: 'some-other-id', full_name: 'Stranger' }
    });
    console.log('Result for non-enrolled phone (expected false):', handledNonEnrolled);
    if (handledNonEnrolled !== false) throw new Error('Non-enrolled phone was intercepted!');
    console.log('✅ Passed Test 6: Non-enrolled senders strictly bypass Task Manager.');

    // ── Test 7: Facility Maintenance Pass-Through ──────────────────────────────
    console.log('\n--- Test 7: Safety Check - Facility Maintenance Falls Through ---');
    const handledMaintenance = await handleTaskManagerMessage({
        senderPhone: superuserPhone,
        messageText: 'AC in boardroom is leaking water',
        user
    });
    console.log('Result for maintenance issue (expected false):', handledMaintenance);
    if (handledMaintenance !== false) throw new Error('Maintenance request was intercepted by Task Manager!');
    console.log('✅ Passed Test 7: Facility maintenance messages fall through to ticketing.');

    console.log('\n======================================================');
    console.log('🎉 ALL CORPORATE TASK MANAGER & SUPERUSER TESTS PASSED!');
    console.log('======================================================\n');
}

runTests().catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
