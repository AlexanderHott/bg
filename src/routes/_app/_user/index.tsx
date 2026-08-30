import { createFileRoute, Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";

import { buttonVariants } from "@/components/ui/Button";
import { listOrganizationsFn } from "@/modules/organizations/serverFunctions";

export const Route = createFileRoute("/_app/_user/")({
  component: RouteComponent,
  loader: async () => {
    const organizations = await listOrganizationsFn();
    return { organizations };
  },
});

function RouteComponent() {
  const data = Route.useLoaderData();
  return (
    <section class="flex flex-col gap-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">organizations</h1>
          <p class="text-muted-foreground mt-1 text-sm">Choose where you want to work.</p>
        </div>
        <Link class={buttonVariants()} to="/create-organization">
          [ create organization ]
        </Link>
      </div>

      <Show
        when={data().organizations.length > 0}
        fallback={
          <div class="bg-background flex min-h-72 flex-col items-center justify-center gap-4 rounded-xl border border-dashed p-8 text-center">
            <div>
              <h2 class="font-medium">no organizations yet</h2>
              <p class="text-muted-foreground mt-1 text-sm">
                Create one to start using organization tools.
              </p>
            </div>
            <Link class={buttonVariants({ variant: "outline" })} to="/create-organization">
              [ create organization ]
            </Link>
          </div>
        }
      >
        <ul class="grid gap-3 sm:grid-cols-2">
          <For each={data().organizations}>
            {(organization) => (
              <li class="bg-background flex items-center justify-between gap-4 rounded-xl border p-4">
                <div class="min-w-0">
                  <div class="truncate font-medium">{organization.name}</div>
                  <div class="text-muted-foreground truncate text-sm">/{organization.slug}</div>
                </div>
                <Link
                  class={buttonVariants({ variant: "secondary" })}
                  to="/$orgSlug"
                  params={{ orgSlug: organization.slug }}
                >
                  [ open ]
                </Link>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
