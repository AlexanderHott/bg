import { createFileRoute } from "@tanstack/solid-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ImageUploader } from "@/modules/files/components/ImageUploader";

export const Route = createFileRoute("/_app/$orgSlug/remove-background")({
  component: RouteComponent,
});

function RouteComponent() {
  const context = Route.useRouteContext();

  return (
    <Card>
      <CardHeader>
        <CardTitle>remove background</CardTitle>
      </CardHeader>

      <CardContent>
        <ImageUploader organizationSlug={context().organization.slug} />
      </CardContent>
    </Card>
  );
}
