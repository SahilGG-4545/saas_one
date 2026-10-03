import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function runTests() {
    const { TaskManagerService } = await import('../TaskManagerService');
    const { handleTaskManagerMessage } = await import('../router');
    const { detectTaskIntent } = await import('../intentDetector');
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');

    console.log('🧪 Starting Phase 4 Conversational AI Intent Detection Tests...\n');

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

    // Clean up test tasks & reports for a clean test run
    await supabaseAdmin.from('tm_tasks').delete().eq('employee_id', user.id);
    await supabaseAdmin.from('tm_daily_reports').delete().eq('user_id', user.id);

    // ── Test 1: Direct Intent Detection Unit Tests ─────────────────────────────
    console.log('\n--- Test 1: Direct Intent Detection Unit Tests ---');

    console.log('Testing: "I finished the vendor report"');
    const intent1 = await detectTaskIntent('I finished the vendor report');
    console.log('Result 1:', intent1.action, '| task_title:', intent1.task_title, '| conf:', intent1.confidence);
    if (intent1.action !== 'complete_task') throw new Error(`Expected complete_task but got ${intent1.action}`);

    console.log('\nTesting: "Show my pending tasks"');
    const intent2 = await detectTaskIntent('Show my pending tasks');
    console.log('Result 2:', intent2.action, '| conf:', intent2.confidence);
    if (intent2.action !== 'list_tasks') throw new Error(`Expected list_tasks but got ${intent2.action}`);

    console.log('\nTesting: "The audit is 70% complete"');
    const intent3 = await detectTaskIntent('The audit is 70% complete');
    console.log('Result 3:', intent3.action, '| progress:', intent3.progress_percentage, '| conf:', intent3.confidence);
    if (intent3.action !== 'update_progress') throw new Error(`Expected update_progress but got ${intent3.action}`);
    if (intent3.progress_percentage !== 70) throw new Error(`Expected progress 70 but got ${intent3.progress_percentage}`);

    console.log('\nTesting: "AC on 3rd floor is leaking water"');
    const intent4 = await detectTaskIntent('AC on 3rd floor is leaking water');
    console.log('Result 4:', intent4.action, '| conf:', intent4.confidence);
    if (intent4.action !== 'ticket_or_maintenance') throw new Error(`Expected ticket_or_maintenance but got ${intent4.action}`);

    console.log('\nTesting: "Today I completed fire safety drill and checked all extinguishers"');
    const intent5 = await detectTaskIntent('Today I completed fire safety drill and checked all extinguishers');
    console.log('Result 5:', intent5.action, '| conf:', intent5.confidence);
    if (intent5.action !== 'daily_report') throw new Error(`Expected daily_report but got ${intent5.action}`);

    console.log('✅ Passed Test 1: All conversational intents classified accurately.');

    // ── Test 2: Seed Tasks for End-to-End Verification ─────────────────────────
    console.log('\n--- Test 2: Seeding active tasks for conversational E2E ---');
    const taskVendor = await TaskManagerService.createTask({
        userId: user.id,
        title: 'Prepare monthly vendor report',
        priority: 'high',
        department: 'Operations'
    });
    const taskAudit = await TaskManagerService.createTask({
        userId: user.id,
        title: 'Quarterly fire safety audit',
        priority: 'urgent',
        department: 'Facility'
    });
    console.log(`Created Task 1: "${taskVendor.title}" (${taskVendor.id})`);
    console.log(`Created Task 2: "${taskAudit.title}" (${taskAudit.id})`);

    // ── Test 3: Conversational Progress Update via Router ──────────────────────
    console.log('\n--- Test 3: Conversational Progress Update via Router ---');
    const handledProgress = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'The audit is 70% complete',
        user
    });
    console.log('Handled by router:', handledProgress);
    if (!handledProgress) throw new Error('Router failed to handle conversational progress update!');

    const { data: updatedAudit } = await supabaseAdmin
        .from('tm_tasks')
        .select('*')
        .eq('id', taskAudit.id)
        .single();
    console.log(`Updated Task in DB: progress=${updatedAudit.progress_percentage}%, status=${updatedAudit.status}`);
    if (updatedAudit.progress_percentage !== 70) {
        throw new Error(`Expected progress 70% in DB, got ${updatedAudit.progress_percentage}%`);
    }
    if (updatedAudit.status !== 'in_progress') {
        throw new Error(`Expected status in_progress in DB, got ${updatedAudit.status}`);
    }
    console.log('✅ Passed Test 3: Conversational progress update processed and persisted.');

    // ── Test 4: Conversational Completion via Router ───────────────────────────
    console.log('\n--- Test 4: Conversational Task Completion via Router ---');
    const handledComplete = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'I finished the vendor report',
        user
    });
    console.log('Handled by router:', handledComplete);
    if (!handledComplete) throw new Error('Router failed to handle conversational completion!');

    const { data: updatedVendor } = await supabaseAdmin
        .from('tm_tasks')
        .select('*')
        .eq('id', taskVendor.id)
        .single();
    console.log(`Updated Task in DB: progress=${updatedVendor.progress_percentage}%, status=${updatedVendor.status}`);
    if (updatedVendor.status !== 'completed') {
        throw new Error(`Expected status completed in DB, got ${updatedVendor.status}`);
    }
    if (updatedVendor.progress_percentage !== 100) {
        throw new Error(`Expected progress 100% in DB, got ${updatedVendor.progress_percentage}%`);
    }
    console.log('✅ Passed Test 4: Conversational completion processed and marked complete.');

    // ── Test 5: Conversational Daily Work Report ───────────────────────────────
    console.log('\n--- Test 5: Conversational Daily Work Report ---');
    const handledReport = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'Today I completed fire safety drill and checked all extinguishers',
        user
    });
    console.log('Handled by router:', handledReport);
    if (!handledReport) throw new Error('Router failed to handle conversational daily report!');

    const { data: dailyReports } = await supabaseAdmin
        .from('tm_daily_reports')
        .select('*')
        .eq('user_id', user.id);
    console.log('Daily reports found in DB:', dailyReports?.length);
    if (!dailyReports || dailyReports.length === 0) {
        throw new Error('Daily report was not persisted in DB!');
    }
    console.log('Report summary in DB:', dailyReports[0].summary);
    console.log('✅ Passed Test 5: Conversational daily report created and saved.');

    // ── Test 6: Maintenance Ticket Pass-Through ────────────────────────────────
    console.log('\n--- Test 6: Safety Check - Facility Maintenance Falls Through ---');
    const handledMaintenance = await handleTaskManagerMessage({
        senderPhone: testPhone,
        messageText: 'Water pipe leaking near conference room 3',
        user
    });
    console.log('Router response for maintenance request (expected false):', handledMaintenance);
    if (handledMaintenance !== false) {
        throw new Error('Maintenance request was improperly intercepted by Task Manager!');
    }
    console.log('✅ Passed Test 6: Maintenance tickets correctly bypass Task Manager to FMS ticket system.');

    // ── Test 7: Unauthorized Phone Check ──────────────────────────────────────
    console.log('\n--- Test 7: Safety Check - Other Phones Untouched ---');
    const handledOtherUser = await handleTaskManagerMessage({
        senderPhone: otherPhone,
        messageText: 'I finished the vendor report',
        user: { id: 'some-other-user', full_name: 'Other Employee' }
    });
    console.log('Router response for other phone (expected false):', handledOtherUser);
    if (handledOtherUser !== false) {
        throw new Error('Safety guard failed: other phone was intercepted!');
    }
    console.log('✅ Passed Test 7: Other phone numbers strictly bypass Task Manager.');

    console.log('\n=========================================');
    console.log('🎉 ALL PHASE 4 INTEGRATION TESTS PASSED!');
    console.log('=========================================\n');
}

runTests().catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
