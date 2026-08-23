import { Prisma, Priority, TaskStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../lib/errors';
import { getPagination } from '../../lib/pagination';

export async function getTask(orgId: string, id: string) {
  const task = await prisma.task.findFirst({
    where: { id, deletedAt: null, project: { orgId, deletedAt: null } },
    include: { assignments: { include: { user: { select: { id: true, email: true, name: true } } } } }
  });
  if (task) return task;
  const exists = await prisma.task.findUnique({ where: { id }, include: { project: true } });
  if (exists && exists.project.orgId !== orgId) throw new ApiError(403, 'Forbidden', 'FORBIDDEN');
  throw new ApiError(404, 'Task not found', 'TASK_NOT_FOUND');
}

export async function listProjectTasks(orgId: string, projectId: string, query: Record<string, unknown>) {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId, deletedAt: null } });
  if (!project) {
    const anyProject = await prisma.project.findUnique({ where: { id: projectId } });
    if (anyProject && anyProject.orgId !== orgId) throw new ApiError(403, 'Forbidden', 'FORBIDDEN');
    throw new ApiError(404, 'Project not found', 'PROJECT_NOT_FOUND');
  }
  const p = getPagination(query.page, query.limit);
  const where: Prisma.TaskWhereInput = { projectId, deletedAt: null };
  if (query.status) where.status = query.status as TaskStatus;
  if (query.priority) where.priority = query.priority as Priority;
  if (query.assignee) where.assignments = { some: { userId: String(query.assignee) } };
  if (query.dueFrom || query.dueTo) where.dueDate = { gte: query.dueFrom ? new Date(String(query.dueFrom)) : undefined, lte: query.dueTo ? new Date(String(query.dueTo)) : undefined };
  const [data, total] = await Promise.all([
    prisma.task.findMany({ where, skip: p.skip, take: p.limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { assignments: true } }),
    prisma.task.count({ where })
  ]);
  return { data, total, page: p.page, limit: p.limit };
}

export async function create(orgId: string, projectId: string, input: { title: string; description?: string | null; status?: TaskStatus; priority?: Priority; dueDate?: string | null }) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.deletedAt) throw new ApiError(404, 'Project not found', 'PROJECT_NOT_FOUND');
  if (project.orgId !== orgId) throw new ApiError(403, 'Forbidden', 'FORBIDDEN');
  return prisma.task.create({ data: { projectId, title: input.title, description: input.description, status: input.status, priority: input.priority, dueDate: input.dueDate ? new Date(input.dueDate) : null } });
}

export async function update(orgId: string, id: string, input: { title?: string; description?: string | null; status?: TaskStatus; priority?: Priority; dueDate?: string | null }) {
  await getTask(orgId, id);
  const { dueDate, ...rest } = input;
  await prisma.task.updateMany({
    where: { id, deletedAt: null, project: { orgId, deletedAt: null } },
    data: { ...rest, ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}) }
  });
  return getTask(orgId, id);
}

export async function remove(orgId: string, id: string) {
  await getTask(orgId, id);
  await prisma.task.updateMany({
    where: { id, deletedAt: null, project: { orgId, deletedAt: null } },
    data: { deletedAt: new Date() }
  });
}

export async function bulkStatus(orgId: string, taskIds: string[], status: TaskStatus) {
  const count = await prisma.task.count({ where: { id: { in: taskIds }, deletedAt: null, project: { orgId, deletedAt: null } } });
  if (count !== taskIds.length) throw new ApiError(403, 'One or more tasks are not accessible in this organization', 'FORBIDDEN');
  const result = await prisma.task.updateMany({
    where: { id: { in: taskIds }, deletedAt: null, project: { orgId, deletedAt: null } },
    data: { status }
  });
  return { updated: result.count };
}

export async function fullTextSearch(orgId: string, q: string, pageInput?: unknown, limitInput?: unknown) {
  const p = getPagination(pageInput, limitInput);
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT t.id, t.project_id AS "projectId", t.title, t.description, t.status, t.priority,
           t.due_date AS "dueDate", t.created_at AS "createdAt", t.updated_at AS "updatedAt",
           ts_rank(
             to_tsvector('english', coalesce(t.title, '') || ' ' || coalesce(t.description, '')),
             plainto_tsquery('english', ${q})
           ) AS rank
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    WHERE p.org_id = ${orgId}::uuid
      AND p.deleted_at IS NULL AND t.deleted_at IS NULL
      AND to_tsvector('english', coalesce(t.title, '') || ' ' || coalesce(t.description, '')) @@ plainto_tsquery('english', ${q})
    ORDER BY rank DESC, t.created_at DESC
    LIMIT ${p.limit} OFFSET ${p.skip}
  `);
  return { data: rows, page: p.page, limit: p.limit };
}

export async function listComments(orgId: string, taskId: string) {
  await getTask(orgId, taskId);
  return prisma.comment.findMany({
    where: { taskId, task: { project: { orgId, deletedAt: null }, deletedAt: null } },
    include: { author: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: 'asc' }
  });
}

export async function addComment(orgId: string, authorId: string, taskId: string, body: string) {
  await getTask(orgId, taskId);
  return prisma.comment.create({ data: { taskId, authorId, body } });
}
