import { SignInForm as LoginForm } from "@/modules/auth/components/SignInForm";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/_auth/sign-in")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div class="h-full flex items-center justify-center">
      <div class="max-w-sm grow">
        <LoginForm />
      </div>
    </div>
  );
}
