// Runs against a real Postgres: the local Supabase stack (`pnpm db:start`), in the CI `db` job.
// Excluded from `pnpm test`; run it with `pnpm --filter @faff/worker test:db`.
import { afterAll, describe, expect, it } from "vitest";

import { loadConfig } from "./config";
import { createPool, ping } from "./db";
import { buildServer } from "./server";

const { DATABASE_URL } = loadConfig(process.env);

describe("GET /readyz against Postgres", () => {
  const pools: ReturnType<typeof createPool>[] = [];
  afterAll(() => Promise.all(pools.map((p) => p.end())));

  async function readyz(connectionString: string) {
    const pool = createPool(connectionString);
    pools.push(pool);
    const app = buildServer({ pingDatabase: () => ping(pool), logLevel: "silent" });
    try {
      return await app.inject({ method: "GET", url: "/readyz" });
    } finally {
      await app.close();
    }
  }

  it("is ready when the database accepts the worker's credentials", async () => {
    const res = await readyz(DATABASE_URL);
    expect(res.statusCode).toBe(200);
  });

  it("is not ready when the credentials are wrong", async () => {
    const url = new URL(DATABASE_URL);
    url.password = "wrong-password";
    const res = await readyz(url.toString());
    expect(res.statusCode).toBe(503);
  });

  it("is not ready when nothing is listening", async () => {
    const url = new URL(DATABASE_URL);
    url.port = "1";
    const res = await readyz(url.toString());
    expect(res.statusCode).toBe(503);
  });
});
