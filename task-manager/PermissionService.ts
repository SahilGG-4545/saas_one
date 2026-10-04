import { TaskDatabaseService } from './TaskDatabaseService';
import { Employee, EmployeeRole, TaskAssignment } from './types';

export class PermissionDeniedError extends Error {
    public readonly code = 'PERMISSION_DENIED';
    public readonly actorId: string;
    public readonly action: string;

    constructor(action: string, actorId: string, reason?: string) {
        super(reason || `Action '${action}' denied for user ${actorId}`);
        this.name = 'PermissionDeniedError';
        this.actorId = actorId;
        this.action = action;
    }
}

export class PermissionService {
    /**
     * Resolves the actor's employee profile and task role.
     */
    static async getActor(actorId: string): Promise<Employee> {
        const actor = await TaskDatabaseService.getEmployeeById(actorId);
        if (!actor) {
            throw new PermissionDeniedError('RESOLVE_ACTOR', actorId, `Actor with ID ${actorId} not found or inactive`);
        }
        return actor;
    }

    /**
     * Validates if the actor is permitted to read an assigned task.
     * - Employee: Own tasks only
     * - Manager: Own department tasks
     * - Superuser: Any task
     */
    static async assertCanReadTask(actorId: string, task: TaskAssignment): Promise<void> {
        const actor = await this.getActor(actorId);

        if (actor.role === 'superuser') return;

        if (task.employee_id === actor.id) return;

        if (actor.role === 'reporting_manager') {
            const taskOwner = await TaskDatabaseService.getEmployeeById(task.employee_id);
            if (taskOwner && taskOwner.department_id && taskOwner.department_id === actor.department_id) {
                return;
            }
        }

        await TaskDatabaseService.logAudit({
            eventType: 'permission_denied',
            actorId: actor.id,
            targetEmployeeId: task.employee_id,
            taskId: task.id,
            details: { action: 'READ_TASK', reason: 'Not task owner or department manager' }
        });

        throw new PermissionDeniedError('READ_TASK', actorId, 'You do not have permission to view this task.');
    }

    /**
     * Validates if the actor is permitted to complete or update status of a task.
     * - Employee: Can complete their own task
     * - Manager: Can update tasks within their own department
     * - Superuser: Can update any task
     */
    static async assertCanCompleteTask(actorId: string, task: TaskAssignment): Promise<void> {
        const actor = await this.getActor(actorId);

        if (actor.role === 'superuser') return;

        if (task.employee_id === actor.id) return;

        if (actor.role === 'reporting_manager') {
            const taskOwner = await TaskDatabaseService.getEmployeeById(task.employee_id);
            if (taskOwner && taskOwner.department_id && taskOwner.department_id === actor.department_id) {
                return;
            }
        }

        await TaskDatabaseService.logAudit({
            eventType: 'permission_denied',
            actorId: actor.id,
            targetEmployeeId: task.employee_id,
            taskId: task.id,
            details: { action: 'COMPLETE_TASK', reason: 'Not authorized to complete another user task' }
        });

        throw new PermissionDeniedError('COMPLETE_TASK', actorId, 'You can only complete your own assigned tasks.');
    }

    /**
     * Validates if the actor is permitted to assign a task to a target employee.
     * - Employee: Cannot assign tasks to anyone
     * - Manager: Can ONLY assign to employees in their OWN department
     * - Superuser: Can assign to any employee across the entire organization
     */
    static async assertCanAssignTask(actorId: string, targetEmployeeId: string): Promise<{ actor: Employee; target: Employee }> {
        const actor = await this.getActor(actorId);
        const target = await TaskDatabaseService.getEmployeeById(targetEmployeeId);

        if (!target) {
            throw new Error(`Target employee ${targetEmployeeId} not found or inactive`);
        }

        if (actor.role === 'superuser') {
            return { actor, target };
        }

        if (actor.role === 'reporting_manager') {
            if (!actor.department_id) {
                await TaskDatabaseService.logAudit({
                    eventType: 'permission_denied',
                    actorId: actor.id,
                    targetEmployeeId: target.id,
                    details: { action: 'ASSIGN_TASK', reason: 'Reporting manager has no department assigned' }
                });
                throw new PermissionDeniedError('ASSIGN_TASK', actorId, 'Reporting manager is not assigned to a department.');
            }

            if (target.department_id !== actor.department_id) {
                await TaskDatabaseService.logAudit({
                    eventType: 'permission_denied',
                    actorId: actor.id,
                    targetEmployeeId: target.id,
                    details: {
                        action: 'ASSIGN_TASK',
                        reason: 'Cross-department assignment prohibited',
                        actorDept: actor.department_id,
                        targetDept: target.department_id
                    }
                });
                throw new PermissionDeniedError(
                    'ASSIGN_TASK',
                    actorId,
                    `Reporting Managers can only assign tasks to employees in their own department.`
                );
            }

            return { actor, target };
        }

        // Standard employees cannot assign tasks
        await TaskDatabaseService.logAudit({
            eventType: 'permission_denied',
            actorId: actor.id,
            targetEmployeeId: target.id,
            details: { action: 'ASSIGN_TASK', reason: 'Employees cannot assign tasks' }
        });

        throw new PermissionDeniedError('ASSIGN_TASK', actorId, 'Standard employees cannot assign tasks.');
    }

    /**
     * Validates if the actor is permitted to view a specific department's progress.
     * - Employee: Cannot view department progress
     * - Manager: Own department only
     * - Superuser: Any department
     */
    static async assertCanViewDepartment(actorId: string, departmentId: string): Promise<void> {
        const actor = await this.getActor(actorId);

        if (actor.role === 'superuser') return;

        if (actor.role === 'reporting_manager' && actor.department_id === departmentId) {
            return;
        }

        await TaskDatabaseService.logAudit({
            eventType: 'permission_denied',
            actorId: actor.id,
            details: { action: 'VIEW_DEPARTMENT', requestedDept: departmentId, reason: 'Department access restricted' }
        });

        throw new PermissionDeniedError('VIEW_DEPARTMENT', actorId, 'Access restricted to your own department.');
    }

    /**
     * Validates if the actor can query organization-wide metrics.
     * - Superuser only
     */
    static async assertCanViewOrganisation(actorId: string): Promise<void> {
        const actor = await this.getActor(actorId);

        if (actor.role === 'superuser') return;

        await TaskDatabaseService.logAudit({
            eventType: 'permission_denied',
            actorId: actor.id,
            details: { action: 'VIEW_ORGANISATION', reason: 'Requires superuser role' }
        });

        throw new PermissionDeniedError('VIEW_ORGANISATION', actorId, 'Superuser role required to view organization-wide progress.');
    }

    /**
     * Returns the list of department IDs accessible by this actor.
     * - Superuser: all active department IDs
     * - Manager: [own department_id]
     * - Employee: []
     */
    static async getAccessibleDepartmentIds(actorId: string): Promise<string[]> {
        const actor = await this.getActor(actorId);

        if (actor.role === 'superuser') {
            const allDepts = await TaskDatabaseService.getDepartments();
            return allDepts.map(d => d.id);
        }

        if (actor.role === 'reporting_manager' && actor.department_id) {
            return [actor.department_id];
        }

        return [];
    }
}
