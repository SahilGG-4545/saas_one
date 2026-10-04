import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskMessagingService } from './TaskMessagingService';
import { TaskErrorHandler } from './TaskErrorHandler';
import { Employee, TaskAssignment } from './types';

export interface CommandExecutionResult {
    success: boolean;
    command: 'tasks' | 'status' | 'done_single' | 'done_all' | 'cancel' | 'unknown' | 'unregistered';
    taskNumber?: number;
    affectedTaskId?: string;
    employee?: Employee;
    replyText: string;
    progress?: {
        total: number;
        completed: number;
        percent: number;
    };
}

export class TaskCommandHandler {
    /**
     * Executes deterministic employee WhatsApp commands.
     */
    static async handleCommand(params: {
        phone: string;
        text: string;
        sendReply?: boolean;
        date?: string;
    }): Promise<CommandExecutionResult> {
        const cleanText = params.text.trim();
        const lower = cleanText.toLowerCase();
        const targetDate = params.date || new Date().toISOString().slice(0, 10);
        const shouldSend = params.sendReply ?? true;

        // 1. Identify employee
        const employee = await TaskDatabaseService.getEmployeeByPhone(params.phone);
        if (!employee) {
            const reply = TaskErrorHandler.unregisteredPhone();
            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
            return {
                success: false,
                command: 'unregistered',
                replyText: reply
            };
        }

        // Set or renew active Task Manager conversation context (30 min TTL)
        await TaskDatabaseService.setConversationContext({
            phone: params.phone,
            system: 'TASK_MANAGER',
            contextType: 'ACTIVE_SESSION',
            ttlMinutes: 30
        });

        // 2. Fetch today's tasks
        const tasks = await TaskDatabaseService.getDailyAssignments({
            employeeId: employee.id,
            date: targetDate
        });

        // ── Command 1: Cancel ─────────────────────────────────────────────────
        if (lower === 'cancel') {
            await TaskDatabaseService.clearConversationContext(params.phone, 'TASK_MANAGER');
            const reply = "Task Manager session cleared. You can reply 'tasks' anytime to restart.";
            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
            return {
                success: true,
                command: 'cancel',
                employee,
                replyText: reply
            };
        }

        // ── Command 2: List Tasks / Status ────────────────────────────────────
        if (lower === 'tasks' || lower === 'status' || lower === 'my tasks' || lower === 'today tasks' || lower === "today's tasks") {
            if (tasks.length === 0) {
                const reply = TaskErrorHandler.noTasksAssigned(targetDate);
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: true,
                    command: 'tasks',
                    employee,
                    replyText: reply,
                    progress: { total: 0, completed: 0, percent: 100 }
                };
            }

            const completedCount = tasks.filter(t => t.status === 'completed').length;
            const percent = Math.round((completedCount / tasks.length) * 100);

            const taskLines = tasks.map((t, idx) => {
                const icon = t.status === 'completed' ? '✅' : '⏳';
                const statusStr = t.status === 'completed' ? 'Completed' : 'Pending';
                return `${idx + 1}. ${t.title} [${statusStr} ${icon}]`;
            }).join('\n');

            const reply = [
                `📋 Tasks for today (${targetDate}):`,
                '',
                taskLines,
                '',
                `Progress: ${completedCount}/${tasks.length} (${percent}%)`,
                '',
                `💡 Reply "done 1" to complete a task, or "done all" to finish all.`
            ].join('\n');

            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
            return {
                success: true,
                command: 'tasks',
                employee,
                replyText: reply,
                progress: { total: tasks.length, completed: completedCount, percent }
            };
        }

        // ── Command 3: Done All ───────────────────────────────────────────────
        if (lower === 'done all' || lower === 'done-all' || lower === 'complete all' || lower === 'finished all' || lower === 'all done') {
            if (tasks.length === 0) {
                const reply = "You don't have any tasks assigned for today.";
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: true,
                    command: 'done_all',
                    employee,
                    replyText: reply
                };
            }

            const pendingTasks = tasks.filter(t => t.status !== 'completed');
            if (pendingTasks.length === 0) {
                const reply = `All your tasks for today are already completed! Great job! 🎉 (Progress: 100%)`;
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: true,
                    command: 'done_all',
                    employee,
                    replyText: reply,
                    progress: { total: tasks.length, completed: tasks.length, percent: 100 }
                };
            }

            // Mark all pending tasks as completed
            for (const task of pendingTasks) {
                await TaskDatabaseService.updateAssignmentStatus({
                    assignmentId: task.id,
                    status: 'completed'
                });
            }

            // Log bulk audit
            await TaskDatabaseService.logAudit({
                eventType: 'task_bulk_completed',
                actorId: employee.id,
                targetEmployeeId: employee.id,
                details: {
                    date: targetDate,
                    completedTaskIds: pendingTasks.map(t => t.id),
                    totalCount: tasks.length
                }
            });

            const reply = `🎉 All your tasks for today have been completed (${tasks.length}/${tasks.length} - 100%)!\n\nHave a great rest of your day!`;
            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);

            return {
                success: true,
                command: 'done_all',
                employee,
                replyText: reply,
                progress: { total: tasks.length, completed: tasks.length, percent: 100 }
            };
        }

        // ── Command 4: Done <Number> (e.g., done 1, done 2) ───────────────────
        const singleDoneMatch = lower.match(/^(?:done|complete|finish)\s+(\d+)$/i);
        if (singleDoneMatch) {
            const taskNum = parseInt(singleDoneMatch[1], 10);
            const taskIndex = taskNum - 1;

            if (taskIndex < 0 || taskIndex >= tasks.length) {
                const reply = TaskErrorHandler.invalidTaskNumber(taskNum);
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: false,
                    command: 'done_single',
                    taskNumber: taskNum,
                    employee,
                    replyText: reply
                };
            }

            const targetTask = tasks[taskIndex];
            if (targetTask.status === 'completed') {
                const reply = TaskErrorHandler.alreadyCompleted(taskNum, targetTask.title);
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: true,
                    command: 'done_single',
                    taskNumber: taskNum,
                    affectedTaskId: targetTask.id,
                    employee,
                    replyText: reply
                };
            }

            // Update status to completed
            await TaskDatabaseService.updateAssignmentStatus({
                assignmentId: targetTask.id,
                status: 'completed'
            });

            // Log audit
            await TaskDatabaseService.logAudit({
                eventType: 'task_completed',
                actorId: employee.id,
                targetEmployeeId: employee.id,
                taskId: targetTask.id,
                details: { taskNumber: taskNum, title: targetTask.title, date: targetDate }
            });

            // Recalculate progress
            const newCompletedCount = tasks.filter(t => t.id === targetTask.id || t.status === 'completed').length;
            const percent = Math.round((newCompletedCount / tasks.length) * 100);

            const allDoneCelebration = newCompletedCount === tasks.length ? '\n\n🎉 Fantastic! You have completed all tasks for today!' : '';
            const reply = `✅ Marked task #${taskNum} ("${targetTask.title}") as completed!\n\nProgress: ${newCompletedCount}/${tasks.length} (${percent}%)${allDoneCelebration}`;

            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);

            return {
                success: true,
                command: 'done_single',
                taskNumber: taskNum,
                affectedTaskId: targetTask.id,
                employee,
                replyText: reply,
                progress: { total: tasks.length, completed: newCompletedCount, percent }
            };
        }

        // ── Command 5: Fallback / Help ────────────────────────────────────────
        const reply = TaskErrorHandler.ambiguousMessage();

        if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
        return {
            success: false,
            command: 'unknown',
            employee,
            replyText: reply
        };
    }
}
