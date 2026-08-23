import { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import * as controller from './project.controller';

export async function projectRoutes(app: FastifyInstance) {
  app.get('/projects', { preHandler: authenticate }, controller.list);
  app.post('/projects', { preHandler: authenticate }, controller.create);
  app.get('/projects/:id', { preHandler: authenticate }, controller.get);
  app.patch('/projects/:id', { preHandler: authenticate }, controller.update);
  app.delete('/projects/:id', { preHandler: authenticate }, controller.remove);
  app.get('/projects/:id/dashboard', { preHandler: authenticate }, controller.dashboard);
}
