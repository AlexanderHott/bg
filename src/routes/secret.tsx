import { createFileRoute } from "@tanstack/solid-router";
import { getSecretData } from "../modules/auth/lib/auth";

export const Route = createFileRoute("/secret")({
  component: RouteComponent,
  loader: async () => {
    const data = await getSecretData();
    console.log("route loader", data);
    return data;
  },
});

function RouteComponent() {
  const data = Route.useLoaderData();
  return <div>Hello "/secret"! {data()}</div>;
}
