import { OutboxStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { emailQueue } from './email.queue';

export async function dispatchOutbox(outboxId: string) {
  const outbox = await prisma.notificationOutbox.findUnique({ where: { id: outboxId } });
  if (!outbox) throw new Error(`Outbox record ${outboxId} not found`);

  if (outbox.status !== OutboxStatus.pending && outbox.jobId) {
    return outbox.jobId;
  }

  const jobId = `notification-${outbox.id}`;
  const payload = outbox.payload as Record<string, unknown>;

  try {
    const job = await emailQueue.add('task-assigned', {
      ...payload,
      outboxId: outbox.id,
      orgId: outbox.orgId
    }, {
      jobId,
      attempts: 4,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: false
    });

    await prisma.notificationOutbox.updateMany({
      where: { id: outbox.id, status: OutboxStatus.pending },
      data: {
        status: OutboxStatus.enqueued,
        jobId: String(job.id),
        enqueuedAt: new Date(),
        lastError: null
      }
    });
    return String(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown enqueue failure';
    await prisma.notificationOutbox.updateMany({
      where: { id: outbox.id, status: OutboxStatus.pending },
      data: { lastError: message.slice(0, 2000) }
    }).catch(() => undefined);
    throw error;
  }
}

export async function dispatchPendingOutbox(limit = 50) {
  const rows = await prisma.notificationOutbox.findMany({
    where: { status: OutboxStatus.pending },
    orderBy: { createdAt: 'asc' },
    take: limit
  });

  const results = await Promise.allSettled(rows.map(row => dispatchOutbox(row.id)));
  return {
    attempted: rows.length,
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length
  };
}
