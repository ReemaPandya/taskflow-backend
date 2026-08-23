import 'fastify';
import { OrgRole } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    auth: { userId: string; orgId: string; role: OrgRole };
  }
}
