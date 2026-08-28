import { describe, expect, test } from "vite-plus/test";

import { formatSessionToken, parseSessionToken, type SessionToken } from "./sessionToken";

describe("formatSessionToken", () => {
  const table = [
    {
      input: {
        id: "id-123",
        secret: "secret-123",
      },
      expected: "id-123.secret-123",
    },
    {
      input: {
        id: "01a04a9b-e773-7727-ab2b-2567b8b4c49f",
        secret: "t9kKT6sKtxKDVeHlLZ2A5s_SgWMrO-4h7UqMt6AvaLM=",
      },
      expected:
        "01a04a9b-e773-7727-ab2b-2567b8b4c49f.t9kKT6sKtxKDVeHlLZ2A5s_SgWMrO-4h7UqMt6AvaLM%3D",
    },
  ] satisfies Array<{ input: SessionToken; expected: string }>;
  test.each(table)("$input", ({ input, expected }) => {
    expect(formatSessionToken(input)).toEqual(expected);
  });
});

describe("parseSessionToken", () => {
  const table = [
    {
      input: "id-123.secret-123",
      expected: {
        id: "id-123",
        secret: "secret-123",
      },
    },
    {
      input: "01a04a9b-e773-7727-ab2b-2567b8b4c49f.t9kKT6sKtxKDVeHlLZ2A5s_SgWMrO-4h7UqMt6AvaLM%3D",
      expected: {
        id: "01a04a9b-e773-7727-ab2b-2567b8b4c49f",
        secret: "t9kKT6sKtxKDVeHlLZ2A5s_SgWMrO-4h7UqMt6AvaLM=",
      },
    },
    {
      input: "asdf.asdf.asdf",
      expected: {
        id: "asdf",
        secret: "asdf.asdf",
      },
    },
    {
      input: "asdf.",
      expected: {
        id: "asdf",
        secret: "",
      },
    },
    {
      input: "asdf",
      expected: undefined,
    },
    {
      input: "",
      expected: undefined,
    },
  ] satisfies Array<{ expected: SessionToken | undefined; input: string }>;
  test.each(table)("$input", ({ input, expected }) => {
    expect(parseSessionToken(input)).toEqual(expected);
  });
});

describe("format and parse session token", () => {
  const table = [
    {
      token: {
        id: "id-123",
        secret: "secret-123",
      },
    },
    {
      token: {
        id: "01a04a9b-e773-7727-ab2b-2567b8b4c49f",
        secret: "t9kKT6sKtxKDVeHlLZ2A5s_SgWMrO-4h7UqMt6AvaLM=",
      },
    },
  ] satisfies Array<{ token: SessionToken }>;
  test.each(table)("$token", ({ token }) => {
    expect(parseSessionToken(formatSessionToken(token))).toEqual(token);
  });
});
