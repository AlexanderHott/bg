import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal, For, Show } from "solid-js";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Sensitive } from "@/components/ui/Sensitive";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { registerPasskey } from "@/modules/auth/lib/webauthn/browser";
import {
  beginPasskeyRegistrationFn,
  finishPasskeyRegistrationFn,
  listActiveSessionsFn,
  listPasskeysFn,
  revokeSessionFn,
} from "@/modules/auth/serverFunctions";

export const Route = createFileRoute("/_app/$orgSlug/settings")({
  component: RouteComponent,
  loader: async ({ context: { sessionId } }) => {
    const [activeSessions, passkeys] = await Promise.all([
      listActiveSessionsFn(),
      listPasskeysFn(),
    ]);
    return { activeSessions, passkeys, sessionId };
  },
});

function RouteComponent() {
  return (
    <div class="flex flex-col gap-4 p-4">
      <ActiveSessions />
      <Passkeys />
    </div>
  );
}

function ActiveSessions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>active sessions</CardTitle>
      </CardHeader>
      <CardContent>
        <SessionsTable />
      </CardContent>
    </Card>
  );
}

function SessionsTable() {
  const data = Route.useLoaderData();
  const revokeSession = useServerFn(revokeSessionFn);
  const router = useRouter();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>last active</TableHead>
          <TableHead>expires at</TableHead>
          <TableHead>user agent</TableHead>
          <TableHead>ip</TableHead>
          <TableHead>actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <For each={data().activeSessions}>
          {(session) => (
            <TableRow>
              <TableCell class="text-right">{session.lastActiveAt.toLocaleString()}</TableCell>
              <TableCell>{session.expiresAt.toLocaleString()}</TableCell>
              <TableCell class="font-medium">{session.userAgent ?? "<no user agent>"}</TableCell>
              <TableCell>
                <Sensitive fallback="0.0.0.0">{session.ip ?? "<no ip>"}</Sensitive>
              </TableCell>
              <TableCell>
                <Show when={data().sessionId !== session.id} fallback="current">
                  <Button
                    onClick={async () => {
                      await revokeSession({ data: { sessionId: session.id } });
                      await router.invalidate({
                        filter: (match) => match.routeId === Route.id,
                      });
                    }}
                    variant="destructive"
                    size="sm"
                  >
                    [ revoke ]
                  </Button>
                </Show>
              </TableCell>
            </TableRow>
          )}
        </For>
      </TableBody>
    </Table>
  );
}

function Passkeys() {
  const beginRegistration = useServerFn(beginPasskeyRegistrationFn);
  const finishRegistration = useServerFn(finishPasskeyRegistrationFn);
  const [isRegistrationPending, setIsRegistrationPending] = createSignal(false);
  const router = useRouter();

  return (
    <Card>
      <CardHeader>
        <CardTitle>passkeys</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <PasskeysTable />
        <Button
          class="w-min"
          type="button"
          disabled={isRegistrationPending()}
          onClick={async () => {
            setIsRegistrationPending(true);
            try {
              const { ceremonyId, options } = await beginRegistration();
              const credentialResult = await registerPasskey(options);
              if (!credentialResult.ok) {
                throw new Error("Could not create a passkey credential", {
                  cause: credentialResult.error,
                });
              }
              await finishRegistration({
                data: { ceremonyId, credential: credentialResult.value },
              });
              await router.invalidate({
                filter: (match) => match.routeId === Route.id,
              });
            } finally {
              setIsRegistrationPending(false);
            }
          }}
        >
          {isRegistrationPending() ? "..." : "[ create passkey ]"}
        </Button>
      </CardContent>
    </Card>
  );
}
function PasskeysTable() {
  const data = Route.useLoaderData();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>created at</TableHead>
          <TableHead>backed up</TableHead>
          <TableHead>backup eligible</TableHead>
          <TableHead>sign count</TableHead>
          <TableHead>transports</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <For each={data().passkeys}>
          {(passkey) => (
            <TableRow>
              <TableCell>{passkey.createdAt.toLocaleString()}</TableCell>
              <TableCell>{passkey.backedUp ? "yes" : "no"}</TableCell>
              <TableCell>{passkey.backupEligible ? "yes" : "no"}</TableCell>
              <TableCell>{passkey.signCount}</TableCell>
              <TableCell>{passkey.transports.join(", ")}</TableCell>
            </TableRow>
          )}
        </For>
      </TableBody>
    </Table>
  );
}
