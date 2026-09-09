import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal, For, Show } from "solid-js";
import type * as v from "valibot";

import { Button } from "@/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectFieldLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import {
  createInviteFn,
  listInvitesFn,
  revokeInviteFn,
} from "@/modules/organizations/inviteServerFunctions";
import { inviteErrorMessages, inviteStatus } from "@/modules/organizations/inviteStatus";
import type { InviteValidityDaysValidator } from "@/modules/organizations/validators";

const inviteValidityOptions = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

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
  const [validityDays, setValidityDays] =
    createSignal<v.InferOutput<typeof InviteValidityDaysValidator>>(7);
  const [revoking, setRevoking] = createSignal<string>();
  const [newInvite, setNewInvite] = createSignal<{ id: string; url: string }>();
  const [error, setError] = createSignal<string>();
  const [copyMessage, setCopyMessage] = createSignal<string>();

  async function create() {
    if (creating()) return;
    setCreating(true);
    setError(undefined);
    setCopyMessage(undefined);
    try {
      const result = await createInvite({
        data: { organizationId: context().organization.id, validityDays: validityDays() },
      });
      if (!result.ok) {
        setError(inviteErrorMessages[result.error]);
        return;
      }
      setNewInvite({
        id: result.value.id,
        url: `${window.location.origin}/invite/accept#${result.value.token}`,
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
      <div class="flex flex-wrap items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold">invites</h1>
        <div class="flex flex-wrap items-center gap-2">
          <Select
            id="invite-validity"
            class="flex items-center gap-2"
            options={[...inviteValidityOptions]}
            optionValue="days"
            optionTextValue="label"
            value={inviteValidityOptions.find((option) => option.days === validityDays())}
            disabled={creating()}
            disallowEmptySelection
            gutter={4}
            onChange={(option) => {
              if (option) setValidityDays(option.days);
            }}
            itemComponent={(props) => (
              <SelectItem item={props.item}>{props.item.rawValue.label}</SelectItem>
            )}
          >
            <SelectFieldLabel class="text-muted-foreground text-sm">expires in</SelectFieldLabel>
            <SelectTrigger>
              <SelectValue<(typeof inviteValidityOptions)[number]>>
                {(state) => state.selectedOption().label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
          <Button disabled={creating()} onClick={create}>
            {creating() ? "creating..." : "create invite"}
          </Button>
        </div>
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
                copy link
              </Button>
            </div>
            <p class="text-muted-foreground text-sm">Copy this link before leaving.</p>
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
              <Table aria-label="invites">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">status</TableHead>
                    <TableHead scope="col">created by</TableHead>
                    <TableHead scope="col">created</TableHead>
                    <TableHead scope="col">expires</TableHead>
                    <TableHead scope="col" class="text-right">
                      actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <For each={invites()}>
                    {(invite) => (
                      <TableRow>
                        <TableCell class="font-medium">{inviteStatus(invite)}</TableCell>
                        <TableCell>{invite.createdBy ?? "deleted user"}</TableCell>
                        <TableCell>{invite.createdAt.toLocaleString()}</TableCell>
                        <TableCell>{invite.expiresAt.toLocaleString()}</TableCell>
                        <TableCell class="text-right">
                          <Show when={inviteStatus(invite) === "pending"}>
                            <Button
                              variant="destructive"
                              disabled={revoking() !== undefined}
                              onClick={() => revoke(invite.id)}
                            >
                              {revoking() === invite.id ? "revoking..." : "revoke"}
                            </Button>
                          </Show>
                        </TableCell>
                      </TableRow>
                    )}
                  </For>
                </TableBody>
              </Table>
            </Show>
          );
        }}
      </Show>
    </section>
  );
}
