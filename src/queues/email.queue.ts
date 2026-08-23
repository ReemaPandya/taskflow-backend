import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export const EMAIL_QUEUE = 'taskflow-email';
export const DEAD_LETTER_QUEUE = 'taskflow-email-dlq';

export const emailQueue = new Queue(EMAIL_QUEUE, { connection: redis });
export const deadLetterQueue = new Queue(DEAD_LETTER_QUEUE, { connection: redis });
