import { useServerFn } from "@tanstack/solid-start";
import { signInFn } from "../serverFunctions";
import { Button } from "@/components/ui/Button";
import {
  TextField,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from "@/components/ui/TextField";
import { createForm, formOptions } from "@tanstack/solid-form";
import * as v from "valibot";
import { Separator } from "@/components/ui/Separator";
import { Link, useNavigate } from "@tanstack/solid-router";
import { PasswordValidator, UsernameValidator } from "../validators";

interface LoginFormData {
  username: string;
  password: string;
}

export function SignInForm() {
  const signIn = useServerFn(signInFn);
  const navigate = useNavigate();

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
    <div class="flex flex-col gap-4 max-w-sm">
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
              <TextFieldLabel>Username</TextFieldLabel>
              <TextFieldInput
                type="text"
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
              <TextFieldLabel>Password</TextFieldLabel>
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
                {state().isSubmitting ? "..." : "[ login ]"}
              </Button>
            );
          }}
        />
      </form>

      <Separator />

      <Button type="submit" variant="secondary" disabled>
        [ use passkey ]
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
