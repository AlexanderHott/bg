import { renderToString } from "solid-js/web";
import { describe, expect, test } from "vite-plus/test";

import { ImageGrid } from "./ImageGrid";

describe("ImageGrid", () => {
  test("renders an empty state", () => {
    const html = renderToString(() => <ImageGrid images={[]} />);

    expect(html).toContain("no uploaded images yet");
  });

  test("renders uploaded images", () => {
    const html = renderToString(() => (
      <ImageGrid
        images={[
          {
            id: "01994fd4-c3ef-7f5a-a0cb-768f7f6d3be6",
            organizationId: "01994fd4-d61a-7d1d-b36d-6832661f94ea",
            name: "portrait.png",
            mediaType: "image/png",
            sizeBytes: 6,
            createdAt: new Date("2026-08-30T00:00:00.000Z"),
            url: "http://localhost:9000/bg/signed-portrait.png",
          },
        ]}
      />
    ));

    expect(html).toContain("portrait.png");
    expect(html).toContain("http://localhost:9000/bg/signed-portrait.png");
  });
});
