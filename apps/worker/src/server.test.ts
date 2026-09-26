import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "./server";

let app: ReturnType<typeof buildServer> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /healthz", () => {
  it("answers 200 without touching the database", async () => {
    app = buildServer({
      pingDatabase: () => Promise.reject(new Error("must not be called")),
      logLevel: "silent",
    });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /readyz", () => {
  it("answers 200 when the database answers", async () => {
    app = buildServer({ pingDatabase: () => Promise.resolve(), logLevel: "silent" });
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("answers 503 when the database doesn't", async () => {
    app = buildServer({
      pingDatabase: () => Promise.reject(new Error("connection refused")),
      logLevel: "silent",
    });
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable", reason: "database" });
  });
});
