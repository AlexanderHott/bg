import type { JSX } from "solid-js";
import { renderToString } from "solid-js/web";
import { beforeEach, expect, test, vi } from "vite-plus/test";

import { SignInForm } from "./SignInForm";

const mocks = vi.hoisted(() => ({
  shortcuts: new Map<string, () => unknown>(),
  navigate: vi.fn(),
  invalidate: vi.fn(),
  beginPasskeyAuth: vi.fn(),
  finishPasskeyAuth: vi.fn(),
  authenticateWithPasskey: vi.fn(),
  token: `01994fd4-c3ef-7f5a-a0cb-768f7f6d3be6.${"A".repeat(43)}`,
}));

vi.mock("@tanstack/solid-hotkeys", () => ({
  createHotkey: (hotkey: { key: string }, callback: () => unknown) =>
    mocks.shortcuts.set(hotkey.key, callback),
  createHotkeySequence: (sequence: string[], callback: () => unknown) =>
    mocks.shortcuts.set(sequence.join(","), callback),
  formatForDisplay: () => "shortcut",
  formatHotkeySequence: () => "shortcut",
}));

vi.mock("@tanstack/solid-router", () => ({
  useLocation: () => () => ({ hash: mocks.token }),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Link: (props: { children: JSX.Element }) => props.children,
}));

vi.mock("@tanstack/solid-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("../serverFunctions", () => ({
  signInFn: vi.fn(),
  beginPasskeyAuthFn: mocks.beginPasskeyAuth,
  finishPasskeyAuthFn: mocks.finishPasskeyAuth,
}));

vi.mock("../lib/webauthn/browser", () => ({
  authenticateWithPasskey: mocks.authenticateWithPasskey,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.shortcuts.clear();
});

function shortcut(key: string) {
  const callback = mocks.shortcuts.get(key);
  if (!callback) throw new Error(`Missing shortcut: ${key}`);
  return callback;
}

test("preserves the invite when the sign-up shortcut is used", async () => {
  renderToString(() => <SignInForm />);

  await shortcut("S,U")();

  expect(mocks.navigate).toHaveBeenCalledWith({ to: "/sign-up", hash: mocks.token });
});

test("starts only one passkey ceremony while the previous request is pending", async () => {
  const request = Promise.withResolvers<{ ceremonyId: string; options: object }>();
  mocks.beginPasskeyAuth.mockReturnValueOnce(request.promise);
  mocks.authenticateWithPasskey.mockResolvedValue({ ok: true, value: { id: "credential" } });
  renderToString(() => <SignInForm />);

  const pending = shortcut("P")();
  await shortcut("P")();
  expect(mocks.beginPasskeyAuth).toHaveBeenCalledTimes(1);

  request.resolve({ ceremonyId: "ceremony", options: {} });
  await pending;

  expect(mocks.finishPasskeyAuth).toHaveBeenCalledExactlyOnceWith({
    data: { ceremonyId: "ceremony", credential: { id: "credential" } },
  });
  expect(mocks.navigate).toHaveBeenCalledWith({ to: "/invite/accept", hash: mocks.token });

  mocks.beginPasskeyAuth.mockResolvedValue({ ceremonyId: "next-ceremony", options: {} });
  await shortcut("P")();
  expect(mocks.beginPasskeyAuth).toHaveBeenCalledTimes(2);
});
