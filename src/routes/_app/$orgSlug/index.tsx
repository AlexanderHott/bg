import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/_app/$orgSlug/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/app/"!</div>;
}
