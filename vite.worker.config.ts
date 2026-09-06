import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    ssr: "src/worker.ts",
    outDir: ".output/worker",
    emptyOutDir: false,
    rollupOptions: {
      external: ["@aws-sdk/client-s3", "onnxruntime-node", "pg", "sharp"],
      output: { entryFileNames: "index.mjs" },
    },
  },
});
