import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/errors';
import * as service from './job.service';

const idParam = z.object({ id: z.string().min(1).max(200) });

export async function getStatus(request: FastifyRequest) {
  const { id } = parseOrThrow(idParam, request.params);
  return service.getStatus(request.auth.orgId, id);
}
