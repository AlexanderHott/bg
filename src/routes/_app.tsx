import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";

import { Button } from "@/components/ui/Button";
import { getSessionFn, signOutFn } from "@/modules/auth/serverFunctions";

export const Route = createFileRoute("/_app")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await getSessionFn();
    if (!session) {
      throw redirect({ to: "/sign-in" });
    }

    return {
      userId: session.userId,
      sessionId: session.sessionId,
    };
  },
});

function RouteComponent() {
  const signOut = useServerFn(signOutFn);
  const navigate = useNavigate();
  return (
    <div>
      <nav class="flex items-center justify-between p-4">
        <div class="flex items-center gap-4">
          <Link class="underline" to="/">
            home
          </Link>
          <Link class="underline" to="/download" params={(old) => old}>
            download
          </Link>
          <Link class="underline" to="/settings" params={(old) => old}>
            settings
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
