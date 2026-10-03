# FMS Employee Task Manager

## Project Goal

Build an Employee Task Manager directly inside the existing FMS application.

Employees should be able to use WhatsApp to:

Create tasks
View their tasks
Update task progress
Mark tasks as completed
Add progress updates
Ask about pending/overdue tasks
Submit daily work updates

Managers/co-founders should eventually be able to:

View employee tasks
View department progress
See pending/completed/overdue tasks
Receive progress updates
Ask task-related questions through WhatsApp
View task information from the FMS dashboard

The task manager must reuse the FMS's existing WhatsApp/AiSensy infrastructure instead of creating a separate WhatsApp integration.

## Existing Infrastructure

The FMS already has:

* AiSensy webhook: `app/api/webhooks/aisensy/route.ts`
* WhatsApp processing: `backend/lib/whatsapp/processMessage.ts`
* `AiSensyService`
* `WhatsAppService`
* WhatsApp queue
* Supabase
* Existing employee/user system
* Existing AI infrastructure

**Reuse these. Do not create duplicate WhatsApp/AiSensy infrastructure.**

## Architecture

```text
WhatsApp
   ↓
AiSensy
   ↓
Existing FMS webhook
   ↓
Existing message processor
   ↓
Task Manager logic
   ↓
Supabase
   ↓
Existing WhatsAppService
   ↓
AiSensy
```

## Development Phases

### Phase 1 — Inspect Existing FMS

Before changing code, inspect:

* Existing WhatsApp flow
* Employee/user tables
* Departments
* Supabase structure
* Existing AI system
* Authentication/roles

Identify the safest place to integrate the Task Manager.

**No code changes yet.**

### Phase 2 — Task Database

Add the required task functionality using existing FMS users/departments.

Tasks should support:

* Title
* Description
* Employee
* Status
* Priority
* Progress
* Due date
* Created/completed timestamps

Also add task updates and daily reports if required.

### Phase 3 — WhatsApp Task Integration

Integrate task handling into the existing `processMessage.ts` flow.

Create a separate task service/module for:

* Create task
* List tasks
* Update task
* Complete task
* Update progress

Use the existing `WhatsAppService` for replies.

Make sure task messages do not accidentally enter the existing FMS ticket flow.

### Phase 4 — AI

Add LLM-based intent detection for natural language such as:

> "I finished the vendor report."

> "Show my pending tasks."

> "The audit is 70% complete."

The AI should return structured data. Backend code validates it and performs database operations.

**LLM must never directly modify the database.**

### Phase 5 — Manager Features

Add:

* Manager WhatsApp queries
* Employee progress
* Department progress
* Pending/overdue tasks
* Daily reports

### Phase 6 — FMS Dashboard

Add a simple Task Manager section to the existing FMS dashboard.

Reuse existing FMS UI, authentication and components.

### Phase 7 — Notifications

Later add:

* Task reminders
* Daily progress reminders
* Overdue notifications
* Manager alerts

Reuse the existing WhatsApp queue/AiSensy infrastructure.

## Rules

* Build one phase at a time.
* Inspect existing code before modifying it.
* Reuse existing FMS infrastructure.
* Do not create a separate backend/frontend.
* Do not create another AiSensy webhook.
* Do not duplicate employee/user systems.
* Keep business logic separate from WhatsApp code.
* Do not add MCP, RAG, LangGraph, voice, or complex architecture unless explicitly requested.
* After each phase: test, show changed files, explain the implementation, then STOP and wait for approval.

## Start Now

Start with **Phase 1 only**.

Inspect the existing FMS and give me the recommended integration approach.

**Do not modify any code yet.**
