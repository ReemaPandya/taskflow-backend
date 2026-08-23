import { FastifyReply, FastifyRequest } from 'fastify';
import { OrgRole } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '../../middleware/authenticate';
import { parseOrThrow } from '../../lib/errors';
import * as service from './member.service';

const userIdParam = z.object({ userId: z.string().uuid() });
const addMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100).optional(),
  password: z.string().min(8).max(128).optional(),
  role: z.nativeEnum(OrgRole).default(OrgRole.member)
});
const roleSchema = z.object({ role: z.nativeEnum(OrgRole) });

export async function list(request: FastifyRequest) {
  return service.list(request.auth.orgId);
}

export async function add(request: FastifyRequest, reply: FastifyReply) {
  requireAdmin(request);
  const body = parseOrThrow(addMemberSchema, request.body);
  return reply.code(201).send(await service.add(request.auth.orgId, body));
}

export async function updateRole(request: FastifyRequest) {
  requireAdmin(request);
  const { userId } = parseOrThrow(userIdParam, request.params);
  const { role } = parseOrThrow(roleSchema, request.body);
  return service.updateRole(request.auth.orgId, request.auth.userId, userId, role);
}

export async function remove(request: FastifyRequest, reply: FastifyReply) {
  requireAdmin(request);
  const { userId } = parseOrThrow(userIdParam, request.params);
  await service.remove(request.auth.orgId, request.auth.userId, userId);
  return reply.code(204).send();
}
