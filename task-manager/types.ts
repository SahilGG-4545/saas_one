/**
 * WhatsApp Employee Task Manager — Core Type Definitions (Phase 1)
 * Defined per specifications in Project_plan.md, integrated directly with employee_profiles
 */

export type EmployeeRole = 'employee' | 'reporting_manager' | 'superuser';

export type TaskType = 'fixed' | 'assigned';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export type ContextSystem = 'TASK_MANAGER' | 'FACILITY';

export interface Department {
    id: string;
    name: string;
    code?: string | null;
    is_active: boolean;
    created_at: string;
}

export interface EmployeeProfile {
    id: string;
    user_id: string;
    first_name: string;
    last_name: string;
    phone: string;
    email?: string | null;
    department: string | null;
    department_id: string | null;
    task_role: EmployeeRole;
    designation: string | null;
    reporting_manager_id: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    department_ref?: Department | null;
    user?: {
        id: string;
        full_name: string;
        phone: string;
        is_master_admin?: boolean;
    } | null;
}

// Convenient alias for employee representation across Task Manager
export interface Employee {
    id: string; // user_id
    profile_id?: string;
    name: string;
    phone_number: string;
    department_id: string | null;
    department_name: string | null;
    role: EmployeeRole;
    reporting_manager_id: string | null;
    active: boolean;
    created_at: string;
    updated_at?: string;
}

export interface TaskTemplate {
    id: string;
    title: string;
    description: string | null;
    department_id: string | null;
    created_by: string | null;
    task_type: TaskType;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    department?: Department | null;
}

export interface TaskAssignment {
    id: string;
    task_template_id: string | null;
    title: string;
    description: string | null;
    employee_id: string; // references users(id)
    assigned_date: string; // YYYY-MM-DD
    status: TaskStatus;
    assigned_by: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
    employee?: Employee | null;
    template?: TaskTemplate | null;
}

export interface ConversationContext {
    id: string;
    phone_number: string;
    system: ContextSystem;
    context_type: string;
    context_data: Record<string, any>;
    expires_at: string;
    created_at: string;
    updated_at: string;
}

export interface TaskAuditLog {
    id: string;
    event_type: string;
    actor_id: string | null;
    target_employee_id: string | null;
    task_id: string | null;
    details: Record<string, any>;
    created_at: string;
}

export interface ProgressSummary {
    total: number;
    completed: number;
    in_progress: number;
    pending: number;
    percentage: number;
}
