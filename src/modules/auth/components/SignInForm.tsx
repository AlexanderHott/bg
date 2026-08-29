import { createForm, formOptions } from "@tanstack/solid-form";
import { Link, useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal } from "solid-js";
import * as v from "valibot";

import { Button } from "@/components/ui/Button";
import { Separator } from "@/components/ui/Separator";
import {
  TextField,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from "@/components/ui/TextField";

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
      await signIn({
        data: {
          username: value.username,
          password: value.password,
        },
      });
      await navigate({ to: "/" });
    },
    validators: {
      onChange: v.object({
        username: UsernameValidator,
        password: PasswordValidator,
      }),
    },
  }));

  return (
    <div class="flex max-w-sm flex-col gap-4">
      <div>sign in</div>
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
            <TextField
              validationState={
                field().state.meta.isTouched && field().state.meta.errors.length > 0
                  ? "invalid"
                  : "valid"
              }
            >
              <TextFieldLabel>username</TextFieldLabel>
              <TextFieldInput
                type="text"
                autocomplete="username webauthn"
                name={field().name}
                value={field().state.value}
                onBlur={field().handleBlur}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  field().handleChange(value);
                }}
              />
              <TextFieldErrorMessage>
                {field()
                  .state.meta.errors.map((e) => (typeof e === "string" ? e : e?.message))
                  .join(", ")}
              </TextFieldErrorMessage>
            </TextField>
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <TextField
              validationState={
                field().state.meta.isTouched && field().state.meta.errors.length > 0
                  ? "invalid"
                  : "valid"
              }
            >
              <TextFieldLabel>password</TextFieldLabel>
              <TextFieldInput
                type="password"
                autocomplete="current-password"
                name={field().name}
                value={field().state.value}
                onBlur={field().handleBlur}
                onInput={(e) => field().handleChange(e.currentTarget.value)}
              />
              <TextFieldErrorMessage>
                {field()
                  .state.meta.errors.map((e) => e?.message)
                  .join(", ")}
              </TextFieldErrorMessage>
            </TextField>
          )}
        />

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
          children={(state) => {
            return (
              <Button type="submit" disabled={!state().canSubmit}>
                {state().isSubmitting ? "..." : "[ sign in ]"}
              </Button>
            );
          }}
        />
      </form>

      <Separator />

      <Button
        type="button"
        variant="secondary"
        disabled={isPasskeyPending()}
        onClick={async () => {
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
            await navigate({ to: "/" });
          } finally {
            setIsPasskeyPending(false);
          }
        }}
      >
        {isPasskeyPending() ? "..." : "[ use passkey ]"}
      </Button>

      <p class="text-muted-foreground text-sm">
        don't have an account?{" "}
        <Link class="underline" to="/sign-up">
          sign up
        </Link>
      </p>
    </div>
  );
}
