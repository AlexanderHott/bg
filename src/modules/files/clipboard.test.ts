import { afterEach, expect, test, vi } from "vite-plus/test";

import { copyPng } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  class ClipboardItem {
    constructor(readonly data: Record<string, Promise<Blob>>) {}
  }
  const write = vi.fn(async (items: Array<ClipboardItem>) => {
    await items[0].data["image/png"];
  });
  const fetchImage = vi.fn<typeof fetch>();
  vi.stubGlobal("ClipboardItem", ClipboardItem);
  vi.stubGlobal("navigator", { clipboard: { write } });
  vi.stubGlobal("fetch", fetchImage);
  return { write, fetchImage };
}

test("starts the clipboard write before the PNG fetch finishes and preserves its bytes", async () => {
  const { write, fetchImage } = setup();
  const response = Promise.withResolvers<Response>();
  fetchImage.mockReturnValue(response.promise);
  const copying = copyPng("https://example.test/result.png");
  expect(write).toHaveBeenCalledTimes(1);
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  response.resolve(new Response(bytes));
  expect(await copying).toEqual({ ok: true, value: undefined });
  const png = await write.mock.calls[0][0][0].data["image/png"];
  expect(png.type).toBe("image/png");
  expect(new Uint8Array(await png.arrayBuffer())).toEqual(bytes);
});

test("reports expired image URLs as a copy failure", async () => {
  const { fetchImage } = setup();
  fetchImage.mockResolvedValue(new Response(null, { status: 403 }));
  expect(await copyPng("https://example.test/expired.png")).toMatchObject({ ok: false });
});

test("handles clipboard rejection even if downloading the image also fails", async () => {
  const { write, fetchImage } = setup();
  write.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
  fetchImage.mockRejectedValue(new Error("offline"));
  expect(await copyPng("https://example.test/result.png")).toMatchObject({ ok: false });
});

test("reports unsupported browsers without fetching an image", async () => {
  const { fetchImage } = setup();
  vi.stubGlobal("navigator", {});
  expect(await copyPng("https://example.test/result.png")).toMatchObject({ ok: false });
  expect(fetchImage).not.toHaveBeenCalled();
});
