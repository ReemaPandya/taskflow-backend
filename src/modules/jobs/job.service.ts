import { OutboxStatus } from '@prisma/client';
import { ApiError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { emailQueue } from '../../queues/email.queue';

function publicQueueStatus(state: string) {
  if (state === 'active') return 'active';
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  return 'pending';
}

function publicOutboxStatus(status: OutboxStatus) {
  if (status === OutboxStatus.completed) return 'completed';
  if (status === OutboxStatus.failed) return 'failed';
  return 'pending';
}

export async function getStatus(orgId: string, id: string) {
  const job = await emailQueue.getJob(id);
  if (job) {
    if (job.data?.orgId !== orgId) throw new ApiError(403, 'Forbidden', 'FORBIDDEN');
    const state = await job.getState();
    return {
      id: String(job.id),
      status: publicQueueStatus(state),
      name: job.name,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      failedReason: job.failedReason || null,
      metadata: {
        taskId: job.data.taskId,
        assignmentId: job.data.assignmentId,
        recipientEmail: job.data.recipientEmail
      },
      timestamps: {
        created: job.timestamp,
        processedOn: job.processedOn ?? null,
        finishedOn: job.finishedOn ?? null
      }
    };
  }

  const audit = await prisma.notificationOutbox.findUnique({ where: { jobId: id } });
  if (!audit) throw new ApiError(404, 'Job not found', 'JOB_NOT_FOUND');
  if (audit.orgId !== orgId) throw new ApiError(403, 'Forbidden', 'FORBIDDEN');
  const payload = audit.payload as Record<string, unknown>;
  return {
    id,
    status: publicOutboxStatus(audit.status),
    name: audit.type,
    attemptsMade: null,
    maxAttempts: 4,
    failedReason: audit.lastError,
    metadata: {
      taskId: payload.taskId ?? null,
      assignmentId: payload.assignmentId ?? null,
      recipientEmail: payload.recipientEmail ?? null
    },
    timestamps: {
      created: audit.createdAt.getTime(),
      processedOn: audit.enqueuedAt?.getTime() ?? null,
      finishedOn: (audit.completedAt ?? audit.failedAt)?.getTime() ?? null
    }
  };
}
