import { FieldApi, FormApi, revalidateLogic } from "@tanstack/form-core";
import { createHotkey, type HotkeySequence } from "@tanstack/solid-hotkeys";
import { Link, useLocation, useNavigate, useRouter } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal, Show } from "solid-js";

import {
  FormSubmitButton,
  FormTextField,
  createFormSubmission,
  SUBMIT_HOTKEY,
} from "@/components/forms/FormControls";
import { buttonVariants } from "@/components/ui/Button";
import { HotkeyHint } from "@/components/ui/HotkeyHint";
import { useField, useForm } from "@/lib/form";
import { destinationAfterAuth, inviteTokenFromHash } from "@/modules/organizations/inviteToken";

import { isUsernameAvailableFn, signUpFn } from "../serverFunctions";
import { PasswordValidator, UsernameValidator } from "../validators";

export function SignupForm() {
  const signUp = useServerFn(signUpFn);
  const isUsernameAvailable = useServerFn(isUsernameAvailableFn);
  const navigate = useNavigate();
  const router = useRouter();
  const location = useLocation();
  const invite = () => inviteTokenFromHash(location().hash);
  const [error, setError] = createSignal<string>();
  const [accountCreated, setAccountCreated] = createSignal(false);
  const [availableUsername, setAvailableUsername] = createSignal<string>();

  const form = useForm(
    new FormApi({
      defaultValues: { username: "", password: "", passwordConfirm: "" },
      validationLogic: revalidateLogic(),
      onSubmit: async ({ value }) => {
        if (accountCreated()) return;
        setError(undefined);
        if (value.password !== value.passwordConfirm) {
          setError("Passwords do not match.");
          return;
        }
        try {
          const result = await signUp({
            data: { username: value.username, password: value.password },
          });
          setAccountCreated(true);
          if (!result.signedIn) return;
          await router.invalidate();
          await navigate(destinationAfterAuth(invite()));
        } catch {
          setError(
            "Could not finish signing up. Try signing in if your account was already created.",
          );
        }
      },
    }),
  );
  const username = useField(
    new FieldApi({
      form,
      name: "username",
      validators: {
        onChange: UsernameValidator,
        onChangeAsync: async ({ value, signal }) => {
          setAvailableUsername(undefined);
          try {
            const available = await isUsernameAvailable({ data: { username: value }, signal });
            if (signal.aborted) return undefined;
            if (available) setAvailableUsername(value);
            return available ? undefined : "Username is already taken";
          } catch {
            if (signal.aborted) return undefined;
            return "could not check username availability";
          }
        },
        onChangeAsyncDebounceMs: 300,
      },
    }),
  );
  const password = useField(
    new FieldApi({ form, name: "password", validators: { onDynamic: PasswordValidator } }),
  );
  const passwordConfirm = useField(
    new FieldApi({ form, name: "passwordConfirm", validators: { onDynamic: PasswordValidator } }),
  );
  const submission = createFormSubmission(form, (s) => ({
    enabled: s.canSubmit && !accountCreated(),
  }));

  const signInHotkeySequence = ["S", "I"] satisfies HotkeySequence;
  createHotkey(signInHotkeySequence, () => navigate({ to: "/sign-in", hash: invite() }));

  return (
    <div class="flex max-w-sm flex-col gap-4">
      <div>sign up</div>
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <Show
        when={accountCreated()}
        fallback={
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
              field={username()}
              validatingMessage="Checking username..."
              successMessage={
                availableUsername() === username().state.value ? "Username available" : undefined
              }
            />
            <FormTextField label="password" type="password" field={password()} />
            <FormTextField label="confirm password" type="password" field={passwordConfirm()} />
            <FormSubmitButton {...submission()}>
              sign up
              <HotkeyHint hotkey={SUBMIT_HOTKEY} />
            </FormSubmitButton>
          </form>
        }
      >
        <p>Your account is ready. Sign in to continue.</p>
      </Show>

      <p class="text-muted-foreground text-sm">
        already have an account?{" "}
        <Link class={buttonVariants({ variant: "link" })} to="/sign-in" hash={invite()}>
          sign in
          <HotkeyHint hotkey={signInHotkeySequence} />
        </Link>
      </p>
    </div>
  );
}
