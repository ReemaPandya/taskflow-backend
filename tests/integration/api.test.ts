import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { OrgRole } from '@prisma/client';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { redis } from '../../src/lib/redis';

let app: Awaited<ReturnType<typeof buildApp>>;

async function clean() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "refresh_tokens", "notification_outbox", "comments", "task_assignments", "tasks", "projects", "org_members", "organizations", "users" CASCADE');
  await redis.flushdb();
}

async function fixture() {
  const hash = await bcrypt.hash('Password123!', 12);
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { email: 'a@test.dev', name: 'A', passwordHash: hash } }),
    prisma.user.create({ data: { email: 'b@test.dev', name: 'B', passwordHash: hash } })
  ]);
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({ data: { name: 'Org A' } }),
    prisma.organization.create({ data: { name: 'Org B' } })
  ]);
  await prisma.orgMember.createMany({ data: [
    { orgId: orgA.id, userId: a.id, role: OrgRole.org_admin },
    { orgId: orgB.id, userId: b.id, role: OrgRole.org_admin }
  ]});
  const foreignProject = await prisma.project.create({ data: { orgId: orgB.id, name: 'Secret' } });
  return { a, b, orgA, orgB, foreignProject };
}

beforeAll(async () => { app = await buildApp(); await app.ready(); });
beforeEach(clean);
afterAll(async () => { await clean(); await app.close(); });

describe('integration API', () => {
  it('login flow returns access and refresh tokens', async () => {
    const f = await fixture();
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: f.a.email, password: 'Password123!', organizationId: f.orgA.id } });
    expect(res.statusCode).toBe(200);
    expect(res.json().tokens.accessToken).toBeTruthy();
    expect(res.json().tokens.refreshToken).toBeTruthy();
  });

  it('supports task CRUD and validation errors', async () => {
    const f = await fixture();
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: f.a.email, password: 'Password123!', organizationId: f.orgA.id } });
    const token = login.json().tokens.accessToken;
    const project = await app.inject({ method: 'POST', url: '/projects', headers: { authorization: `Bearer ${token}` }, payload: { name: 'API' } });
    const projectId = project.json().id;
    const bad = await app.inject({ method: 'POST', url: `/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${token}` }, payload: { title: '' } });
    expect(bad.statusCode).toBe(400);
    const created = await app.inject({ method: 'POST', url: `/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${token}` }, payload: { title: 'Build endpoint', priority: 'high' } });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id;
    const fetched = await app.inject({ method: 'GET', url: `/tasks/${taskId}`, headers: { authorization: `Bearer ${token}` } });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().title).toBe('Build endpoint');
    expect((await app.inject({ method: 'PATCH', url: `/tasks/${taskId}`, headers: { authorization: `Bearer ${token}` }, payload: { status: 'in_progress' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/tasks/${taskId}`, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/tasks/${taskId}`, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
  });

  it('returns 403 for cross-tenant project access', async () => {
    const f = await fixture();
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: f.a.email, password: 'Password123!', organizationId: f.orgA.id } });
    const res = await app.inject({ method: 'GET', url: `/projects/${f.foreignProject.id}`, headers: { authorization: `Bearer ${login.json().tokens.accessToken}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('task assignment creates a BullMQ job', async () => {
    const f = await fixture();
    const member = await prisma.user.create({ data: { email: 'member@test.dev', name: 'Member', passwordHash: await bcrypt.hash('Password123!', 12) } });
    await prisma.orgMember.create({ data: { orgId: f.orgA.id, userId: member.id, role: OrgRole.member } });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: f.a.email, password: 'Password123!', organizationId: f.orgA.id } });
    const token = login.json().tokens.accessToken;
    const p = await prisma.project.create({ data: { orgId: f.orgA.id, name: 'Queue test' } });
    const t = await prisma.task.create({ data: { projectId: p.id, title: 'Notify assignee' } });
    const res = await app.inject({ method: 'POST', url: `/tasks/${t.id}/assignments`, headers: { authorization: `Bearer ${token}` }, payload: { userId: member.id } });
    expect(res.statusCode).toBe(201);
    expect(res.json().jobId).toMatch(/^notification-/);
  });
});
