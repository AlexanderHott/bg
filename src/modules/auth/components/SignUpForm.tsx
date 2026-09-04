import { createForm, formOptions } from "@tanstack/solid-form";
import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal, Show } from "solid-js";
import * as v from "valibot";

import { Button } from "@/components/ui/Button";
import {
  TextField,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from "@/components/ui/TextField";

import { signUpFn } from "../serverFunctions";
import { PasswordValidator, UsernameValidator } from "../validators";

interface SignupFormData {
  username: string;
  password: string;
  passwordConfirm: string;
}

export function SignupForm() {
  const signUp = useServerFn(signUpFn);
  const [isUsernameValidationPending, setIsUsernameValidationPending] = createSignal(false);
  let usernameValidationVersion = 0;

  const formOpts = formOptions({
    defaultValues: {
      username: "",
      password: "",
      passwordConfirm: "",
    } satisfies SignupFormData,
  });
  const form = createForm(() => ({
    ...formOpts,
    onSubmit: async ({ value }) => {
      await signUp({
        data: {
          username: value.username,
          password: value.password,
        },
      });
    },
    validators: {
      onChange: v.object({
        username: UsernameValidator,
        password: PasswordValidator,
        passwordConfirm: PasswordValidator,
      }),
    },
  }));

  return (
    <div class="flex max-w-sm flex-col gap-4">
      <div>sign up</div>
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
            onChangeAsync: async ({ value }) => {
              const validationVersion = usernameValidationVersion;

              try {
                await new Promise((resolve) => setTimeout(resolve, 500));

                // return value === "asdfasdf" ? "Username taken" : undefined;
                return undefined;
              } finally {
                if (validationVersion === usernameValidationVersion) {
                  setIsUsernameValidationPending(false);
                }
              }
            },
            onChangeAsyncDebounceMs: 300,
          }}
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
                name={field().name}
                value={field().state.value}
                onBlur={field().handleBlur}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  usernameValidationVersion += 1;
                  setIsUsernameValidationPending(v.safeParse(UsernameValidator, value).success);
                  field().handleChange(value);
                }}
              />
              {/* @tanstack/form-core@1.33.5 does not restore isValidating after the first debounced run. */}
              <Show when={isUsernameValidationPending()}>
                <div role="status">Checking username...</div>
              </Show>
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

        <form.Field
          name="passwordConfirm"
          children={(field) => (
            <TextField
              validationState={
                field().state.meta.isTouched && field().state.meta.errors.length > 0
                  ? "invalid"
                  : "valid"
              }
            >
              <TextFieldLabel>confirm password</TextFieldLabel>
              <TextFieldInput
                type="password"
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
                {state().isSubmitting ? "..." : "[ sign up ]"}
              </Button>
            );
          }}
        />
      </form>

      <p class="text-muted-foreground text-sm">
        already have an account?{" "}
        <Link class="underline" to="/sign-in">
          login
        </Link>
      </p>
    </div>
  );
}
