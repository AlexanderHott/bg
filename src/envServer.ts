import * as v from "valibot"

const EnvServerSchema = v.object({
  DATABASE_URL: v.pipe(v.string(), v.url()),
});

export const envServer = v.parse(EnvServerSchema, process.env)