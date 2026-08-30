import { createFileRoute, Outlet } from "@tanstack/solid-router";

export const Route = createFileRoute("/_app/_user")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main class="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <Outlet />
    </main>
  );
}
