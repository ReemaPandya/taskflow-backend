import { FastifyReply, FastifyRequest } from 'fastify';
import { Priority, TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/errors';
import * as tasks from './task.service';
import * as assignments from './assignment.service';

const uuid = z.string().uuid();
const taskIdParam = z.object({ id: uuid });
const projectIdParam = z.object({ projectId: uuid });
const assignmentParam = z.object({ taskId: uuid });
const unassignmentParam = z.object({ taskId: uuid, userId: uuid });
const taskQuerySchema = z.object({
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  assignee: uuid.optional(),
  dueFrom: z.string().datetime().optional(),
  dueTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});
const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});
const taskSchema = z.object({
  title: z.string().min(1).max(240),
  description: z.string().max(10000).nullable().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  dueDate: z.string().datetime().nullable().optional()
});
const taskPatchSchema = taskSchema.partial().refine(v => Object.keys(v).length > 0, 'At least one field is required');
const assignmentSchema = z.object({ userId: uuid });
const bulkSchema = z.object({ taskIds: z.array(uuid).min(1).max(100), status: z.nativeEnum(TaskStatus) });
const commentSchema = z.object({ body: z.string().min(1).max(5000) });

export async function list(request: FastifyRequest) {
  const { projectId } = parseOrThrow(projectIdParam, request.params);
  const query = parseOrThrow(taskQuerySchema, request.query);
  return tasks.listProjectTasks(request.auth.orgId, projectId, query);
}

export async function create(request: FastifyRequest, reply: FastifyReply) {
  const { projectId } = parseOrThrow(projectIdParam, request.params);
  return reply.code(201).send(await tasks.create(request.auth.orgId, projectId, parseOrThrow(taskSchema, request.body)));
}

export async function search(request: FastifyRequest) {
  const query = parseOrThrow(searchQuerySchema, request.query);
  return tasks.fullTextSearch(request.auth.orgId, query.q, query.page, query.limit);
}

export async function bulkStatus(request: FastifyRequest) {
  const body = parseOrThrow(bulkSchema, request.body);
  return tasks.bulkStatus(request.auth.orgId, body.taskIds, body.status);
}

export async function get(request: FastifyRequest) {
  const { id } = parseOrThrow(taskIdParam, request.params);
  return tasks.getTask(request.auth.orgId, id);
}

export async function update(request: FastifyRequest) {
  const { id } = parseOrThrow(taskIdParam, request.params);
  return tasks.update(request.auth.orgId, id, parseOrThrow(taskPatchSchema, request.body));
}

export async function remove(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parseOrThrow(taskIdParam, request.params);
  await tasks.remove(request.auth.orgId, id);
  return reply.code(204).send();
}

export async function assign(request: FastifyRequest, reply: FastifyReply) {
  const { taskId } = parseOrThrow(assignmentParam, request.params);
  const { userId } = parseOrThrow(assignmentSchema, request.body);
  const result = await assignments.assign(request.auth.orgId, taskId, userId, request.auth.userId);
  return reply.code(result.recovered ? 200 : 201).send(result);
}

export async function unassign(request: FastifyRequest, reply: FastifyReply) {
  const { taskId, userId } = parseOrThrow(unassignmentParam, request.params);
  await assignments.unassign(request.auth.orgId, taskId, userId);
  return reply.code(204).send();
}

export async function listComments(request: FastifyRequest) {
  const { taskId } = parseOrThrow(assignmentParam, request.params);
  return tasks.listComments(request.auth.orgId, taskId);
}

export async function addComment(request: FastifyRequest, reply: FastifyReply) {
  const { taskId } = parseOrThrow(assignmentParam, request.params);
  const { body } = parseOrThrow(commentSchema, request.body);
  return reply.code(201).send(await tasks.addComment(request.auth.orgId, request.auth.userId, taskId, body));
}
