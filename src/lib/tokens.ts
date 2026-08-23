import crypto from 'node:crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { OrgRole } from '@prisma/client';
import { env } from '../config/env';

export type AccessClaims = { sub: string; orgId: string; role: OrgRole; type: 'access' };
export type RefreshClaims = { sub: string; orgId: string; type: 'refresh'; jti: string };

export function signAccessToken(userId: string, orgId: string, role: OrgRole) {
  return jwt.sign(
    { orgId, role, type: 'access' },
    env.JWT_ACCESS_SECRET,
    { subject: userId, expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'] }
  );
}

export function signRefreshToken(userId: string, orgId: string) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { orgId, type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { subject: userId, jwtid: jti, expiresIn: `${env.REFRESH_TOKEN_DAYS}d` as SignOptions['expiresIn'] }
  );
  return { token, jti };
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessClaims;
}

export function verifyRefreshToken(token: string): RefreshClaims {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshClaims;
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
