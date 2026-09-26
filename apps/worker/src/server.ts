import Fastify, { type FastifyInstance, LogController } from "fastify";

export interface ServerDeps {
  /** Resolves if the database answers; rejects otherwise. */
  pingDatabase: () => Promise<void>;
  logLevel?: string;
}

/**
 * The HTTP surface. M0 has only the probes; the tools endpoint and webhooks join in M4.
 *
 * - `/healthz`: the process is up and serving. Fly's service check uses it for routing only: a
 *   failing check takes the machine out of routing but never restarts it.
 * - `/readyz`: the worker can do work, i.e. it can reach Postgres. Kept out of the service check
 *   so a database blip doesn't pull the only machine out of routing.
 *
 * Liveness is the process's own job: Fly restarts a machine only when its process exits. M4's
 * runner holds leases, so it needs a watchdog that exits when the event loop stops making
 * progress (see apps/worker/fly.toml).
 */
export function buildServer({ pingDatabase, logLevel = "info" }: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: logLevel },
    // Probes are frequent and uninteresting; keep them out of the request log.
    logController: new LogController({
      disableRequestLogging: (req) => req.url === "/healthz" || req.url === "/readyz",
    }),
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (req, reply) => {
    try {
      await pingDatabase();
      return { status: "ok" };
    } catch (error) {
      req.log.warn({ err: error }, "readiness check failed: database unreachable");
      return reply.code(503).send({ status: "unavailable", reason: "database" });
    }
  });

  return app;
}
