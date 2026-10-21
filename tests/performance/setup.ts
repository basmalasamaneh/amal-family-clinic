import { mkdir, rm } from 'node:fs/promises';
import { output } from './measure';

export default async function setup() {
  if (process.env.AMAL_BOOKING_DISPOSABLE !== '1' || process.env.AMAL_OFFLINE_E2E !== '1' ||
      process.env.AMAL_DEVELOPER_TOOLS !== '0' || process.env.NODE_ENV !== 'development' || !process.env.DATABASE_URL ||
      /^(1|true)$/i.test(process.env.REPLIT_DEPLOYMENT ?? '') || process.env.REPLIT_DEPLOYMENT_ID ||
      process.env.REPLIT_DEPLOYMENT_TYPE || process.env.REPLIT_DEPLOYMENT_URL) {
    throw new Error('Performance audit requires the disposable schema-only local development runner; deployment refused');
  }
  // Only this suite's ignored output. Prevent stale successful samples from making
  // an interrupted or failed rerun look complete. No server/build/process control.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
}
