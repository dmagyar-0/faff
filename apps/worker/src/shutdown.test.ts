import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { createShutdown, onSignals, type ShutdownStep } from "./shutdown";

const log = { info: () => {}, error: () => {} };

describe("createShutdown", () => {
  it("closes each step in order, then exits 0", async () => {
    const calls: string[] = [];
    const step = (name: string): ShutdownStep => ({
      name,
      close: async () => {
        calls.push(name);
      },
    });
    const exit = vi.fn((code: number) => calls.push(`exit ${code}`));

    await createShutdown({ steps: [step("server"), step("pool")], timeoutMs: 1000, log, exit })(
      "SIGTERM",
    );

    expect(calls).toEqual(["server", "pool", "exit 0"]);
  });

  it("waits for a step to finish before starting the next", async () => {
    const calls: string[] = [];
    let release!: () => void;
    const server: ShutdownStep = {
      name: "server",
      close: () => new Promise<void>((resolve) => (release = resolve)),
    };
    const pool: ShutdownStep = { name: "pool", close: async () => void calls.push("pool") };
    const done = createShutdown({ steps: [server, pool], timeoutMs: 1000, log, exit: () => {} })(
      "SIGTERM",
    );

    await Promise.resolve();
    expect(calls).toEqual([]);
    release();
    await done;
    expect(calls).toEqual(["pool"]);
  });

  it("still closes later steps if one fails, and exits 1", async () => {
    const closed: string[] = [];
    const exit = vi.fn();
    await createShutdown({
      steps: [
        { name: "server", close: () => Promise.reject(new Error("boom")) },
        { name: "pool", close: async () => void closed.push("pool") },
      ],
      timeoutMs: 1000,
      log,
      exit,
    })("SIGTERM");

    expect(closed).toEqual(["pool"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("runs once however many signals arrive", async () => {
    const close = vi.fn(async () => {});
    const exit = vi.fn();
    const shutdown = createShutdown({ steps: [{ name: "x", close }], timeoutMs: 1000, log, exit });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT"), shutdown("SIGTERM")]);

    expect(close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("exits 1 if draining outlasts the timeout", async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      void createShutdown({
        steps: [{ name: "stuck", close: () => new Promise<void>(() => {}) }],
        timeoutMs: 500,
        log,
        exit,
      })("SIGTERM");

      await vi.advanceTimersByTimeAsync(499);
      expect(exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("onSignals", () => {
  it("shuts down on SIGTERM and on SIGINT", () => {
    for (const signal of ["SIGTERM", "SIGINT"]) {
      const target = new EventEmitter();
      const shutdown = vi.fn();
      onSignals(shutdown, target as unknown as NodeJS.Process);
      target.emit(signal);
      expect(shutdown).toHaveBeenCalledExactlyOnceWith(signal);
    }
  });
});
