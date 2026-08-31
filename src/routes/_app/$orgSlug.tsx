import { createFileRoute, Link, Outlet, redirect } from "@tanstack/solid-router";

import { getOrganizationFn } from "@/modules/organizations/serverFunctions";

export const Route = createFileRoute("/_app/$orgSlug")({
  component: RouteComponent,
  beforeLoad: async ({ params }) => {
    const organization = await getOrganizationFn({
      data: { organizationSlug: params.orgSlug },
    });

    if (!organization) {
      throw redirect({ to: "/" });
    }

    return { organization };
  },
});

function RouteComponent() {
  const context = Route.useRouteContext();

  return (
    <div class="min-h-[calc(100vh-3.5rem)]">
      <div class="bg-background border-b">
        <nav
          aria-label="Organization"
          class="mx-auto flex min-h-12 w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 text-sm sm:px-6"
        >
          <span class="font-medium">{context().organization.name}</span>
          <Link
            class="text-muted-foreground hover:text-foreground"
            to="/$orgSlug"
            params={{ orgSlug: context().organization.slug }}
            activeOptions={{ exact: true }}
          >
            home
          </Link>
          <Link
            class="text-muted-foreground hover:text-foreground"
            to="/$orgSlug/download"
            params={{ orgSlug: context().organization.slug }}
          >
            download
          </Link>
          <Link
            class="text-muted-foreground hover:text-foreground"
            to="/$orgSlug/remove-background"
            params={{ orgSlug: context().organization.slug }}
          >
            upload demo
          </Link>
          <Link class="text-muted-foreground hover:text-foreground ml-auto" to="/">
            switch organization
          </Link>
        </nav>
      </div>

      <main class="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
