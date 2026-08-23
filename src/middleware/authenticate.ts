import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';

export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'Authentication required', 'UNAUTHORIZED');

  try {
    const claims = verifyAccessToken(header.slice(7));
    if (claims.type !== 'access' || !claims.sub || !claims.orgId) throw new Error('Invalid token');
    const membership = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: claims.orgId, userId: claims.sub } }
    });
    if (!membership) throw new ApiError(403, 'Forbidden', 'FORBIDDEN');
    request.auth = { userId: claims.sub, orgId: claims.orgId, role: membership.role };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'Invalid or expired access token', 'INVALID_TOKEN');
  }
}

export function requireAdmin(request: FastifyRequest) {
  if (request.auth.role !== 'org_admin') throw new ApiError(403, 'Admin role required', 'FORBIDDEN');
}
