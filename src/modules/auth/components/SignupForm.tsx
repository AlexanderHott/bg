import { useServerFn } from "@tanstack/solid-start";
import { createSignal, Show } from "solid-js";
import { logIn, signUp } from "../lib/auth";
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
import { Kbd } from "@/components/ui/Kbd";
import { Link } from "@tanstack/solid-router";

interface SignupFormData {
  username: string;
  password: string;
  passwordConfirm: string;
}

const usernameSchema = v.pipe(
  v.string(),
  v.minLength(3, "Username must be at least 3 characters"),
  v.maxLength(32, "Username cannot be more than 32 characters"),
);

export function SignupForm() {
  const signUpFn = useServerFn(signUp);
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
      await signUpFn({
        data: {
          username: value.username,
          password: value.password,
        },
      });
    },
    validators: {
      onChange: v.object({
        username: usernameSchema,
        password: v.pipe(v.string(), v.minLength(8), v.maxLength(64)),
        passwordConfirm: v.pipe(v.string(), v.minLength(8), v.maxLength(64)),
      }),
    },
  }));

  return (
    <div class="flex flex-col gap-4 max-w-sm">
      <div>Sign Up</div>
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

                return value === "asdfasdf" ? "Username taken" : undefined;
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
              <TextFieldLabel>Username</TextFieldLabel>
              <TextFieldInput
                type="text"
                name={field().name}
                value={field().state.value}
                onBlur={field().handleBlur}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  usernameValidationVersion += 1;
                  setIsUsernameValidationPending(v.safeParse(usernameSchema, value).success);
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
              <TextFieldLabel>Confirm Password</TextFieldLabel>
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

        {/*<input
        class="bg-gray-300 max-w-64"
        value={username()}
        onInput={(e) => setUsername(e.target.value)}
        type="text"
      />
      <input
        class="bg-gray-300 max-w-64"
        value={password()}
        onInput={(e) => setPassword(e.target.value)}
        type="password"
      />
      <input class="bg-gray-300 max-w-64" type="password" />*/}
        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
          children={(state) => {
            return (
              <Button type="submit" disabled={!state().canSubmit}>
                {state().isSubmitting ? "..." : "Sign Up"}
              </Button>
            );
          }}
        />
      </form>

      <p class="text-muted-foreground text-sm">
        Already have an account?{" "}
        <Link class="underline" to="/login">
          Login
        </Link>
      </p>
    </div>
  );
}

interface LoginFormData {
  username: string;
  password: string;
}

export function LoginForm() {
  const logInFn = useServerFn(logIn);

  const formOpts = formOptions({
    defaultValues: {
      username: "",
      password: "",
    } satisfies LoginFormData,
  });
  const form = createForm(() => ({
    ...formOpts,
    onSubmit: async ({ value }) => {
      await logInFn({
        data: {
          username: value.username,
          password: value.password,
        },
      });
    },
    validators: {
      onChange: v.object({
        username: usernameSchema,
        password: v.pipe(v.string(), v.minLength(8), v.maxLength(64)),
      }),
    },
  }));

  return (
    <div class="flex flex-col gap-4 max-w-sm">
      <div>Log In</div>
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
