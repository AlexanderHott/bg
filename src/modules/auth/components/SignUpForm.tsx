import { createForm, formOptions, revalidateLogic } from "@tanstack/solid-form";
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

import {
  FormSubmitButton,
  FormTextField,
  selectSubmissionState,
} from "@/components/forms/FormControls";
import { buttonVariants } from "@/components/ui/Button";
import { destinationAfterAuth, inviteTokenFromHash } from "@/modules/organizations/inviteToken";

import { isUsernameAvailableFn, signUpFn } from "../serverFunctions";
import { PasswordValidator, UsernameValidator } from "../validators";

interface SignupFormData {
  username: string;
  password: string;
  passwordConfirm: string;
}

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

  const formOpts = formOptions({
    defaultValues: {
      username: "",
      password: "",
      passwordConfirm: "",
    } satisfies SignupFormData,
  });
  const form = createForm(() => ({
    ...formOpts,
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
  }));

  const canSubmit = form.useSelector((state) => state.canSubmit);
  const submitHotkey = { mod: true, key: "Enter" } satisfies RegisterableHotkey;
  createHotkey(
    submitHotkey,
    () => form.handleSubmit(),
    () => ({ enabled: canSubmit() && !accountCreated() }),
  );

  const signInHotkeySequence = ["S", "I"] satisfies HotkeySequence;
  createHotkeySequence(signInHotkeySequence, () => navigate({ to: "/sign-in", hash: invite() }));

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
            <form.Field
              name="username"
              validators={{
                onChange: UsernameValidator,
                onChangeAsync: async ({ value, signal }) => {
                  setAvailableUsername(undefined);
                  try {
                    const available = await isUsernameAvailable({
                      data: { username: value },
                      signal,
                    });
                    if (signal.aborted) return undefined;
                    if (available) setAvailableUsername(value);
                    return available ? undefined : "Username is already taken";
                  } catch {
                    if (signal.aborted) return undefined;
                    return "could not check username availability";
                  }
                },
                onChangeAsyncDebounceMs: 300,
              }}
              children={(field) => (
                <FormTextField
                  label="username"
                  type="text"
                  field={field}
                  validatingMessage="Checking username..."
                  successMessage={
                    availableUsername() === field().state.value ? "Username available" : undefined
                  }
                />
              )}
            />

            <form.Field
              name="password"
              validators={{ onDynamic: PasswordValidator }}
              children={(field) => <FormTextField label="password" type="password" field={field} />}
            />

            <form.Field
              name="passwordConfirm"
              validators={{ onDynamic: PasswordValidator }}
              children={(field) => (
                <FormTextField label="confirm password" type="password" field={field} />
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
        }
      >
        <p>Your account is ready. Sign in to continue.</p>
      </Show>

      <p class="text-muted-foreground text-sm">
        already have an account?{" "}
        <Link class={buttonVariants({ variant: "link" })} to="/sign-in" hash={invite()}>
          sign in · {formatHotkeySequence(signInHotkeySequence).toLocaleLowerCase()}
        </Link>
      </p>
    </div>
  );
}
