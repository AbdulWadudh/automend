/**
 * The health probe the container platform runs, for the api and the worker alike.
 *
 * It is a file rather than a `bun --eval` one-liner in each Dockerfile because a failing probe has
 * to say what it saw. Docker keeps the output of the last few health commands in
 * `State.Health.Log`, and that is the only place a platform like Coolify can show *why* a
 * container never became healthy — without it a deploy fails with "container api is unhealthy" and
 * nothing else, three steps removed from whichever dependency was actually down.
 */

import { config } from "../src/config";

const probes = {
  [config.services.api.name]: {
    portVariable: "API_PORT",
    defaultPort: config.services.api.defaultPort,
  },
  [config.services.worker.name]: {
    portVariable: "WORKER_HEALTH_PORT",
    defaultPort: config.services.worker.defaultHealthPort,
  },
} as const;

const serviceName = process.argv[2] ?? "";
const probe = probes[serviceName];

if (!probe) {
  console.log(`health-probe: unknown service "${serviceName}", expected one of ${Object.keys(probes).join(", ")}`);
  process.exit(1);
}

const port = process.env[probe.portVariable] ?? probe.defaultPort;
const url = `http://127.0.0.1:${port}${config.http.routes.health}`;

try {
  const response = await fetch(url);

  if (response.ok) {
    process.exit(0);
  }

  console.log(`health-probe: ${url} answered ${response.status} ${await response.text()}`);
  process.exit(1);
} catch (error) {
  // The usual cause is that the process exited during startup, so nothing is listening at all.
  console.log(`health-probe: ${url} is not answering — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
