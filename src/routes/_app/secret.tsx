import { createFileRoute } from "@tanstack/solid-router";
import { getSecretDataFn } from "@/modules/auth/serverFunctions";

export const Route = createFileRoute("/_app/secret")({
  component: RouteComponent,
  loader: async () => {
    const data = await getSecretDataFn();
    console.log("route loader", data);
    return data;
  },
});

function RouteComponent() {
  const data = Route.useLoaderData();
  return <div>Hello "/secret"! {data()}</div>;
}
