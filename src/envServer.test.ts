import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { expect, test } from "vite-plus/test";

const fixture = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  WEBAUTHN_RP_ID: "localhost",
  WEBAUTHN_ORIGIN: "http://localhost:3000",
  S3_INTERNAL_ENDPOINT: "http://localhost:9000",
  S3_PUBLIC_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "test-files",
  S3_ACCESS_KEY_ID: "test-access",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_FORCE_PATH_STYLE: "true",
};

test("loads .env before validation when imported without the database module", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bg-env-test-"));
  try {
    await writeFile(
      join(directory, ".env"),
      Object.entries(fixture)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    const moduleUrl = pathToFileURL(resolve("src/envServer.ts")).href;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "--eval",
        `const { envServer } = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(envServer));`,
      ],
      { cwd: directory, env: { PATH: process.env.PATH, S3_REGION: "region-from-shell" } },
    );
    expect(JSON.parse(stdout)).toEqual({
      ...fixture,
      S3_REGION: "region-from-shell",
      S3_FORCE_PATH_STYLE: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("media worker loads .env before checking its executables", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bg-worker-env-test-"));
  try {
    await writeFile(
      join(directory, ".env"),
      Object.entries({
        ...fixture,
        MEDIA_SCRATCH_PATH: join(directory, "scratch"),
        YT_DLP_PATH: join(directory, "deliberately-missing-executable"),
      })
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    const moduleUrl = pathToFileURL(resolve("src/mediaWorker.ts")).href;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "--eval",
        `try { await import(${JSON.stringify(moduleUrl)}); } catch (error) { console.log(error.code ?? error.name); }`,
      ],
      {
        cwd: directory,
        timeout: 10_000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          TSX_TSCONFIG_PATH: resolve("tsconfig.json"),
        },
      },
    );
    // Stop at executable validation so the test never claims jobs or contacts storage.
    expect(stdout.trim().split("\n").at(-1)).toBe("ENOENT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
