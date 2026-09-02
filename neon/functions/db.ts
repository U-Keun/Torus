import { attachDatabasePool } from "@neon/functions";
import { Pool, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("The Neon database connection is not configured");
}

// Neon Functions are long-lived. Reuse a small pg pool across requests.
export const pool = new Pool({ connectionString, max: 5 });
attachDatabasePool(pool);

export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, [...values]);
  return result.rows;
}
