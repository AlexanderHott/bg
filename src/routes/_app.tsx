import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";

import { AppNavbar } from "@/components/AppNavbar";
import { createElementHeight } from "@/lib/createElementHeight";
import { getSessionFn } from "@/modules/auth/serverFunctions";

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
  const navbar = createElementHeight();

  return (
    <div
      class="bg-muted/30 min-h-screen"
      style={{ "--app-navbar-height": navbar.height() ?? "calc(3.5rem + 1px)" }}
    >
      <div ref={navbar.ref} class="sticky top-0 z-30">
        <AppNavbar />
      </div>
      <Outlet />
    </div>
  );
}
