import {
  createHotkeySequence,
  formatHotkeySequence,
  type HotkeySequence,
} from "@tanstack/solid-hotkeys";
import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";

import { ButtonLink } from "@/components/ui/ButtonLink";
import { createElementHeight } from "@/lib/createElementHeight";
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
  const navbar = createElementHeight();
  const context = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const homeHotkeySequence = ["G", "H"] satisfies HotkeySequence;
  const removeBackgroundHotkeySequence = ["G", "B"] satisfies HotkeySequence;
  const invitesHotkeySequence = ["G", "I"] satisfies HotkeySequence;
  createHotkeySequence(homeHotkeySequence, () =>
    navigate({ to: "/$orgSlug", params: { orgSlug: context().organization.slug } }),
  );
  createHotkeySequence(removeBackgroundHotkeySequence, () =>
    navigate({
      to: "/$orgSlug/remove-background",
      params: { orgSlug: context().organization.slug },
    }),
  );
  createHotkeySequence(invitesHotkeySequence, () =>
    navigate({ to: "/$orgSlug/invites", params: { orgSlug: context().organization.slug } }),
  );

  return (
    <div
      class="min-h-[calc(100vh-var(--app-navbar-height))]"
      style={{ "--org-navbar-height": navbar.height() ?? "calc(3rem + 1px)" }}
    >
      <div ref={navbar.ref} class="bg-background sticky top-(--app-navbar-height) z-20 border-b">
        <nav
          aria-label="Organization"
          class="mx-auto flex min-h-12 w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 text-sm sm:px-6"
        >
          <span class="font-medium">{context().organization.name}</span>
          <ButtonLink
            variant="link"
            to="/$orgSlug"
            params={{ orgSlug: context().organization.slug }}
            activeOptions={{ exact: true }}
          >
            home · {formatHotkeySequence(homeHotkeySequence).toLocaleLowerCase()}
          </ButtonLink>
          <ButtonLink
            variant="link"
            to="/$orgSlug/remove-background"
            params={{ orgSlug: context().organization.slug }}
          >
            remove background ·{" "}
            {formatHotkeySequence(removeBackgroundHotkeySequence).toLocaleLowerCase()}
          </ButtonLink>
          <ButtonLink
            variant="link"
            to="/$orgSlug/invites"
            params={{ orgSlug: context().organization.slug }}
          >
            invites · {formatHotkeySequence(invitesHotkeySequence).toLocaleLowerCase()}
          </ButtonLink>
        </nav>
      </div>

      <main class="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
