import { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import * as controller from './task.controller';

export async function taskRoutes(app: FastifyInstance) {
  app.get('/projects/:projectId/tasks', { preHandler: authenticate }, controller.list);
  app.post('/projects/:projectId/tasks', { preHandler: authenticate }, controller.create);
  app.get('/tasks/search', { preHandler: authenticate }, controller.search);
  app.post('/tasks/bulk-status', { preHandler: authenticate }, controller.bulkStatus);
  app.get('/tasks/:id', { preHandler: authenticate }, controller.get);
  app.patch('/tasks/:id', { preHandler: authenticate }, controller.update);
  app.delete('/tasks/:id', { preHandler: authenticate }, controller.remove);
  app.post('/tasks/:taskId/assignments', { preHandler: authenticate }, controller.assign);
  app.delete('/tasks/:taskId/assignments/:userId', { preHandler: authenticate }, controller.unassign);
  app.get('/tasks/:taskId/comments', { preHandler: authenticate }, controller.listComments);
  app.post('/tasks/:taskId/comments', { preHandler: authenticate }, controller.addComment);
}
