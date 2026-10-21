import app from "./app";
import { logger } from "./lib/logger";
import { startReminderWorker } from "./reminders/dispatcher";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
// Bound incomplete/slow requests and aggregate request headers at the HTTP edge.
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.maxHeadersCount = 64;
server.keepAliveTimeout = 5_000;
const stopReminderWorker = startReminderWorker();
server.on("close", stopReminderWorker);
