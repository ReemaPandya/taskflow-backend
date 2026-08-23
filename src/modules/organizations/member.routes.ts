import { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import * as controller from './member.controller';

export async function memberRoutes(app: FastifyInstance) {
  app.get('/organization/members', { preHandler: authenticate }, controller.list);
  app.post('/organization/members', { preHandler: authenticate }, controller.add);
  app.patch('/organization/members/:userId', { preHandler: authenticate }, controller.updateRole);
  app.delete('/organization/members/:userId', { preHandler: authenticate }, controller.remove);
}
