import bcrypt from 'bcrypt';
import { OrgRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../lib/errors';

export async function list(orgId: string) {
  return prisma.orgMember.findMany({
    where: { orgId },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: 'asc' }
  });
}

export async function add(orgId: string, input: { email: string; name?: string; password?: string; role: OrgRole }) {
  let user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user) {
    if (!input.name || !input.password) {
      throw new ApiError(400, 'name and password are required for a new user', 'VALIDATION_ERROR');
    }
    user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: await bcrypt.hash(input.password, 12)
      }
    });
  }
  const existing = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId: user.id } }
  });
  if (existing) throw new ApiError(409, 'User is already a member', 'MEMBERSHIP_EXISTS');
  return prisma.orgMember.create({ data: { orgId, userId: user.id, role: input.role } });
}

export async function updateRole(orgId: string, actorUserId: string, userId: string, role: OrgRole) {
  const member = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } }
  });
  if (!member) throw new ApiError(404, 'Member not found', 'MEMBER_NOT_FOUND');
  if (userId === actorUserId && role !== OrgRole.org_admin) {
    throw new ApiError(400, 'Admin cannot demote their own active membership', 'INVALID_OPERATION');
  }
  return prisma.orgMember.update({
    where: { orgId_userId: { orgId, userId } },
    data: { role }
  });
}

export async function remove(orgId: string, actorUserId: string, userId: string) {
  if (userId === actorUserId) {
    throw new ApiError(400, 'Admin cannot remove their own active membership', 'INVALID_OPERATION');
  }
  const result = await prisma.orgMember.deleteMany({ where: { orgId, userId } });
  if (!result.count) throw new ApiError(404, 'Member not found', 'MEMBER_NOT_FOUND');
}
