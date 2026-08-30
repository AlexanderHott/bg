import { createFileRoute, Link } from "@tanstack/solid-router";
import { For } from "solid-js";

import { Button } from "@/components/ui/Button";
import { listOrganizationsFn } from "@/modules/organizations/serverFunctions";

export const Route = createFileRoute("/_app/")({
  component: RouteComponent,
  loader: async () => {
    const organizations = await listOrganizationsFn();
    return { organizations };
  },
});

function RouteComponent() {
  const data = Route.useLoaderData();
  return (
    <div>
      <div>select an organization ({data().organizations.length})</div>
      <ul>
        <For each={data().organizations}>
          {(organization) => (
            <li>
              <pre>{JSON.stringify(organization, null, 2)}</pre>
              <Button
                variant="secondary"
                as={(props) => (
                  <Link to="/$orgSlug" params={{ orgSlug: organization.slug }} {...props} />
                )}
              >
                {"[ select organization >> ]"}
              </Button>
            </li>
          )}
        </For>
      </ul>
      <Button variant="outline" as={(props) => <Link to="/create-organization" {...props} />}>
        [ create organization ]
      </Button>
      <Button variant="outline" as={(props) => <Link to="/settings" {...props} />}>
        [ user settings ]
      </Button>
    </div>
  );
}
