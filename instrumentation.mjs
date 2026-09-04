if (process.env.OTEL_ENABLED === "true") {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    throw new Error("OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL_ENABLED=true");
  }

  // The synchronous hook supports ESM instrumentation without a loader thread.
  const { register } = await import("import-in-the-middle/register-hooks.mjs");
  register();
  await import("@opentelemetry/auto-instrumentations-node/register");
}
