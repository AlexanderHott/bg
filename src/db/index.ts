import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { envServer } from "../envServer";
import { relations } from "./relations";

export const db = drizzle(envServer.DATABASE_URL, { relations });

await migrate(db, { migrationsFolder: "./drizzle" });
