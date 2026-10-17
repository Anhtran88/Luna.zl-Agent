import type { Pool } from "pg";
import type { QueryPort, TransactionPort } from "./atomic-store.ts";

/** Each transaction reserves one connection; never use pool.query for BEGIN/work/COMMIT. */
export function postgresPort(pool: Pool): TransactionPort {
  return {
    async query<T>(text: string, values?: unknown[]) {
      return { rows: (await pool.query(text, values)).rows as T[] };
    },
    async transaction<T>(work: (tx: QueryPort) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '15s'");
        const result = await work({
          async query<R>(text: string, values?: unknown[]) {
            return { rows: (await client.query(text, values)).rows as R[] };
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* Preserve the original uncertain-commit error. */
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
