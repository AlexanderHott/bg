import { describe, expect, test } from "vite-plus/test";

import { validateSession, type ValidateSessionOptions } from "./sessions";

describe("validateSession", () => {
  const table = [
    {
      name: "valid session token and session",
      options: {
        secret: "secret-123",
        secretHash: "x_27iTnZ1koPymdnuBhsiD8Txq4Vqfrz8SghTJJThIw=",
        expiresAt: new Date(1_888_888_888_888),
        now: new Date(1_777_777_777_777),
      },
      isValid: true,
    },

    {
      name: "expired session",
      options: {
        secret: "secret-123",
        secretHash: "x_27iTnZ1koPymdnuBhsiD8Txq4Vqfrz8SghTJJThIw=",
        expiresAt: new Date(1_666_666_666_666),
        now: new Date(1_777_777_777_777),
      },
      isValid: false,
    },
    {
      name: "secrets dont match",
      options: {
        secret: "something-else",
        secretHash: "x_27iTnZ1koPymdnuBhsiD8Txq4Vqfrz8SghTJJThIw=",
        expiresAt: new Date(1_888_888_888_888),
        now: new Date(1_777_777_777_777),
      },
      isValid: false,
    },
  ] satisfies Array<{
    name: string;
    options: ValidateSessionOptions;
    isValid: boolean;
  }>;

  test.each(table)("$name: $options is $isValid", async ({ options, isValid }) => {
    expect(await validateSession(options)).toBe(isValid);
  });
});
