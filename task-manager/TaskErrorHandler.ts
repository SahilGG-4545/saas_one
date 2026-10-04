export class TaskErrorHandler {
    /**
     * User requested a task number not in today's list.
     */
    static invalidTaskNumber(taskNumber: number): string {
        return [
            `I couldn't find task #${taskNumber} for today.`,
            ``,
            `Reply "tasks" to see your current tasks.`
        ].join('\n');
    }

    /**
     * Employee has no tasks assigned for the date.
     */
    static noTasksAssigned(date?: string): string {
        return `You don't have any tasks assigned for today.`;
    }

    /**
     * Task was already marked completed previously.
     */
    static alreadyCompleted(taskNumber: number, title?: string): string {
        const titleSnippet = title ? ` ("${title}")` : '';
        return `Task #${taskNumber}${titleSnippet} is already marked as completed.`;
    }

    /**
     * Message could not be parsed to a recognized action or intent.
     */
    static ambiguousMessage(): string {
        return [
            `I'm not sure what you'd like to do.`,
            ``,
            `You can use:`,
            `• tasks`,
            `• done 1`,
            `• done all`,
            `• facility`
        ].join('\n');
    }

    /**
     * Unregistered phone number attempting to interact with Task Manager.
     */
    static unregisteredPhone(): string {
        return `Sorry, this phone number is not registered as an active employee for Task Management.`;
    }

    /**
     * Action rejected due to insufficient permissions.
     */
    static permissionDenied(reason?: string): string {
        return `Access Denied: ${reason || 'You do not have permission to perform this action.'}`;
    }

    /**
     * Unexpected server or database exception.
     */
    static systemError(): string {
        return `Something went wrong while processing your request. Please try again in a moment or reply "tasks".`;
    }
}
