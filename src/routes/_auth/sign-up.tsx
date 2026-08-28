import { SignupForm } from "@/modules/auth/components/SignUpForm";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/_auth/sign-up")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div class="h-full flex items-center justify-center">
      <div class="max-w-sm grow">
        <SignupForm />
      </div>
    </div>
  );
}
