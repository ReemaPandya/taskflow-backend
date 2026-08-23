import { prisma } from '../../lib/prisma';
import { ApiError } from '../../lib/errors';
import { getPagination } from '../../lib/pagination';

export async function list(orgId: string, page?: unknown, limit?: unknown) {
  const p = getPagination(page, limit);
  const where = { orgId, deletedAt: null };
  const [data, total] = await Promise.all([
    prisma.project.findMany({ where, skip: p.skip, take: p.limit, orderBy: { createdAt: 'desc' } }),
    prisma.project.count({ where })
  ]);
  return { data, total, page: p.page, limit: p.limit };
}

export async function get(orgId: string, id: string) {
  const project = await prisma.project.findFirst({ where: { id, orgId, deletedAt: null } });
  if (project) return project;
  const exists = await prisma.project.findUnique({ where: { id } });
  if (exists && exists.orgId !== orgId) throw new ApiError(403, 'Forbidden', 'FORBIDDEN');
  throw new ApiError(404, 'Project not found', 'PROJECT_NOT_FOUND');
}

export async function create(orgId: string, input: { name: string; description?: string | null }) {
  return prisma.project.create({ data: { orgId, name: input.name, description: input.description } });
}

export async function update(orgId: string, id: string, input: { name?: string; description?: string | null }) {
  await get(orgId, id);
  await prisma.project.updateMany({ where: { id, orgId, deletedAt: null }, data: input });
  return get(orgId, id);
}

export async function remove(orgId: string, id: string) {
  await get(orgId, id);
  await prisma.project.updateMany({ where: { id, orgId, deletedAt: null }, data: { deletedAt: new Date() } });
}

export async function dashboard(orgId: string, id: string) {
  await get(orgId, id);
  const groups = await prisma.task.groupBy({ by: ['status'], where: { projectId: id, deletedAt: null, project: { orgId, deletedAt: null } }, _count: { _all: true } });
  const counts = { todo: 0, in_progress: 0, review: 0, done: 0 };
  for (const row of groups) counts[row.status] = row._count._all;
  return { projectId: id, taskCounts: counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}
