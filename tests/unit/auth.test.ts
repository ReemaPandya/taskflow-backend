import { describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { OrgRole } from '@prisma/client';
import { signAccessToken, verifyAccessToken } from '../../src/lib/tokens';

describe('authentication primitives', () => {
  it('hashes passwords with bcrypt cost 12', async () => {
    const hash = await bcrypt.hash('Password123!', 12);
    expect(await bcrypt.compare('Password123!', hash)).toBe(true);
    expect(bcrypt.getRounds(hash)).toBe(12);
  });
  it('issues an access token with tenant context', () => {
    const token = signAccessToken('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', OrgRole.member);
    const claims = verifyAccessToken(token);
    expect(claims.orgId).toBe('22222222-2222-2222-2222-222222222222');
    expect(claims.role).toBe(OrgRole.member);
    expect(claims.type).toBe('access');
  });
});
