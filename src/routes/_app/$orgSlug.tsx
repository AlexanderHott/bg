import { createHotkey, type HotkeySequence } from "@tanstack/solid-hotkeys";
import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";

import { ButtonLink } from "@/components/ui/ButtonLink";
import { HotkeyHint } from "@/components/ui/HotkeyHint";
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
  createHotkey(homeHotkeySequence, () =>
    navigate({ to: "/$orgSlug", params: { orgSlug: context().organization.slug } }),
  );
  createHotkey(removeBackgroundHotkeySequence, () =>
    navigate({
      to: "/$orgSlug/remove-background",
      params: { orgSlug: context().organization.slug },
    }),
  );
  createHotkey(invitesHotkeySequence, () =>
    navigate({ to: "/$orgSlug/invites", params: { orgSlug: context().organization.slug } }),
  );

  return (
    <div
      class="min-h-[calc(100dvh-var(--app-navbar-height))]"
      style={{ "--org-navbar-height": navbar.height() ?? "calc(3rem + 1px)" }}
    >
      <div ref={navbar.ref} class="bg-background sticky top-(--app-navbar-height) z-20 border-b">
        <nav
          aria-label="Organization"
          class="mx-auto flex min-h-12 w-full max-w-6xl items-center gap-x-5 gap-y-2 overflow-x-auto px-4 py-2 text-sm whitespace-nowrap sm:flex-wrap sm:px-6"
        >
          <span class="font-medium">{context().organization.name}</span>
          <ButtonLink
            variant="link"
            to="/$orgSlug"
            params={{ orgSlug: context().organization.slug }}
            activeOptions={{ exact: true }}
          >
            home
            <HotkeyHint hotkey={homeHotkeySequence} />
          </ButtonLink>
          <ButtonLink
            variant="link"
            to="/$orgSlug/remove-background"
            params={{ orgSlug: context().organization.slug }}
          >
            remove background
            <HotkeyHint hotkey={removeBackgroundHotkeySequence} />
          </ButtonLink>
          <ButtonLink
            variant="link"
            to="/$orgSlug/download-media"
            params={{ orgSlug: context().organization.slug }}
          >
            download media
          </ButtonLink>
          <ButtonLink
            variant="link"
            to="/$orgSlug/invites"
            params={{ orgSlug: context().organization.slug }}
          >
            invites
            <HotkeyHint hotkey={invitesHotkeySequence} />
          </ButtonLink>
        </nav>
      </div>

      <main class="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
