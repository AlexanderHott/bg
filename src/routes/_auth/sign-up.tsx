import { createFileRoute } from "@tanstack/solid-router";

import { SignupForm } from "@/modules/auth/components/SignUpForm";

export const Route = createFileRoute("/_auth/sign-up")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div class="flex h-full items-center justify-center">
      <div class="max-w-sm grow">
        <SignupForm />
      </div>
    </div>
  );
}
