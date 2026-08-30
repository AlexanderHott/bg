import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/_app/$orgSlug/download")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_app/download"!</div>;
}
