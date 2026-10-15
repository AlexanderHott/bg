import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    ssr: "src/mediaWorker.ts",
    outDir: ".output/media-worker",
    emptyOutDir: false,
    rollupOptions: {
      external: ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner", "pg"],
      output: { entryFileNames: "index.mjs" },
    },
  },
});
