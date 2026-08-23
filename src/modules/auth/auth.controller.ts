import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/errors';
import * as service from './auth.service';

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8).max(128),
  organizationName: z.string().min(2).max(120)
});
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationId: z.string().uuid().optional()
});
const refreshSchema = z.object({ refreshToken: z.string().min(20) });

export async function register(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(201).send(await service.register(parseOrThrow(registerSchema, request.body)));
}

export async function login(request: FastifyRequest) {
  return service.login(parseOrThrow(loginSchema, request.body));
}

export async function refresh(request: FastifyRequest) {
  const { refreshToken } = parseOrThrow(refreshSchema, request.body);
  return service.refresh(refreshToken);
}

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  const { refreshToken } = parseOrThrow(refreshSchema, request.body);
  await service.logout(refreshToken);
  return reply.code(204).send();
}

export async function logoutAll(request: FastifyRequest, reply: FastifyReply) {
  await service.logoutAll(request.auth.userId, request.auth.orgId);
  return reply.code(204).send();
}
