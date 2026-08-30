import "dotenv/config";
import { defineConfig } from "drizzle-kit";

import { envServer } from "./src/envServer";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: envServer.DATABASE_URL,
  },
});
