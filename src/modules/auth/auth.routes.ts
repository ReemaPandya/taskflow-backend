import { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import * as controller from './auth.controller';

export async function authRoutes(app: FastifyInstance) {
  const rateLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  app.post('/auth/register', rateLimit, controller.register);
  app.post('/auth/login', rateLimit, controller.login);
  app.post('/auth/refresh', rateLimit, controller.refresh);
  app.post('/auth/logout', rateLimit, controller.logout);
  app.post('/auth/logout-all', { preHandler: authenticate }, controller.logoutAll);
}
