import { attachDatabasePool } from "@neon/functions";
import { Pool, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("The Neon database connection is not configured");
}

// Neon Functions are long-lived. Reuse a small pg pool across requests.
export const pool = new Pool({ connectionString, max: 5 });
attachDatabasePool(pool);

export type DatabaseQuery = <T extends QueryResultRow>(
  text: string,
  values?: readonly unknown[],
) => Promise<T[]>;

export const query: DatabaseQuery = async <T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> => {
  const result = await pool.query<T>(text, [...values]);
  return result.rows;
};

export async function transaction<T>(work: (runQuery: DatabaseQuery) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const runQuery: DatabaseQuery = async <R extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<R[]> => {
    const result = await client.query<R>(text, [...values]);
    return result.rows;
  };
  try {
    await client.query("BEGIN");
    const result = await work(runQuery);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
