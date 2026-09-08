import {
  createHotkeySequences,
  DEFAULT_SEQUENCE_TIMEOUT,
  formatHotkeySequence,
  type HotkeySequence,
} from "@tanstack/solid-hotkeys";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, For, onCleanup, Show } from "solid-js";

import { ButtonLink } from "@/components/ui/ButtonLink";
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
  const navigate = Route.useNavigate();
  const organizationLinks = createMemo(() =>
    data().organizations.map((organization, index) => ({
      organization,
      number: index + 1,
      sequence: ["O", ...String(index + 1).split("")] as HotkeySequence,
    })),
  );
  let pendingSelection: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(pendingSelection));
  createHotkeySequences(() =>
    organizationLinks().map(({ organization, number, sequence }) => ({
      sequence,
      callback: () => {
        clearTimeout(pendingSelection);
        const open = () => navigate({ to: "/$orgSlug", params: { orgSlug: organization.slug } });
        // Wait for another digit when this number also starts a longer row number.
        if (number * 10 <= organizationLinks().length) {
          pendingSelection = setTimeout(open, DEFAULT_SEQUENCE_TIMEOUT);
        } else {
          void open();
        }
      },
    })),
  );

  return (
    <section class="flex flex-col gap-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">organizations</h1>
          <p class="text-muted-foreground mt-1 text-sm">Choose where you want to work.</p>
        </div>
        <ButtonLink variant="link" to="/create-organization">
          create organization · o c
        </ButtonLink>
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
            <ButtonLink variant="link" to="/create-organization">
              create organization · o c
            </ButtonLink>
          </div>
        }
      >
        <ul class="grid gap-3 sm:grid-cols-2">
          <For each={organizationLinks()}>
            {({ organization, sequence }) => (
              <li class="bg-background flex items-center justify-between gap-4 rounded-xl border p-4">
                <div class="min-w-0">
                  <div class="truncate font-medium">{organization.name}</div>
                  <div class="text-muted-foreground truncate text-sm">/{organization.slug}</div>
                </div>
                <ButtonLink variant="link" to="/$orgSlug" params={{ orgSlug: organization.slug }}>
                  open · {formatHotkeySequence(sequence).toLocaleLowerCase()}
                </ButtonLink>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
