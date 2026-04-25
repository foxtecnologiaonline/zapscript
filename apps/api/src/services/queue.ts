import { Queue } from 'bullmq';
import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const transcriptionQueue = new Queue('transcriptions', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 200,
    removeOnFail: 100,
  },
});
