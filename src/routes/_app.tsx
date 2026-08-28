import { Button } from "@/components/ui/Button";
import { getSessionFn, signOutFn } from "@/modules/auth/serverFunctions";
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";

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
      <nav class="p-4 flex items-center justify-between">
        <div class="flex gap-4 items-center ">
          <Link class="underline" to="/">
            home
          </Link>
          <Link class="underline" to="/download">
            download
          </Link>
          <Link class="underline" to="/settings">
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
