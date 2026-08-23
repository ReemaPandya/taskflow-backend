import { OutboxStatus } from '@prisma/client';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { DEAD_LETTER_QUEUE, EMAIL_QUEUE, deadLetterQueue, emailQueue } from '../queues/email.queue';
import { dispatchPendingOutbox } from '../queues/outbox.dispatcher';

const workerConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(EMAIL_QUEUE, async job => {
  // The outbox row proves the assignment event committed in PostgreSQL before enqueue.
  const outbox = await prisma.notificationOutbox.findUnique({ where: { id: job.data.outboxId } });
  if (!outbox || outbox.orgId !== job.data.orgId) {
    throw new Error('Notification outbox record is missing or invalid');
  }

  // Mock email sender. Addresses containing "+fail" deliberately fail to demonstrate retries/DLQ.
  if (String(job.data.recipientEmail).includes('+fail')) {
    throw new Error('Simulated email provider failure');
  }

  console.log(`[email] To: ${job.data.recipientEmail} | Assigned: ${job.data.taskTitle}`);
  return { sent: true, provider: 'mock', sentAt: new Date().toISOString() };
}, {
  connection: workerConnection,
  concurrency: 10,
  limiter: { max: 50, duration: 60_000 }
});

async function handleCompleted(job: { id?: string | number; data: Record<string, unknown> }) {
  await prisma.notificationOutbox.updateMany({
    where: { id: String(job.data.outboxId) },
    data: { status: OutboxStatus.completed, jobId: String(job.id), completedAt: new Date(), lastError: null }
  });
  console.log(`[worker] completed ${job.id}`);
}

async function handleFinalFailure(job: any, error: Error) {
  if (!job) return;
  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < maxAttempts) return;

  await deadLetterQueue.add(DEAD_LETTER_QUEUE, {
    originalJobId: job.id,
    originalName: job.name,
    orgId: job.data.orgId,
    outboxId: job.data.outboxId,
    data: job.data,
    failedReason: error.message,
    failedAt: new Date().toISOString()
  }, { removeOnComplete: false, removeOnFail: false });

  await prisma.notificationOutbox.updateMany({
    where: { id: job.data.outboxId },
    data: {
      status: OutboxStatus.failed,
      jobId: String(job.id),
      failedAt: new Date(),
      lastError: error.message.slice(0, 2000)
    }
  });

  console.error(`[worker] dead-lettered exhausted job ${job.id}`);
}

worker.on('completed', job => {
  void handleCompleted(job as any).catch(error => console.error('[worker] completed-event persistence failed', error));
});

worker.on('failed', (job, error) => {
  void handleFinalFailure(job, error).catch(handlerError => console.error('[worker] failed-event handler failed', handlerError));
});

let relayRunning = false;
async function relayOutbox() {
  if (relayRunning) return;
  relayRunning = true;
  try {
    const result = await dispatchPendingOutbox(50);
    if (result.attempted > 0) console.log(`[outbox] attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed}`);
  } catch (error) {
    console.error('[outbox] relay error', error);
  } finally {
    relayRunning = false;
  }
}

const relayTimer = setInterval(relayOutbox, 5000);
void relayOutbox();

async function shutdown() {
  clearInterval(relayTimer);
  await worker.close();
  await emailQueue.close();
  await deadLetterQueue.close();
  await workerConnection.quit();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(`[worker] listening on ${EMAIL_QUEUE}`);
