import { renderToString } from "solid-js/web";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  hash: "",
  submit: undefined as undefined | (() => Promise<void>),
  passkeyClick: undefined as undefined | (() => Promise<void>),
  navigate: vi.fn(),
  invalidate: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  beginPasskey: vi.fn(),
  finishPasskey: vi.fn(),
  authenticate: vi.fn(),
}));

vi.mock("@tanstack/solid-router", () => ({
  useNavigate: () => state.navigate,
  useRouter: () => ({ invalidate: state.invalidate }),
  useLocation: () => () => ({ hash: state.hash }),
  Link: (props: { to: string; hash?: string }) => (
    <a href={`${props.to}${props.hash ? `#${props.hash}` : ""}`} />
  ),
}));
vi.mock("@tanstack/solid-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/solid-form", () => ({
  formOptions: (options: unknown) => options,
  createForm: (
    options: () => {
      onSubmit: (options: {
        value: { username: string; password: string; passwordConfirm: string };
      }) => Promise<void>;
    },
  ) => {
    state.submit = () =>
      options().onSubmit({
        value: { username: "recipient", password: "password123", passwordConfirm: "password123" },
      });
    return { Field: () => null, Subscribe: () => null, handleSubmit: state.submit };
  },
}));
vi.mock("@/components/forms/FormControls", () => ({
  FormSubmitButton: () => null,
  FormTextField: () => null,
  selectSubmissionState: vi.fn(),
}));
vi.mock("@/components/ui/Button", () => ({
  Button: (props: { onClick: () => Promise<void> }) => {
    state.passkeyClick = props.onClick;
    return <button />;
  },
}));
vi.mock("@/components/ui/Separator", () => ({ Separator: () => null }));
vi.mock("../serverFunctions", () => ({
  signInFn: state.signIn,
  signUpFn: state.signUp,
  beginPasskeyAuthFn: state.beginPasskey,
  finishPasskeyAuthFn: state.finishPasskey,
}));
vi.mock("../lib/webauthn/browser", () => ({ authenticateWithPasskey: state.authenticate }));

import { SignInForm } from "./SignInForm";
import { SignupForm } from "./SignUpForm";

const token = `01994fd4-c3ef-7f5a-a0cb-768f7f6d3be6.${"A".repeat(43)}`;

describe("invite continuation through auth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.hash = token;
    state.submit = undefined;
    state.passkeyClick = undefined;
    state.signUp.mockResolvedValue({ signedIn: true });
    state.beginPasskey.mockResolvedValue({ ceremonyId: "ceremony", options: {} });
    state.authenticate.mockResolvedValue({ ok: true, value: { id: "credential" } });
  });

  test("password sign-in returns to the invite and refreshes session state", async () => {
    const html = renderToString(() => <SignInForm />);
    expect(html).toContain(`/sign-up#${token}`);
    expect(state.submit).toBeDefined();
    await state.submit?.();
    expect(state.signIn).toHaveBeenCalledWith({
      data: { username: "recipient", password: "password123" },
    });
    expect(state.invalidate).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith({ to: "/invite/accept", hash: token });
  });

  test("passkey sign-in returns to the same invite", async () => {
    renderToString(() => <SignInForm />);
    expect(state.passkeyClick).toBeDefined();
    await state.passkeyClick?.();
    expect(state.finishPasskey).toHaveBeenCalledWith({
      data: { ceremonyId: "ceremony", credential: { id: "credential" } },
    });
    expect(state.navigate).toHaveBeenCalledWith({ to: "/invite/accept", hash: token });
  });

  test("sign-up returns to the invite and preserves it on the sign-in link", async () => {
    const html = renderToString(() => <SignupForm />);
    expect(html).toContain(`/sign-in#${token}`);
    await state.submit?.();
    expect(state.signUp).toHaveBeenCalledOnce();
    expect(state.invalidate).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith({ to: "/invite/accept", hash: token });
  });

  test("account creation without a session allows sign-in without repeating registration", async () => {
    state.signUp.mockResolvedValue({ signedIn: false });
    const html = renderToString(() => <SignupForm />);
    await state.submit?.();
    await state.submit?.();
    expect(state.signUp).toHaveBeenCalledOnce();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(html).toContain(`/sign-in#${token}`);
  });

  test("failed authentication stays on the form", async () => {
    state.signIn.mockRejectedValue(new Error("Unauthorized"));
    renderToString(() => <SignInForm />);
    await state.submit?.();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  test("ordinary authentication still goes home", async () => {
    state.hash = "";
    renderToString(() => <SignInForm />);
    await state.submit?.();
    expect(state.navigate).toHaveBeenCalledWith({ to: "/" });
  });
});
