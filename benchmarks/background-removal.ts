import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform } from "node:os";
import { basename, join } from "node:path";

import { createBiRefNetAdapter } from "../src/modules/backgroundRemoval/modelAdapter";

const [modelPath, corpusPath, outputPath] = process.argv.slice(2);
if (!modelPath || !corpusPath || !outputPath) {
  throw new Error(
    "Usage: tsx benchmarks/background-removal.ts MODEL CORPUS_DIRECTORY OUTPUT_DIRECTORY",
  );
}
const corpus = [
  {
    name: "o_663090ad.jpg",
    category: "portrait",
    sha256: "3477afdf5e891e19a6c665fef26da44ccdb3cf2a18c5d237f18b3d2a98555dc8",
  },
  {
    name: "o_46818bea.jpg",
    category: "animal",
    sha256: "ae87edb1659dc22bf29c78f5b7860c8fe3fe6754f9262aba50789d77b2d4543f",
  },
  {
    name: "o_740b4c5d.jpg",
    category: "transparent",
    sha256: "a83b25fc10bebb5514144f048afde891236b948a27a001a6b0bb4b223afe1190",
  },
];
await mkdir(outputPath, { recursive: true });
const startedAt = performance.now();
const adapter = await createBiRefNetAdapter(modelPath);
const loadMs = performance.now() - startedAt;
const runs = [];
for (const pass of ["first", "repeat"] as const) {
  for (const item of corpus) {
    const inputPath = join(corpusPath, item.name);
    const inputSha256 = createHash("sha256")
      .update(await readFile(inputPath))
      .digest("hex");
    if (inputSha256 !== item.sha256) throw new Error(`Corpus checksum mismatch: ${item.name}`);
    const start = performance.now();
    const dimensions = await adapter.removeBackground(
      inputPath,
      join(outputPath, `${pass}-${basename(item.name, ".jpg")}.png`),
    );
    const durationMs = performance.now() - start;
    globalThis.gc?.();
    const result = {
      name: item.name,
      category: item.category,
      inputSha256,
      pass,
      ...dimensions,
      durationMs,
      retainedRssBytes: process.memoryUsage().rss,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
    };
    runs.push(result);
    console.log(JSON.stringify(result));
  }
}
const report = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: platform(),
  architecture: arch(),
  cpu: cpus()[0]?.model,
  modelSha256: createHash("sha256")
    .update(await readFile(modelPath))
    .digest("hex"),
  loadMs,
  coldStartMs: loadMs + runs[0].durationMs,
  crashes: 0,
  runs,
};
await writeFile(join(outputPath, "results.json"), JSON.stringify(report, null, 2) + "\n");
