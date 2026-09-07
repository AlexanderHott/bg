import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { nitro } from "nitro/vite";
import solidPlugin from "vite-plugin-solid";
import { defaultExclude, defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig(({ mode }) => ({
  test: {
    // Skipping a suite still evaluates its server imports; opt in before collection.
    exclude: [
      ...defaultExclude,
      ...(process.env.RUN_DB_INTEGRATION === "1"
        ? []
        : [
            "**/backgroundRemovals.integration.test.ts",
            "**/cleanup.integration.test.ts",
            "**/invites.integration.test.ts",
          ]),
      ...(process.env.RUN_WORKER_INTEGRATION === "1" ? [] : ["**/worker.integration.test.ts"]),
    ],
  },
  fmt: {
    sortImports: true,
    sortPackageJson: true,
    sortTailwindcss: true,
    ignorePatterns: ["**/routeTree.gen.ts", "drizzle/"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  resolve: { tsconfigPaths: true },
  plugins: lazyPlugins(() => [
    devtools(),
    ...(mode === "test"
      ? []
      : [
          nitro({
            serverDir: "server",
            rollupConfig: {
              external: ["pg", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
            },
          }),
        ]),
    tailwindcss(),
    tanstackStart(),
    solidPlugin({ ssr: true }),
  ]),
}));
