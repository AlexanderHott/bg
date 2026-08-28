import { LoginForm } from "@/modules/auth/components/SignupForm";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/login")({
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
