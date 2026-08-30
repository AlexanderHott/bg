import { createFileRoute } from "@tanstack/solid-router";

import { CreateOrganizationForm } from "@/modules/organizations/components/CreateOrganizationForm";

export const Route = createFileRoute("/_app/_user/create-organization")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div class="flex min-h-[calc(100vh-7.5rem)] items-center justify-center py-8">
      <CreateOrganizationForm />
    </div>
  );
}
