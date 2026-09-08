import { FieldApi, FormApi, revalidateLogic } from "@tanstack/solid-form";
import * as v from "valibot";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { PasswordValidator, UsernameValidator } from "@/modules/auth/validators";

afterEach(() => {
  vi.useRealTimers();
});

test("debounces availability before submit while keeping password validation dynamic", async () => {
  vi.useFakeTimers();
  const onSubmit = vi.fn();
  const form = new FormApi({
    defaultValues: { username: "", password: "" },
    validationLogic: revalidateLogic(),
    onSubmit,
  });
  const unmountForm = form.mount();
  const validate = vi.fn(async ({ value }: { value: string }) =>
    value === "admin" ? "Username is already taken" : undefined,
  );
  const field = new FieldApi({
    form,
    name: "username",
    validators: {
      onChange: UsernameValidator,
      onChangeAsync: validate,
      onChangeAsyncDebounceMs: 300,
    },
  });
  const unmountField = field.mount();
  const password = new FieldApi({
    form,
    name: "password",
    validators: { onDynamic: PasswordValidator },
  });
  const unmountPassword = password.mount();

  try {
    field.handleChange("admin");
    password.handleChange("short");
    await vi.advanceTimersByTimeAsync(299);
    expect(validate).not.toHaveBeenCalled();
    expect(field.state.meta.errors).toEqual([]);
    expect(password.state.meta.errors).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(field.state.meta.errors).toEqual(["Username is already taken"]);

    const submission = form.handleSubmit();
    await vi.runAllTimersAsync();
    await submission;
    expect(validate).toHaveBeenCalledTimes(1);
    expect(field.state.meta.errors).toEqual(["Username is already taken"]);
    expect(onSubmit).not.toHaveBeenCalled();
    password.handleChange("short2");
    expect(password.state.meta.errors[0]).toMatchObject({
      message: "password must have at least 8 characters",
    });

    field.handleChange("a");
    await vi.runAllTimersAsync();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(field.state.meta.errors[0]).toMatchObject({
      message: "username must have at least 3 characters",
    });

    field.handleChange("available");
    await vi.advanceTimersByTimeAsync(200);
    field.handleChange("available2");
    await vi.advanceTimersByTimeAsync(299);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(field.state.meta.isValidating).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(field.state.meta.errors).toEqual([]);
    expect(field.state.meta.isValidating).toBe(false);
    password.handleChange("password123");
    expect(password.state.meta.errors).toEqual([]);

    const resubmission = form.handleSubmit();
    await vi.runAllTimersAsync();
    await resubmission;
    expect(validate).toHaveBeenCalledTimes(3);
    expect(onSubmit).toHaveBeenCalledOnce();
  } finally {
    unmountPassword();
    unmountField();
    unmountForm();
  }
});

test("reports username validation with the signup form schema while typing and clearing", async () => {
  vi.useFakeTimers();
  const form = new FormApi({
    defaultValues: { username: "", password: "", passwordConfirm: "" },
    validators: {
      onChange: v.object({
        username: UsernameValidator,
        password: PasswordValidator,
        passwordConfirm: PasswordValidator,
      }),
    },
  });
  const unmountForm = form.mount();
  const validate = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return undefined;
  });
  const field = new FieldApi({
    form,
    name: "username",
    validators: { onChangeAsync: validate, onChangeAsyncDebounceMs: 300 },
  });
  const unmountField = field.mount();
  try {
    for (const username of ["a", "ad", "adm", "admi", "admin"]) {
      field.handleChange(username);
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(field.state.meta.isValidating).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(field.state.meta.isValidating).toBe(false);
    for (const username of ["admi", "adm", "ad", "a", "", "a", "as", "asd", "asdf"]) {
      field.handleChange(username);
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(field.state.meta.isValidating).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(field.state.meta.isValidating).toBe(false);
    expect(field.state.meta.errors).toEqual([]);
  } finally {
    unmountField();
    unmountForm();
  }
});

// Regression for https://github.com/TanStack/form/issues/2372 and our pnpm patch.
test("reports pending async validation again after a failed validation", async () => {
  vi.useFakeTimers();
  const form = new FormApi({ defaultValues: { username: "" } });
  const unmountForm = form.mount();
  const validate = vi.fn(async ({ value }: { value: string }) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return value === "admin" ? "Username is already taken" : undefined;
  });
  const field = new FieldApi({
    form,
    name: "username",
    validators: {
      onChange: ({ value }) => (value.length < 3 ? "Username is too short" : undefined),
      onChangeAsync: validate,
      onChangeAsyncDebounceMs: 300,
    },
  });
  const unmountField = field.mount();

  try {
    field.handleChange("admin");
    await vi.advanceTimersByTimeAsync(300);
    expect(field.state.meta.isValidating).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(field.state.meta.isValidating).toBe(false);
    expect(field.state.meta.errors).toEqual(["Username is already taken"]);

    field.handleChange("");
    expect(field.state.meta.errors).toEqual(["Username is too short"]);
    field.handleChange("asdf");
    await vi.advanceTimersByTimeAsync(300);
    expect(field.state.meta.isValidating).toBe(true);
    expect(form.state.isFieldsValidating).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(field.state.meta.isValidating).toBe(false);
    expect(form.state.isFieldsValidating).toBe(false);
    expect(field.state.meta.errors).toEqual([]);
    expect(validate).toHaveBeenCalledTimes(2);
  } finally {
    unmountField();
    unmountForm();
  }
});

test.each([100, 400])("keeps validation pending when input changes after %i ms", async (delay) => {
  vi.useFakeTimers();
  const form = new FormApi({ defaultValues: { username: "" } });
  const unmountForm = form.mount();
  const validate = vi.fn(async ({ value }: { value: string }) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return value === "admin" ? "Username is already taken" : undefined;
  });
  const field = new FieldApi({
    form,
    name: "username",
    validators: { onChangeAsync: validate, onChangeAsyncDebounceMs: 300 },
  });
  const unmountField = field.mount();

  try {
    field.handleChange("admin");
    await vi.advanceTimersByTimeAsync(delay);
    field.handleChange("asdf");
    await vi.advanceTimersByTimeAsync(300);
    expect(field.state.meta.isValidating).toBe(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(field.state.meta.isValidating).toBe(true);
    expect(field.state.meta.errors).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(field.state.meta.isValidating).toBe(false);
    expect(field.state.meta.errors).toEqual([]);
    expect(validate).toHaveBeenCalledTimes(delay < 300 ? 1 : 2);
  } finally {
    unmountField();
    unmountForm();
  }
});
