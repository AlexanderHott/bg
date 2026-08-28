import { getSessionFn } from "@/modules/auth/serverFunctions";
import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";

export const Route = createFileRoute("/_app")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await getSessionFn();
    if (!session) {
      throw redirect({ to: "/sign-in" });
      // throw new Error("Unauthorized");
    }
  },
});

function RouteComponent() {
  return <Outlet />;
}
