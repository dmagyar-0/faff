// The worker's entry point: `node dist/main.mjs` in the image, `pnpm dev` locally.
import { ConfigError, loadConfig } from "./config";
import { createPool, ping } from "./db";
import { buildServer } from "./server";
import { createShutdown, onSignals } from "./shutdown";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}

const pool = createPool(config.DATABASE_URL);
// An idle client losing its connection must not crash the process; the next query reconnects.
pool.on("error", (err) => app.log.warn({ err }, "idle database connection lost"));

const app = buildServer({ pingDatabase: () => ping(pool), logLevel: config.LOG_LEVEL });

const shutdown = createShutdown({
  // Order matters: stop HTTP first (in-flight requests may still use the pool), then the pool.
  steps: [
    { name: "http server", close: () => app.close() },
    { name: "database pool", close: () => pool.end() },
  ],
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  log: app.log,
  exit: (code) => process.exit(code),
});
onSignals(shutdown, process);

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, "could not start the HTTP server");
  await pool.end().catch(() => {});
  process.exit(1);
}
