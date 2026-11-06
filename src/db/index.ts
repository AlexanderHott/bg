import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { envServer } from "../envServer";
import { relations } from "./relations";

export const db = drizzle(envServer.DATABASE_URL, { relations });

// A dropped idle connection emits this, and with no listener it would kill the whole process.
// The pool replaces the connection, and queries report their own failures.
db.$client.on("error", (error) => {
  console.error("Idle database connection failed", error.message);
});

if (process.env.NODE_ENV === "production") {
  await db.transaction(async (tx) => {
    // Web and worker can start together; only one may apply migrations at a time.
    await tx.execute(sql`select pg_advisory_xact_lock(25191)`);
    await migrate(tx, { migrationsFolder: "./drizzle" });
  });
}
