import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ApiError } from './lib/errors';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { dedupeRedis } from './lib/dedupe-redis';
import { emailQueue, deadLetterQueue } from './queues/email.queue';
import { authRoutes } from './modules/auth/auth.routes';
import { memberRoutes } from './modules/organizations/member.routes';
import { projectRoutes } from './modules/projects/project.routes';
import { taskRoutes } from './modules/tasks/task.routes';
import { jobRoutes } from './modules/jobs/job.routes';

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cors, { origin: false });
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    mode: 'static',
    specification: { path: path.join(process.cwd(), 'openapi.yaml'), baseDir: process.cwd() }
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    const pong = await redis.ping();
    return { status: 'ok', postgres: 'ok', redis: pong === 'PONG' ? 'ok' : 'error' };
  });

  app.get('/', async () => {
    return {
      name: 'TaskFlow API',
      status: 'running',
      documentation: '/docs',
      health: '/health'
    };
  });

  await app.register(authRoutes);
  await app.register(memberRoutes);
  await app.register(projectRoutes);
  await app.register(taskRoutes);
  await app.register(jobRoutes);

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Route not found', code: 'ROUTE_NOT_FOUND', details: {} }));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
    }

    const prismaCode = (error as { code?: string }).code;
    if (prismaCode === 'P2002') {
      return reply.code(409).send({ error: 'Resource already exists', code: 'CONFLICT', details: {} });
    }
    if (prismaCode === 'P2025') {
      return reply.code(404).send({ error: 'Resource not found', code: 'NOT_FOUND', details: {} });
    }

    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      const code = statusCode === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST';
      return reply.code(statusCode).send({ error: error.message, code, details: {} });
    }

    app.log.error(error);
    return reply.code(500).send({ error: 'Internal server error', code: 'INTERNAL_ERROR', details: {} });
  });

  app.addHook('onClose', async () => {
    await emailQueue.close();
    await deadLetterQueue.close();
    await dedupeRedis.quit().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await prisma.$disconnect();
  });
  return app;
}
