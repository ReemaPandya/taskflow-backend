import IORedis from 'ioredis';
import { env } from '../config/env';

// Short-fail client used only for the optional 5-second assignment dedupe guard.
// BullMQ uses a separate connection with maxRetriesPerRequest=null as required.
export const dedupeRedis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  connectTimeout: 1000
});
