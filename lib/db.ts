import { Pool } from "pg";

// Single shared pool across hot-reloads in dev (Next re-imports modules).
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export const pool: Pool =
  global.__pgPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/risk",
    max: 5,
    // Fail fast if the DB is unreachable (e.g. a serverless deploy with no DATABASE_URL
    // pointing at a real host) instead of hanging the request until the platform
    // kills the function. Tool handlers catch this and return a clean error.
    connectionTimeoutMillis: 6000,
    idleTimeoutMillis: 10000,
  });

if (process.env.NODE_ENV !== "production") {
  global.__pgPool = pool;
}

export async function query<T = any>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
