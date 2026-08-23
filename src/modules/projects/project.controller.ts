import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../../middleware/authenticate';
import { parseOrThrow } from '../../lib/errors';
import * as service from './project.service';

const idParam = z.object({ id: z.string().uuid() });
const paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});
const bodySchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(5000).nullable().optional()
});
const patchSchema = bodySchema.partial().refine(v => Object.keys(v).length > 0, 'At least one field is required');

export async function list(request: FastifyRequest) {
  const q = parseOrThrow(paginationSchema, request.query);
  return service.list(request.auth.orgId, q.page, q.limit);
}

export async function create(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(201).send(await service.create(request.auth.orgId, parseOrThrow(bodySchema, request.body)));
}

export async function get(request: FastifyRequest) {
  const { id } = parseOrThrow(idParam, request.params);
  return service.get(request.auth.orgId, id);
}

export async function update(request: FastifyRequest) {
  const { id } = parseOrThrow(idParam, request.params);
  return service.update(request.auth.orgId, id, parseOrThrow(patchSchema, request.body));
}

export async function remove(request: FastifyRequest, reply: FastifyReply) {
  requireAdmin(request);
  const { id } = parseOrThrow(idParam, request.params);
  await service.remove(request.auth.orgId, id);
  return reply.code(204).send();
}

export async function dashboard(request: FastifyRequest) {
  const { id } = parseOrThrow(idParam, request.params);
  return service.dashboard(request.auth.orgId, id);
}
