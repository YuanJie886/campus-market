import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export interface Sql {
  query(
    text: string,
    values?: any[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}
@Injectable()
export class Database implements OnModuleDestroy {
  private pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
  query(text: string, values?: any[]) {
    return this.pool.query(text, values);
  }
  async transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
export async function migrate(db: Pick<Database, "transaction">) {
  const sql = await readFile(
    resolve(__dirname, "../../../database/migrations/001_initial.sql"),
    "utf8",
  );
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(761023)");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await tx.query(
      "SELECT version FROM schema_migrations WHERE version=$1",
      ["001"],
    );
    if (!rows.length) {
      await tx.query(sql);
      await tx.query("INSERT INTO schema_migrations(version) VALUES ($1)", [
        "001",
      ]);
    }
  });
}
