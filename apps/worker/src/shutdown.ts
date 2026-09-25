/**
 * Graceful shutdown. On SIGTERM (or SIGINT) the worker stops taking new work, lets in-flight
 * work finish, then releases what it holds, in order. From M4 the runner holds task leases, and
 * releasing them here is what lets another worker pick a task up at once instead of waiting for
 * the lease to expire. Register those as `steps`, in the order they must run.
 */
export interface ShutdownStep {
  name: string;
  close: () => Promise<void>;
}

export interface ShutdownOptions {
  steps: readonly ShutdownStep[];
  timeoutMs: number;
  log: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void };
  exit: (code: number) => void;
}

/** Runs the steps once, in order. Exits 0 if they all finish in time, 1 otherwise. */
export function createShutdown({ steps, timeoutMs, log, exit }: ShutdownOptions) {
  let started: Promise<void> | undefined;

  return function shutdown(reason: string): Promise<void> {
    started ??= (async () => {
      log.info(`shutting down (${reason})`);
      const timer = setTimeout(() => {
        log.error({ timeoutMs }, "shutdown timed out; exiting anyway");
        exit(1);
      }, timeoutMs);
      timer.unref();

      let code = 0;
      for (const step of steps) {
        try {
          await step.close();
          log.info(`closed ${step.name}`);
        } catch (error) {
          code = 1;
          log.error({ err: error }, `failed to close ${step.name}`);
        }
      }
      clearTimeout(timer);
      exit(code);
    })();
    return started;
  };
}

export function onSignals(
  shutdown: (reason: string) => unknown,
  target: Pick<NodeJS.Process, "once">,
) {
  // Fly sends SIGINT by default; fly.toml sets SIGTERM, but handle both.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    target.once(signal, () => void shutdown(signal));
  }
}
