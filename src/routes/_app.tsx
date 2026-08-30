import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";

import { AppNavbar } from "@/components/AppNavbar";
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
  return (
    <div class="bg-muted/30 min-h-screen">
      <AppNavbar />
      <Outlet />
    </div>
  );
}
