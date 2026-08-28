import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <div class="p-8">hi</div>;
}
