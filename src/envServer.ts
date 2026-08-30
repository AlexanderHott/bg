import * as v from "valibot";

const EnvServerSchema = v.object({
  DATABASE_URL: v.pipe(v.string(), v.url()),
  WEBAUTHN_RP_ID: v.string(),
  WEBAUTHN_ORIGIN: v.pipe(v.string(), v.url()),
});

export const envServer = v.parse(EnvServerSchema, {
  DATABASE_URL: process.env.DATABASE_URL,
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
  WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN,
});
