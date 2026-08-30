import { Link, useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";

import { signOutFn } from "@/modules/auth/serverFunctions";

import { Button } from "./ui/Button";

export function AppNavbar() {
  const signOut = useServerFn(signOutFn);
  const navigate = useNavigate();

  return (
    <header class="bg-background border-b">
      <nav class="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div class="flex items-center gap-4">
          <Link class="font-semibold" to="/">
            bg
          </Link>
          <Link class="text-muted-foreground hover:text-foreground text-sm" to="/">
            organizations
          </Link>
          <Link class="text-muted-foreground hover:text-foreground text-sm" to="/settings">
            settings
          </Link>
        </div>

        <Button
          variant="secondary"
          onClick={async () => {
            await signOut();
            await navigate({ to: "/sign-in" });
          }}
        >
          [ sign out ]
        </Button>
      </nav>
    </header>
  );
}
