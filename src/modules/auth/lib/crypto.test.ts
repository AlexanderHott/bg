import { describe, expect, it, test } from "vite-plus/test";

import { argon2Hash, argon2Verify, constantTimeCompare, secureRandomBytes } from "./crypto";

describe("secureRandomBytes", () => {
  it("produces the correct length array", () => {
    const length = 32;
    const buffer = secureRandomBytes(length);
    expect(buffer.length).toBe(length);
  });
});

describe("constantTimeCompare", () => {
  const table = [
    {
      name: "equal arrays",
      a: new Uint8Array([1, 2, 3]),
      b: new Uint8Array([1, 2, 3]),
      isEqual: true,
    },
    {
      name: "different arrays",
      a: new Uint8Array([1, 2, 3]),
      b: new Uint8Array([1, 2, 4]),
      isEqual: false,
    },
    {
      name: "different lengths",
      a: new Uint8Array([1, 2, 3]),
      b: new Uint8Array([1, 2, 3, 4]),
      isEqual: false,
    },
  ] satisfies Array<{
    name: string;
    a: Uint8Array;
    b: Uint8Array;
    isEqual: boolean;
  }>;

  test.each(table)("$name: eq($a, $b) === $isEqual", ({ a, b, isEqual }) => {
    expect(constantTimeCompare(a, b)).toBe(isEqual);
  });
});

describe("argon2", () => {
  it("verifies correctly", async () => {
    const password = "admin";
    const digest = await argon2Hash(password);
    expect(await argon2Verify(digest, password)).toBe(true);
  });
});
