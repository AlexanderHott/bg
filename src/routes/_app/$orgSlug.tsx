import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";

import { Button } from "@/components/ui/Button";
import { signOutFn } from "@/modules/auth/serverFunctions";
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
  const signOut = useServerFn(signOutFn);
  const navigate = useNavigate();
  return (
    <div>
      <nav class="flex items-center justify-between p-4">
        <div class="flex items-center gap-4">
          <Link class="underline" to="/$orgSlug/">
            home
          </Link>
          <Link class="underline" to="/$orgSlug/download" params={(old) => old}>
            download
          </Link>
          <Link class="underline" to="/">
            switch organization
          </Link>
        </div>
        <div>
          <Button
            variant="secondary"
            onClick={async () => {
              await signOut();
              await navigate({ to: "/" });
            }}
          >
            [ sign out ]
          </Button>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
