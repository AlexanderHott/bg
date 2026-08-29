import { createFileRoute } from "@tanstack/solid-router";

import { CreateOrganizationForm } from "@/modules/organizations/components/CreateOrganizationForm";

export const Route = createFileRoute("/_app/create-organization")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div class="flex items-center justify-center">
      <CreateOrganizationForm />
    </div>
  );
}
