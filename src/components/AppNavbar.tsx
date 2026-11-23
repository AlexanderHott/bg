import { createHotkey, formatForDisplay, type HotkeySequence } from "@tanstack/solid-hotkeys";
import { useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";

import { signOutFn } from "@/modules/auth/serverFunctions";

import { Button } from "./ui/Button";
import { ButtonLink } from "./ui/ButtonLink";

export function AppNavbar() {
  const signOut = useServerFn(signOutFn);
  const navigate = useNavigate();

  async function signOutHandler() {
    await signOut();
    await navigate({ to: "/sign-in" });
  }
  const signOutHotkeySequence = ["S", "O"] satisfies HotkeySequence;
  const organizationsHotkeySequence = ["O", "L"] satisfies HotkeySequence;
  const createOrganizationHotkeySequence = ["O", "C"] satisfies HotkeySequence;
  const settingsHotkeySequence = ["G", "S"] satisfies HotkeySequence;
  createHotkey(signOutHotkeySequence, () => signOutHandler());
  createHotkey(organizationsHotkeySequence, () => navigate({ to: "/" }));
  createHotkey(createOrganizationHotkeySequence, () => navigate({ to: "/create-organization" }));
  createHotkey(settingsHotkeySequence, () => navigate({ to: "/settings" }));

  return (
    <header class="bg-background border-b">
      <nav
        aria-label="Application"
        class="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6"
      >
        <div class="flex items-center gap-3 sm:gap-4">
          <ButtonLink variant="link" class="font-semibold" to="/">
            bg · {formatForDisplay(organizationsHotkeySequence).toLocaleLowerCase()}
          </ButtonLink>
          <ButtonLink variant="link" to="/">
            organizations · {formatForDisplay(organizationsHotkeySequence).toLocaleLowerCase()}
          </ButtonLink>
          <ButtonLink variant="link" to="/settings">
            settings · {formatForDisplay(settingsHotkeySequence).toLocaleLowerCase()}
          </ButtonLink>
        </div>

        <Button variant="secondary" onClick={signOutHandler}>
          sign out · {formatForDisplay(signOutHotkeySequence).toLocaleLowerCase()}
        </Button>
      </nav>
    </header>
  );
}
