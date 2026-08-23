CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "OrgRole" AS ENUM ('org_admin', 'member');
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'review', 'done');
CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'enqueued', 'completed', 'failed');

-- FK deletion policy:
-- * org_members CASCADE with user/org lifecycle; a membership has no independent history.
-- * projects -> organizations RESTRICT to prevent accidental organization-wide project loss.
-- * tasks -> projects CASCADE only for explicit hard-delete maintenance; normal API deletes are soft.
-- * assignments/comments -> tasks CASCADE because dependents have no meaning without the task.
-- * comments -> users RESTRICT to preserve authorship.
-- * notification_outbox -> assignment SET NULL so committed notification events remain auditable after unassignment.

CREATE TABLE "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE TABLE "organizations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE TABLE "org_members" (
  "org_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "OrgRole" NOT NULL DEFAULT 'member',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("org_id", "user_id"),
  CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "projects" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT
);

CREATE TABLE "tasks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "TaskStatus" NOT NULL DEFAULT 'todo',
  "priority" "Priority" NOT NULL DEFAULT 'medium',
  "due_date" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
);

CREATE TABLE "task_assignments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "task_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
  CONSTRAINT "task_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "task_assignments_task_id_user_id_key" UNIQUE ("task_id", "user_id")
);

CREATE TABLE "comments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
  CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE "notification_outbox" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "assignment_id" UUID UNIQUE,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
  "job_id" TEXT UNIQUE,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "enqueued_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  CONSTRAINT "notification_outbox_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "notification_outbox_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "task_assignments"("id") ON DELETE SET NULL
);

CREATE TABLE "refresh_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "refresh_tokens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE
);

-- user -> membership lookup used when resolving organization context.
CREATE INDEX "org_members_user_id_idx" ON "org_members"("user_id");
-- admin/member listings and role checks inside one organization.
CREATE INDEX "org_members_org_id_role_idx" ON "org_members"("org_id", "role");
-- dominant project-list predicate; deleted_at keeps soft-deleted rows out cheaply.
CREATE INDEX "projects_org_id_deleted_at_idx" ON "projects"("org_id", "deleted_at");
-- supports tenant-scoped chronological project listing.
CREATE INDEX "projects_org_id_created_at_idx" ON "projects"("org_id", "created_at");
-- supports project task lists filtered/grouped by status while excluding soft deletes.
CREATE INDEX "tasks_project_id_status_deleted_at_idx" ON "tasks"("project_id", "status", "deleted_at");
-- supports project task lists filtered by priority while excluding soft deletes.
CREATE INDEX "tasks_project_id_priority_deleted_at_idx" ON "tasks"("project_id", "priority", "deleted_at");
-- supports due-date range filtering.
CREATE INDEX "tasks_due_date_idx" ON "tasks"("due_date");
-- supports assignee-based filtering and recent-assignment inspection.
CREATE INDEX "task_assignments_user_id_assigned_at_idx" ON "task_assignments"("user_id", "assigned_at");
-- supports ordered comment timelines per task.
CREATE INDEX "comments_task_id_created_at_idx" ON "comments"("task_id", "created_at");
-- supports active-token revocation/logout-all checks by user and organization.
CREATE INDEX "refresh_tokens_user_id_org_id_revoked_at_idx" ON "refresh_tokens"("user_id", "org_id", "revoked_at");
-- supports the worker relay scanning oldest pending outbox events.
CREATE INDEX "notification_outbox_status_created_at_idx" ON "notification_outbox"("status", "created_at");
-- supports tenant-scoped notification audit/history lookups.
CREATE INDEX "notification_outbox_org_id_created_at_idx" ON "notification_outbox"("org_id", "created_at");

-- Bonus: expression GIN index used by PostgreSQL full-text task search.
CREATE INDEX "tasks_fts_idx" ON "tasks" USING GIN (
  to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", ''))
);
