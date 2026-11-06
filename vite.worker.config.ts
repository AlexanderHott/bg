import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    ssr: true,
    outDir: ".output/worker",
    emptyOutDir: false,
    rollupOptions: {
      input: { index: "src/worker.ts", modelThread: "src/modelThread.ts" },
      external: ["@aws-sdk/client-s3", "onnxruntime-node", "pg", "sharp"],
      output: { entryFileNames: "[name].mjs" },
    },
  },
});
