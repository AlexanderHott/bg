import * as v from "valibot";

const BooleanStringSchema = v.pipe(
  v.picklist(["true", "false"]),
  v.transform((value) => value === "true"),
);

const EnvServerSchema = v.object({
  DATABASE_URL: v.pipe(v.string(), v.url()),
  WEBAUTHN_RP_ID: v.string(),
  WEBAUTHN_ORIGIN: v.pipe(v.string(), v.url()),
  S3_INTERNAL_ENDPOINT: v.pipe(v.string(), v.url()),
  S3_PUBLIC_ENDPOINT: v.pipe(v.string(), v.url()),
  S3_REGION: v.string(),
  S3_BUCKET: v.string(),
  S3_ACCESS_KEY_ID: v.string(),
  S3_SECRET_ACCESS_KEY: v.string(),
  S3_FORCE_PATH_STYLE: BooleanStringSchema,
});

export const envServer = v.parse(EnvServerSchema, {
  DATABASE_URL: process.env.DATABASE_URL,
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
  WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN,
  S3_INTERNAL_ENDPOINT: process.env.S3_INTERNAL_ENDPOINT,
  S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
});
