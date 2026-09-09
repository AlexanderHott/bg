import { createFileRoute, Link } from "@tanstack/solid-router";
import { ArrowUpRight } from "lucide-solid";

export const Route = createFileRoute("/_app/$orgSlug/")({
  component: RouteComponent,
});

function RouteComponent() {
  const context = Route.useRouteContext();

  return (
    <section class="flex flex-col gap-6">
      <h1 class="text-2xl font-semibold">tools</h1>

      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/$orgSlug/remove-background"
          params={{ orgSlug: context().organization.slug }}
          class="group bg-card text-card-foreground focus-visible:outline-ring overflow-hidden rounded-xl border transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <div class="transparency-grid relative overflow-hidden border-b" aria-hidden="true">
            <svg viewBox="0 0 480 320" fill="none" class="block w-full">
              <path fill="#e7e4ee" d="M0 0h240v320H0z" />
              <circle cx="199" cy="148" r="82" fill="#9b87de" />
              <rect
                x="226"
                y="102"
                width="126"
                height="142"
                rx="24"
                transform="rotate(18 289 173)"
                fill="#ed896d"
              />
              <rect
                x="134"
                y="204"
                width="174"
                height="58"
                rx="29"
                transform="rotate(-16 221 233)"
                fill="#eed589"
              />
              <path d="M240 0v320" stroke="white" stroke-width="2" />
            </svg>
          </div>

          <div class="p-5">
            <div class="flex items-center justify-between gap-3">
              <h2 class="font-medium">remove background</h2>
              <ArrowUpRight
                aria-hidden="true"
                class="text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground size-4 shrink-0"
              />
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}
