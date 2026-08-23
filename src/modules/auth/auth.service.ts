import bcrypt from 'bcrypt';
import { OrgRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../lib/errors';
import { env } from '../../config/env';
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/tokens';

async function persistRefreshToken(userId: string, orgId: string, token: string) {
  await prisma.refreshToken.create({
    data: {
      userId,
      orgId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400000)
    }
  });
}

async function issuePair(userId: string, orgId: string, role: OrgRole) {
  const accessToken = signAccessToken(userId, orgId, role);
  const { token: refreshToken } = signRefreshToken(userId, orgId);
  await persistRefreshToken(userId, orgId, refreshToken);
  return { accessToken, refreshToken, expiresIn: 900 };
}

export async function register(input: { email: string; name: string; password: string; organizationName: string }) {
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new ApiError(409, 'Email already registered', 'EMAIL_EXISTS');
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { email, name: input.name, passwordHash } });
    const org = await tx.organization.create({ data: { name: input.organizationName } });
    await tx.orgMember.create({ data: { orgId: org.id, userId: user.id, role: OrgRole.org_admin } });
    return { user, org };
  });
  return { user: { id: result.user.id, email: result.user.email, name: result.user.name }, organization: result.org,
    tokens: await issuePair(result.user.id, result.org.id, OrgRole.org_admin) };
}

export async function login(input: { email: string; password: string; organizationId?: string }) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { memberships: { include: { org: true }, orderBy: { createdAt: 'asc' } } }
  });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }
  const membership = input.organizationId
    ? user.memberships.find(m => m.orgId === input.organizationId)
    : user.memberships[0];
  if (!membership) throw new ApiError(403, 'User is not a member of that organization', 'FORBIDDEN');
  return {
    user: { id: user.id, email: user.email, name: user.name },
    organization: membership.org,
    role: membership.role,
    tokens: await issuePair(user.id, membership.orgId, membership.role)
  };
}

export async function refresh(refreshToken: string) {
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }
  if (claims.type !== 'refresh' || !claims.sub || !claims.orgId) {
    throw new ApiError(401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  const tokenHash = hashToken(refreshToken);
  return prisma.$transaction(async tx => {
    const stored = await tx.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      throw new ApiError(401, 'Refresh token revoked or expired', 'INVALID_REFRESH_TOKEN');
    }

    const membership = await tx.orgMember.findUnique({
      where: { orgId_userId: { orgId: claims.orgId, userId: claims.sub } }
    });
    if (!membership) throw new ApiError(403, 'Forbidden', 'FORBIDDEN');

    // updateMany with revokedAt=null makes concurrent refresh replay single-use.
    const revoked = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (revoked.count !== 1) {
      throw new ApiError(401, 'Refresh token already used', 'INVALID_REFRESH_TOKEN');
    }

    const accessToken = signAccessToken(claims.sub, claims.orgId, membership.role);
    const { token: nextRefreshToken } = signRefreshToken(claims.sub, claims.orgId);
    await tx.refreshToken.create({
      data: {
        userId: claims.sub,
        orgId: claims.orgId,
        tokenHash: hashToken(nextRefreshToken),
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400000)
      }
    });
    return { accessToken, refreshToken: nextRefreshToken, expiresIn: 900 };
  });
}

export async function logout(refreshToken: string) {
  await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function logoutAll(userId: string, orgId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, orgId, revokedAt: null }, data: { revokedAt: new Date() } });
}
