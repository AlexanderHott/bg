import { FieldApi, FormApi } from "@tanstack/form-core";
import {
  createHotkey,
  type HotkeySequence,
  type RegisterableHotkey,
} from "@tanstack/solid-hotkeys";
import { Link, useLocation, useNavigate, useRouter } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal, Show } from "solid-js";
import * as v from "valibot";

import {
  FormSubmitButton,
  FormTextField,
  createFormSubmission,
  SUBMIT_HOTKEY,
} from "@/components/forms/FormControls";
import { Button, buttonVariants } from "@/components/ui/Button";
import { HotkeyHint } from "@/components/ui/HotkeyHint";
import { Separator } from "@/components/ui/Separator";
import { useField, useForm } from "@/lib/form";
import { destinationAfterAuth, inviteTokenFromHash } from "@/modules/organizations/inviteToken";

import { authenticateWithPasskey } from "../lib/webauthn/browser";
import { beginPasskeyAuthFn, finishPasskeyAuthFn, signInFn } from "../serverFunctions";
import { PasswordValidator, UsernameValidator } from "../validators";

export function SignInForm() {
  const signIn = useServerFn(signInFn);
  const navigate = useNavigate();
  const router = useRouter();
  const location = useLocation();
  const invite = () => inviteTokenFromHash(location().hash);
  const [error, setError] = createSignal<string>();
  async function finishSignIn() {
    await router.invalidate();
    await navigate(destinationAfterAuth(invite()));
  }

  const beginPasskeyAuth = useServerFn(beginPasskeyAuthFn);
  const finishPasskeyAuth = useServerFn(finishPasskeyAuthFn);
  const [isPasskeyPending, setIsPasskeyPending] = createSignal(false);

  const form = useForm(
    new FormApi({
      defaultValues: { username: "", password: "" },
      onSubmit: async ({ value }) => {
        setError(undefined);
        try {
          await signIn({ data: { username: value.username, password: value.password } });
          await finishSignIn();
        } catch {
          setError("Could not sign in. Check your username and password and try again.");
        }
      },
      validators: {
        onChange: v.object({
          username: UsernameValidator,
          password: PasswordValidator,
        }),
      },
    }),
  );
  const username = useField(new FieldApi({ form, name: "username" }));
  const password = useField(new FieldApi({ form, name: "password" }));
  const submission = createFormSubmission(form, (s) => ({ enabled: s.canSubmit }));

  const signUpHotkeySequence = ["S", "U"] satisfies HotkeySequence;
  createHotkey(signUpHotkeySequence, () => navigate({ to: "/sign-up", hash: invite() }));

  // Signal reads lag writes until Solid flushes, so the guard needs a plain flag.
  let passkeyInFlight = false;
  async function signInWithPasskey() {
    if (passkeyInFlight) return;
    passkeyInFlight = true;
    setError(undefined);
    setIsPasskeyPending(true);
    try {
      const { ceremonyId, options } = await beginPasskeyAuth();
      const credentialResult = await authenticateWithPasskey(options);
      if (!credentialResult.ok) {
        throw new Error("Could not get a passkey credential", {
          cause: credentialResult.error,
        });
      }
      await finishPasskeyAuth({
        data: { ceremonyId, credential: credentialResult.value },
      });
      await finishSignIn();
    } catch {
      setError("Could not sign in with your passkey. Try again or use your password.");
    } finally {
      passkeyInFlight = false;
      setIsPasskeyPending(false);
    }
  }

  const passkeyHotkey = { key: "P" } satisfies RegisterableHotkey;
  createHotkey(passkeyHotkey, () => signInWithPasskey());

  return (
    <div class="flex max-w-sm flex-col gap-4">
      <div>sign in</div>
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
        class="flex flex-col gap-4"
      >
        <FormTextField
          label="username"
          type="text"
          autocomplete="username webauthn"
          field={username()}
        />
        <FormTextField
          label="password"
          type="password"
          autocomplete="current-password"
          field={password()}
        />
        <FormSubmitButton {...submission()}>
          sign in
          <HotkeyHint hotkey={SUBMIT_HOTKEY} />
        </FormSubmitButton>
      </form>

      <Separator />

      <Button
        type="button"
        variant="secondary"
        disabled={isPasskeyPending()}
        onClick={signInWithPasskey}
      >
        <Show when={!isPasskeyPending()} fallback="...">
          use passkey
          <HotkeyHint hotkey={passkeyHotkey} />
        </Show>
      </Button>

      <p class="text-muted-foreground text-sm">
        don't have an account?{" "}
        <Link class={buttonVariants({ variant: "link" })} to="/sign-up" hash={invite()}>
          sign up
          <HotkeyHint hotkey={signUpHotkeySequence} />
        </Link>
      </p>
    </div>
  );
}
