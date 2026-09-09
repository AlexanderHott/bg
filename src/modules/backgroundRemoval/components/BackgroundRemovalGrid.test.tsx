import { renderToString } from "solid-js/web";
import { expect, test } from "vite-plus/test";

import type { BackgroundRemovalEntry } from "../browser";
import { BackgroundRemovalGrid } from "./BackgroundRemovalGrid";

const input = {
  id: "input",
  organizationId: "organization",
  requestId: "upload",
  name: "portrait.png",
  mediaType: "image/png",
  sizeBytes: 100,
  createdAt: new Date(),
  url: "https://example.test/input.png",
};
const removal: BackgroundRemovalEntry = {
  id: "removal",
  requestId: "request",
  modelId: "model",
  createdAt: new Date(),
  status: "ready",
  input,
  output: {
    ...input,
    id: "output",
    name: "portrait-background-removed.png",
    url: "https://example.test/output.png",
    thumbnailUrl: "https://example.test/output-thumbnail.webp",
  },
};

function render(entry: BackgroundRemovalEntry) {
  return renderToString(() => (
    <BackgroundRemovalGrid removals={[entry]} onRetry={async () => {}} onDelete={async () => {}} />
  ));
}

test("renders a thumbnail while the download links to the full-resolution PNG", () => {
  const html = render(removal);
  expect(html).toContain('src="https://example.test/output-thumbnail.webp"');
  expect(html).toContain('href="https://example.test/output.png"');
  expect(html).toContain('download="portrait-background-removed.png"');
  expect(html).not.toContain('src="https://example.test/output.png"');
});

test("falls back to full-resolution images for existing removals", () => {
  const html = render({ ...removal, output: { ...input, id: "output" } });
  expect(html).toContain('src="https://example.test/input.png"');
});

test("preserves the preparing state for optimistic removals without URLs", () => {
  const html = render({
    ...removal,
    status: "queued",
    creation: "pending",
    input: { ...input, url: undefined },
    output: undefined,
  });
  expect(html).toContain("preparing image");
});
