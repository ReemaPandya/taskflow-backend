import { PrismaClient, OrgRole, Priority, TaskStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  await prisma.refreshToken.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.notificationOutbox.deleteMany();
  await prisma.taskAssignment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.orgMember.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('Password123!', 12);
  const users = await Promise.all([
    ['admin@acme.test', 'Ava Admin'],
    ['dev@acme.test', 'Dev Member'],
    ['qa@acme.test', 'QA Member'],
    ['admin@globex.test', 'Grace Admin'],
    ['ops@globex.test', 'Ops Member']
  ].map(([email, name]) => prisma.user.create({ data: { email, name, passwordHash } })));

  const [acme, globex] = await Promise.all([
    prisma.organization.create({ data: { name: 'Acme Labs' } }),
    prisma.organization.create({ data: { name: 'Globex Systems' } })
  ]);

  await prisma.orgMember.createMany({ data: [
    { orgId: acme.id, userId: users[0].id, role: OrgRole.org_admin },
    { orgId: acme.id, userId: users[1].id, role: OrgRole.member },
    { orgId: acme.id, userId: users[2].id, role: OrgRole.member },
    { orgId: globex.id, userId: users[3].id, role: OrgRole.org_admin },
    { orgId: globex.id, userId: users[4].id, role: OrgRole.member }
  ]});

  const [apiProject, webProject, opsProject] = await Promise.all([
    prisma.project.create({ data: { orgId: acme.id, name: 'TaskFlow API', description: 'Backend delivery' } }),
    prisma.project.create({ data: { orgId: acme.id, name: 'TaskFlow Web', description: 'Frontend client' } }),
    prisma.project.create({ data: { orgId: globex.id, name: 'Ops Automation', description: 'Internal tooling' } })
  ]);

  const statuses = [TaskStatus.todo, TaskStatus.in_progress, TaskStatus.review, TaskStatus.done];
  const priorities = [Priority.low, Priority.medium, Priority.high, Priority.urgent];
  const taskRows = [] as { projectId: string; title: string; description: string; status: TaskStatus; priority: Priority; dueDate: Date }[];
  for (let i = 0; i < 12; i++) {
    taskRows.push({
      projectId: i < 5 ? apiProject.id : i < 8 ? webProject.id : opsProject.id,
      title: `Seed task ${i + 1}`,
      description: `Sample seeded task number ${i + 1}`,
      status: statuses[i % statuses.length],
      priority: priorities[i % priorities.length],
      dueDate: new Date(Date.now() + (i + 1) * 86400000)
    });
  }
  const tasks = [];
  for (const row of taskRows) tasks.push(await prisma.task.create({ data: row }));

  await prisma.taskAssignment.createMany({ data: [
    { taskId: tasks[0].id, userId: users[1].id },
    { taskId: tasks[1].id, userId: users[2].id },
    { taskId: tasks[8].id, userId: users[4].id }
  ]});
  await prisma.comment.createMany({ data: [
    { taskId: tasks[0].id, authorId: users[0].id, body: 'Please prioritize this task.' },
    { taskId: tasks[1].id, authorId: users[1].id, body: 'Implementation is ready for review.' },
    { taskId: tasks[8].id, authorId: users[3].id, body: 'Ops validation complete.' }
  ]});

  console.log('Seed complete');
  console.log('Acme admin: admin@acme.test / Password123!');
  console.log('Globex admin: admin@globex.test / Password123!');
}

main().finally(() => prisma.$disconnect());
