import { OutboxStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dedupeRedis } from '../../lib/dedupe-redis';
import { ApiError } from '../../lib/errors';
import { dispatchOutbox } from '../../queues/outbox.dispatcher';
import { validateAssignmentTenant } from './assignment.validation';

export type AssignmentResult = {
  assignment: { id: string; taskId: string; userId: string; assignedAt: Date };
  jobId: string;
  recovered: boolean;
};

export async function assign(orgId: string, taskId: string, userId: string, actorUserId: string): Promise<AssignmentResult> {
  const dedupeKey = `assignment:${taskId}:${userId}`;
  let dedupeAcquired = false;
  try {
    const acquired = await dedupeRedis.set(dedupeKey, '1', 'PX', 5000, 'NX');
    if (!acquired) throw new ApiError(409, 'Duplicate assignment request', 'ASSIGNMENT_DEDUPED');
    dedupeAcquired = true;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Assignment service temporarily unavailable', 'QUEUE_UNAVAILABLE');
  }

  let dbCommitted = false;
  try {
    const persisted = await prisma.$transaction(async tx => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: { project: true }
      });
      if (!task || task.deletedAt || task.project.deletedAt) {
        throw new ApiError(404, 'Task not found', 'TASK_NOT_FOUND');
      }

      const membership = await tx.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId } },
        include: { user: true }
      });
      validateAssignmentTenant(orgId, task.project.orgId, membership?.orgId);

      const existing = await tx.taskAssignment.findUnique({
        where: { taskId_userId: { taskId, userId } }
      });
      if (existing) {
        const existingOutbox = await tx.notificationOutbox.findUnique({ where: { assignmentId: existing.id } });
        if (existingOutbox?.status === OutboxStatus.pending) {
          return { assignment: existing, outboxId: existingOutbox.id, recovered: true };
        }
        throw new ApiError(409, 'User already assigned to task', 'ASSIGNMENT_EXISTS');
      }

      const assignment = await tx.taskAssignment.create({ data: { taskId, userId } });
      const payload: Prisma.InputJsonObject = {
        assignmentId: assignment.id,
        taskId,
        taskTitle: task.title,
        projectId: task.projectId,
        userId,
        recipientEmail: membership!.user.email,
        recipientName: membership!.user.name,
        actorUserId
      };
      const outbox = await tx.notificationOutbox.create({
        data: {
          orgId,
          assignmentId: assignment.id,
          type: 'task_assigned_email',
          payload
        }
      });
      return { assignment, outboxId: outbox.id, recovered: false };
    });

    dbCommitted = true;
    try {
      const jobId = await dispatchOutbox(persisted.outboxId);
      return { assignment: persisted.assignment, jobId, recovered: persisted.recovered };
    } catch {
      // The assignment and notification intent were committed atomically in PostgreSQL.
      // Returning a non-2xx response honors the requirement that successful responses
      // are sent only after BullMQ enqueue succeeds. The worker's outbox relay retries.
      throw new ApiError(
        503,
        'Assignment saved but notification enqueue is pending retry',
        'NOTIFICATION_ENQUEUE_PENDING',
        { retryable: true }
      );
    }
  } catch (error) {
    if (!dbCommitted && dedupeAcquired) await dedupeRedis.del(dedupeKey).catch(() => undefined);
    throw error;
  }
}

export async function unassign(orgId: string, taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task || task.deletedAt || task.project.deletedAt) throw new ApiError(404, 'Task not found', 'TASK_NOT_FOUND');
  if (task.project.orgId !== orgId) throw new ApiError(403, 'Forbidden', 'FORBIDDEN');
  const result = await prisma.taskAssignment.deleteMany({ where: { taskId, userId } });
  if (!result.count) throw new ApiError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
}
