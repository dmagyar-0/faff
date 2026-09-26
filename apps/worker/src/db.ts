import pg from "pg";

/** One pool per process. Closed last on shutdown, after the server has drained. */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 5,
    // Fail a probe fast rather than hang it until Fly's check times out.
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
    application_name: "faff-worker",
  });
}

export async function ping(pool: pg.Pool): Promise<void> {
  await pool.query("select 1");
}
