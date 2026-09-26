import { z } from "zod";

/**
 * The worker's environment, parsed once at boot. A missing or malformed variable stops the
 * process before it listens, with a message naming the variable, rather than failing on the
 * first request that needs it. Names and meanings are documented in apps/worker/.env.example.
 */
const schema = z.object({
  /**
   * Postgres connection string for the worker's server-side role, which bypasses RLS like the
   * service-role key does. Hosted: the Supavisor session-pooler string. Never exposed to web.
   * M0 uses the `postgres` user; M2 replaces it with a least-privilege worker role.
   */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** How long SIGTERM may take to drain before the process exits anyway. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  // Treat an empty string as unset, so `DATABASE_URL=` in a .env file reads as "missing".
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(present);
  if (parsed.success) return parsed.data;

  const lines = parsed.error.issues.map((issue) => {
    const key = issue.path.join(".");
    // Never echo the value: DATABASE_URL carries a password.
    return present[key] === undefined ? `  ${key}: missing` : `  ${key}: ${issue.message}`;
  });
  throw new ConfigError(
    `Invalid worker configuration:\n${lines.join("\n")}\nSee apps/worker/.env.example.`,
  );
}
