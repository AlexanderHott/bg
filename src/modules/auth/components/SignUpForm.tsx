import { createForm, formOptions } from "@tanstack/solid-form";
import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createSignal, Show } from "solid-js";
import * as v from "valibot";

import {
  FormSubmitButton,
  FormTextField,
  selectSubmissionState,
} from "@/components/forms/FormControls";

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
            onChangeAsync: async () => {
              const validationVersion = usernameValidationVersion;

              try {
                await new Promise((resolve) => setTimeout(resolve, 500));
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
            <FormTextField
              label="username"
              type="text"
              field={field}
              onInput={(value) => {
                usernameValidationVersion += 1;
                setIsUsernameValidationPending(v.safeParse(UsernameValidator, value).success);
                field().handleChange(value);
              }}
            >
              {/* @tanstack/form-core@1.33.5 does not restore isValidating after the first debounced run. */}
              <Show when={isUsernameValidationPending()}>
                <div role="status">Checking username...</div>
              </Show>
            </FormTextField>
          )}
        />

        <form.Field
          name="password"
          children={(field) => <FormTextField label="password" type="password" field={field} />}
        />

        <form.Field
          name="passwordConfirm"
          children={(field) => (
            <FormTextField label="confirm password" type="password" field={field} />
          )}
        />

        <form.Subscribe
          selector={selectSubmissionState}
          children={(state) => <FormSubmitButton label="sign up" {...state()} />}
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
