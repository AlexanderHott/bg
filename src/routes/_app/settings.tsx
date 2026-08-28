import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { For, Show } from "solid-js";

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
import { listActiveSessionsFn, revokeSessionFn } from "@/modules/auth/serverFunctions";

export const Route = createFileRoute("/_app/settings")({
  component: RouteComponent,
  loader: async ({ context: { sessionId } }) => {
    const activeSessions = await listActiveSessionsFn();
    return { activeSessions, sessionId };
  },
});

function RouteComponent() {
  return (
    <div class="flex flex-col p-4">
      <ActiveSessions />
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
