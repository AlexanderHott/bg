import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, vi } from "vite-plus/test";

import { normalizeMetadata, runMediaProcess, scratchSize } from "./ytDlpAdapter";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat), readdir: vi.fn(actual.readdir) };
});

test("scratch accounting tolerates files and directories disappearing during a scan", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bg-scratch-test-"));
  try {
    await writeFile(join(cwd, "output.part"), "temporary");
    await writeFile(join(cwd, "output.mp4"), "media");
    const actualStat = (
      await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
    ).stat;
    vi.mocked(stat).mockImplementation(async (...args) => {
      if (String(args[0]).endsWith(".part"))
        throw Object.assign(new Error("File disappeared"), { code: "ENOENT" });
      return actualStat(...args);
    });
    expect(await scratchSize(cwd)).toBe(5);
    vi.mocked(stat).mockImplementation(actualStat);
    await rm(join(cwd, "output.part"));
    await mkdir(join(cwd, "fragments"));
    const actualReaddir = (
      await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
    ).readdir;
    vi.mocked(readdir).mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("fragments"))
        throw Object.assign(new Error("Directory disappeared"), { code: "ENOENT" });
      return actualReaddir(...args);
    });
    expect(await scratchSize(cwd)).toBe(5);
  } finally {
    vi.mocked(stat).mockReset();
    vi.mocked(readdir).mockReset();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("scratch accounting still reports filesystem failures", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bg-scratch-test-"));
  try {
    await writeFile(join(cwd, "output.part"), "temporary");
    vi.mocked(stat).mockRejectedValueOnce(
      Object.assign(new Error("Permission denied"), { code: "EACCES" }),
    );
    await expect(scratchSize(cwd)).rejects.toThrow("Permission denied");
  } finally {
    vi.mocked(stat).mockReset();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("streams progress before process completion and awaits consumers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bg-process-test-"));
  const lines: string[] = [];
  try {
    await runMediaProcess({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write('first\\n'); setTimeout(() => process.stdout.write('second\\n'), 30)",
      ],
      cwd,
      signal: new AbortController().signal,
      timeoutMs: 5_000,
      onLine: async (line) => {
        lines.push(line);
      },
    });
    expect(lines).toEqual(["first", "second"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("cancellation stops subprocess descendants", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bg-process-test-"));
  const controller = new AbortController();
  let descendant: number | undefined;
  try {
    await expect(
      runMediaProcess({
        executable: process.execPath,
        args: [
          "-e",
          "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000)",
        ],
        cwd,
        signal: controller.signal,
        timeoutMs: 5_000,
        onLine: async (line) => {
          descendant = Number(line);
          controller.abort();
        },
      }),
    ).rejects.toThrow("Cancelled");
    expect(descendant).toBeGreaterThan(0);
    expect(() => process.kill(descendant!, 0)).toThrow();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a failed metadata consumer stops the producer", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bg-process-test-"));
  try {
    await expect(
      runMediaProcess({
        executable: process.execPath,
        args: ["-e", "console.log('invalid'); setInterval(()=>{},1000)"],
        cwd,
        signal: new AbortController().signal,
        timeoutMs: 5_000,
        onLine: async () => {
          throw new Error("Invalid entry");
        },
      }),
    ).rejects.toThrow("Invalid entry");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("keeps optional preview metadata without retaining source URLs", () => {
  const metadata = normalizeMetadata({
    title: "Example",
    duration: 90,
    channel: "Channel",
    uploader: "Uploader",
    upload_date: "20260913",
    view_count: 42,
    description: "a".repeat(12_000),
    url: "https://example.com/private-stream",
  });
  expect(metadata.uploader).toBe("Channel");
  expect(metadata.uploadDate).toBe("20260913");
  expect(metadata.viewCount).toBe(42);
  expect(metadata.description).toHaveLength(10_000);
  expect(metadata).not.toHaveProperty("url");
  expect(normalizeMetadata({ title: "Minimal" }).uploader).toBeUndefined();
});
