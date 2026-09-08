import { createForm, formOptions } from "@tanstack/solid-form";
import {
  createHotkey,
  createHotkeySequence,
  formatForDisplay,
  formatHotkeySequence,
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
  selectSubmissionState,
} from "@/components/forms/FormControls";
import { Button } from "@/components/ui/Button";
import { Separator } from "@/components/ui/Separator";
import { destinationAfterAuth, inviteTokenFromHash } from "@/modules/organizations/inviteToken";

import { authenticateWithPasskey } from "../lib/webauthn/browser";
import { beginPasskeyAuthFn, finishPasskeyAuthFn, signInFn } from "../serverFunctions";
import { PasswordValidator, UsernameValidator } from "../validators";

interface LoginFormData {
  username: string;
  password: string;
}

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

  const formOpts = formOptions({
    defaultValues: {
      username: "",
      password: "",
    } satisfies LoginFormData,
  });
  const form = createForm(() => ({
    ...formOpts,
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
  }));

  const canSubmit = form.useSelector((state) => state.canSubmit);
  const submitHotkey = { mod: true, key: "Enter" } satisfies RegisterableHotkey;
  createHotkey(
    submitHotkey,
    () => form.handleSubmit(),
    () => ({ enabled: canSubmit() }),
  );

  const signUpHotkeySequence = ["S", "U"] satisfies HotkeySequence;
  createHotkeySequence(signUpHotkeySequence, () => navigate({ to: "/sign-up" }));

  async function signInWithPasskey() {
    console.log("passkey");
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
        <form.Field
          name="username"
          children={(field) => (
            <FormTextField
              label="username"
              type="text"
              autocomplete="username webauthn"
              field={field}
            />
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <FormTextField
              label="password"
              type="password"
              autocomplete="current-password"
              field={field}
            />
          )}
        />

        <form.Subscribe
          selector={selectSubmissionState}
          children={(state) => (
            <FormSubmitButton {...state()}>
              sign up · {formatForDisplay(submitHotkey).toLocaleLowerCase()}
            </FormSubmitButton>
          )}
        />
      </form>

      <Separator />

      <Button
        type="button"
        variant="secondary"
        disabled={isPasskeyPending()}
        onClick={signInWithPasskey}
      >
        {isPasskeyPending()
          ? "..."
          : `use passkey · ${formatForDisplay(passkeyHotkey).toLocaleLowerCase()}`}
      </Button>

      <p class="text-muted-foreground text-sm">
        don't have an account?{" "}
        <Button variant="link" as={(props) => <Link to="/sign-up" hash={invite()} {...props} />}>
          sign up · {formatHotkeySequence(signUpHotkeySequence).toLocaleLowerCase()}
        </Button>
      </p>
    </div>
  );
}
