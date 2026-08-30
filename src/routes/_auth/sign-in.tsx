import { createFileRoute } from "@tanstack/solid-router";

import { SignInForm as LoginForm } from "@/modules/auth/components/SignInForm";

export const Route = createFileRoute("/_auth/sign-in")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div class="flex h-full items-center justify-center">
      <div class="max-w-sm grow">
        <LoginForm />
      </div>
    </div>
  );
}
