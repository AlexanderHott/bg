import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";

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
  return <Outlet />;
}
