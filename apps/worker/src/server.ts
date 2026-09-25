import Fastify, { type FastifyInstance, LogController } from "fastify";

export interface ServerDeps {
  /** Resolves if the database answers; rejects otherwise. */
  pingDatabase: () => Promise<void>;
  logLevel?: string;
}

/**
 * The HTTP surface. M0 has only the probes; the tools endpoint and webhooks join in M4.
 *
 * - `/healthz`: the process is up and serving. Fly restarts the machine if it fails.
 * - `/readyz`: the worker can do work, i.e. it can reach Postgres. Not used for restarts: a
 *   database outage shouldn't restart every worker.
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
