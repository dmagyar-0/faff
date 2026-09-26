import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./config";

const DATABASE_URL = "postgresql://postgres:secret-password@127.0.0.1:54322/postgres";

describe("loadConfig", () => {
  it("applies defaults when only DATABASE_URL is set", () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      DATABASE_URL,
      HOST: "0.0.0.0",
      PORT: 8080,
      LOG_LEVEL: "info",
      SHUTDOWN_TIMEOUT_MS: 10_000,
    });
  });

  it("coerces numeric variables", () => {
    const config = loadConfig({ DATABASE_URL, PORT: "3001", SHUTDOWN_TIMEOUT_MS: "500" });
    expect(config.PORT).toBe(3001);
    expect(config.SHUTDOWN_TIMEOUT_MS).toBe(500);
  });

  it("names a missing variable", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL: missing/);
  });

  it("treats an empty string as missing", () => {
    expect(() => loadConfig({ DATABASE_URL: "" })).toThrow(/DATABASE_URL: missing/);
  });

  it("rejects a URL that isn't Postgres", () => {
    expect(() => loadConfig({ DATABASE_URL: "https://example.com" })).toThrow(/DATABASE_URL: /);
  });

  it("reports every bad variable at once", () => {
    const error = catchError(() => loadConfig({ PORT: "99999", LOG_LEVEL: "loud" }));
    expect(error.message).toMatch(/DATABASE_URL: missing/);
    expect(error.message).toMatch(/PORT: /);
    expect(error.message).toMatch(/LOG_LEVEL: /);
  });

  it("never echoes a value, which could be a password", () => {
    const error = catchError(() => loadConfig({ DATABASE_URL, PORT: "not-a-port" }));
    expect(error.message).not.toContain("secret-password");
    expect(error.message).not.toContain("not-a-port");
  });
});

function catchError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected a throw");
}
