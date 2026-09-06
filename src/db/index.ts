import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { envServer } from "../envServer";
import { relations } from "./relations";

export const db = drizzle(envServer.DATABASE_URL, { relations });

if (process.env.NODE_ENV === "production") {
  await db.transaction(async (tx) => {
    // Web and worker can start together; only one may apply migrations at a time.
    await tx.execute(sql`select pg_advisory_xact_lock(25191)`);
    await migrate(tx, { migrationsFolder: "./drizzle" });
  });
}
