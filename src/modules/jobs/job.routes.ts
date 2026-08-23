import { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import * as controller from './job.controller';

export async function jobRoutes(app: FastifyInstance) {
  app.get('/jobs/:id', { preHandler: authenticate }, controller.getStatus);
}
