import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, createSignal } from "solid-js";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { ImageGrid } from "@/modules/files/components/ImageGrid";
import { ImageUploader } from "@/modules/files/components/ImageUploader";
import type { ReadyFile, ReadyImage } from "@/modules/files/files";
import { getReadyImageFn, listReadyImagesFn } from "@/modules/files/serverFunctions";

export const Route = createFileRoute("/_app/$orgSlug/remove-background")({
  component: RouteComponent,
  loader: async ({ params }) => {
    const images = await listReadyImagesFn({
      data: { organizationSlug: params.orgSlug },
    });

    return { images };
  },
});

function RouteComponent() {
  const context = Route.useRouteContext();
  const data = Route.useLoaderData();
  const [uploadedImages, setUploadedImages] = createSignal<Array<ReadyImage>>([]);
  const images = createMemo(() => {
    const imagesById = new Map(data().images.map((file) => [file.id, file]));
    for (const file of uploadedImages()) imagesById.set(file.id, file);
    return [...imagesById.values()].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
  });

  async function addUploadedImage(file: ReadyFile) {
    const imageResult = await getReadyImageFn({
      data: {
        organizationSlug: context().organization.slug,
        fileId: file.id,
      },
    });
    if (!imageResult.ok) return;

    setUploadedImages((current) => [
      imageResult.value,
      ...current.filter((item) => item.id !== file.id),
    ]);
  }

  return (
    <div class="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>remove background</CardTitle>
        </CardHeader>

        <CardContent>
          <ImageUploader
            organizationSlug={context().organization.slug}
            onUploaded={(file) => void addUploadedImage(file)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>uploaded images</CardTitle>
          <CardDescription>Images available to this organization.</CardDescription>
        </CardHeader>
        <CardContent>
          <ImageGrid images={images()} />
        </CardContent>
      </Card>
    </div>
  );
}
