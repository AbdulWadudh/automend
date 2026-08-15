import { config } from "@automend/shared";
import { Worker } from "bullmq";
import { env, serviceConfig } from "./config";
import { createWorkerDependencies } from "./dependencies";
import { startHealthServer } from "./health-server";
import { createFlowExecutionProcessor } from "./processor";

const queueName = config.queue.flowExecutions.name;

const deps = createWorkerDependencies();

const worker = new Worker(queueName, createFlowExecutionProcessor(deps.logger), {
  connection: deps.redis,
  concurrency: env.WORKER_CONCURRENCY,
});

worker.on("completed", (job) => {
  deps.logger.info({ jobId: job.id, queue: queueName }, "job completed");
});

worker.on("failed", (job, error) => {
  deps.logger.error({ jobId: job?.id, queue: queueName, err: error }, "job failed");
});

// Worker-level errors (connection problems, internal BullMQ failures) are not job failures.
// They must be observed, otherwise Node terminates the process on the unhandled event.
worker.on("error", (error) => {
  deps.logger.error({ err: error }, "worker error");
});

const healthServer = startHealthServer(deps);

deps.logger.info(
  {
    service: serviceConfig.name,
    queue: queueName,
    concurrency: env.WORKER_CONCURRENCY,
    healthPort: healthServer.port,
    nodeEnv: env.NODE_ENV,
  },
  "worker listening for jobs",
);

/**
 * `worker.close()` stops the worker picking up new jobs and waits for the in-flight ones to
 * settle, so a deploy does not leave half-executed flows behind.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  deps.logger.info({ signal }, "shutting down worker");

  try {
    await healthServer.stop();
    await worker.close();
    await deps.closeClients();
    process.exit(0);
  } catch (error) {
    deps.logger.error({ err: error }, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
