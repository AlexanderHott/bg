import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal, For, Show } from "solid-js";

import { Button } from "@/components/ui/Button";
import {
  createInviteFn,
  listInvitesFn,
  revokeInviteFn,
} from "@/modules/organizations/inviteServerFunctions";
import { inviteErrorMessages, inviteStatus } from "@/modules/organizations/inviteStatus";

export const Route = createFileRoute("/_app/$orgSlug/invites")({
  loader: ({ context }) => listInvitesFn({ data: { organizationId: context.organization.id } }),
  component: InvitesPage,
});

function InvitesPage() {
  const context = Route.useRouteContext();
  const data = Route.useLoaderData();
  const router = useRouter();
  const createInvite = useServerFn(createInviteFn);
  const revokeInvite = useServerFn(revokeInviteFn);
  const [creating, setCreating] = createSignal(false);
  const [revoking, setRevoking] = createSignal<string>();
  const [newInvite, setNewInvite] = createSignal<{ id: string; url: string; expiresAt: Date }>();
  const [error, setError] = createSignal<string>();
  const [copyMessage, setCopyMessage] = createSignal<string>();

  async function create() {
    if (creating()) return;
    setCreating(true);
    setError(undefined);
    setCopyMessage(undefined);
    try {
      const result = await createInvite({ data: { organizationId: context().organization.id } });
      if (!result.ok) {
        setError(inviteErrorMessages[result.error]);
        return;
      }
      setNewInvite({
        id: result.value.id,
        url: `${window.location.origin}/invite/accept#${result.value.token}`,
        expiresAt: result.value.expiresAt,
      });
      await router.invalidate();
    } catch {
      setError("Could not complete the request. Refresh the invite list before trying again.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(inviteId: string) {
    if (revoking()) return;
    setRevoking(inviteId);
    setError(undefined);
    try {
      const result = await revokeInvite({
        data: { organizationId: context().organization.id, inviteId },
      });
      if (!result.ok) {
        setError(inviteErrorMessages[result.error]);
      } else if (newInvite()?.id === inviteId) {
        setNewInvite(undefined);
      }
      await router.invalidate();
    } catch {
      setError("Could not confirm revocation. Refresh the list and try again.");
    } finally {
      setRevoking(undefined);
    }
  }

  return (
    <section class="flex flex-col gap-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">invites</h1>
          <p class="text-muted-foreground mt-1 text-sm">
            Share a link to invite someone to {context().organization.name}.
          </p>
          <p class="text-muted-foreground mt-1 text-sm">
            Each link works once and expires in seven days. Anyone who joins can invite others.
          </p>
        </div>
        <Button disabled={creating()} onClick={create}>
          {creating() ? "creating..." : "[ create invite ]"}
        </Button>
      </div>
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <Show when={newInvite()}>
        {(invite) => (
          <div class="bg-background flex flex-col gap-3 rounded-xl border p-4">
            <label class="text-sm font-medium" for="invite-link">
              invite link
            </label>
            <div class="flex flex-wrap gap-2">
              <input
                id="invite-link"
                class="min-w-0 grow rounded-md border p-2 text-sm"
                readOnly
                value={invite().url}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(invite().url);
                    setCopyMessage("Link copied.");
                  } catch {
                    setCopyMessage("Select the link above and copy it manually.");
                  }
                }}
              >
                [ copy link ]
              </Button>
            </div>
            <p class="text-muted-foreground text-sm">
              Copy this link before leaving. It expires {invite().expiresAt.toLocaleString()}.
            </p>
            <Show when={copyMessage()}>
              {(message) => (
                <p role="status" class="text-sm">
                  {message()}
                </p>
              )}
            </Show>
          </div>
        )}
      </Show>
      <Show when={!data().ok}>
        <p role="alert">You must be a member of this organization to manage invites.</p>
      </Show>
      <Show when={data().ok && data()}>
        {(result) => {
          const invites = () => {
            const value = result();
            return value.ok ? value.value : [];
          };
          return (
            <Show
              when={invites().length}
              fallback={<p class="text-muted-foreground">No invites yet.</p>}
            >
              <ul class="flex flex-col gap-3">
                <For each={invites()}>
                  {(invite) => (
                    <li class="bg-background flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                      <div>
                        <p class="font-medium">{inviteStatus(invite)}</p>
                        <p class="text-muted-foreground text-sm">
                          Created by {invite.createdBy ?? "deleted user"} on{" "}
                          {invite.createdAt.toLocaleString()}
                        </p>
                        <p class="text-muted-foreground text-sm">
                          Expires {invite.expiresAt.toLocaleString()}
                        </p>
                      </div>
                      <Show when={inviteStatus(invite) === "pending"}>
                        <Button
                          variant="destructive"
                          disabled={revoking() !== undefined}
                          onClick={() => revoke(invite.id)}
                        >
                          {revoking() === invite.id ? "revoking..." : "[ revoke ]"}
                        </Button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          );
        }}
      </Show>
    </section>
  );
}
