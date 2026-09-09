import { createFileRoute, Link, useLocation, useNavigate, useRouter } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createResource, createSignal, ErrorBoundary, onMount, Show, Suspense } from "solid-js";

import { Button, buttonVariants } from "@/components/ui/Button";
import { signOutFn } from "@/modules/auth/serverFunctions";
import { acceptInviteFn, previewInviteFn } from "@/modules/organizations/inviteServerFunctions";
import { inviteErrorMessages } from "@/modules/organizations/inviteStatus";
import { inviteTokenFromHash } from "@/modules/organizations/inviteToken";

export const Route = createFileRoute("/_auth/invite/accept")({ component: InvitePage });

function InvitePage() {
  return (
    <main class="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
      <ErrorBoundary
        fallback={(_, reset) => (
          <>
            <p role="alert">Could not load this invite.</p>
            <Button onClick={reset}>try again</Button>
          </>
        )}
      >
        <Suspense fallback={<p role="status">Loading invite...</p>}>
          <InviteDetails />
        </Suspense>
      </ErrorBoundary>
    </main>
  );
}

function InviteDetails() {
  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const preview = useServerFn(previewInviteFn);
  const accept = useServerFn(acceptInviteFn);
  const signOut = useServerFn(signOutFn);
  const token = () => inviteTokenFromHash(location().hash);
  const [mounted, setMounted] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  onMount(() => setMounted(true));
  const [data] = createResource(
    () => (mounted() ? (token() ?? "invalid") : undefined),
    (token) => preview({ data: { token } }),
  );

  async function join() {
    const inviteToken = token();
    if (!inviteToken || pending()) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await accept({ data: { token: inviteToken } });
      if (!result.ok) {
        setError(inviteErrorMessages[result.error]);
        return;
      }
      await router.invalidate();
      await navigate({ to: "/$orgSlug", params: { orgSlug: result.value.slug }, replace: true });
    } catch {
      setError("Could not confirm that you joined. Try again, or sign in if your session expired.");
    } finally {
      setPending(false);
    }
  }

  async function switchAccount() {
    if (pending()) return;
    const inviteToken = token();
    setPending(true);
    setError(undefined);
    try {
      await signOut();
      await router.invalidate();
      await navigate({ to: "/sign-in", hash: inviteToken });
    } catch {
      setError("Could not sign out. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h1 class="text-2xl font-semibold">organization invite</h1>
      <Show when={data()} fallback={<p role="status">Loading invite...</p>}>
        {(result) => {
          const invitation = () => {
            const invite = result().invite;
            return invite.ok ? invite.value : undefined;
          };
          const failure = () => {
            const invite = result().invite;
            return invite.ok ? undefined : inviteErrorMessages[invite.error];
          };
          return (
            <Show when={invitation()} fallback={<p role="alert">{failure()}</p>}>
              {(invite) => (
                <>
                  <p>
                    You've been invited to join <strong>{invite().name}</strong>.
                  </p>
                  <Show
                    when={result().session}
                    fallback={
                      <div class="flex flex-wrap gap-3">
                        <Link class={buttonVariants()} to="/sign-in" hash={token()}>
                          sign in to join
                        </Link>
                        <Link
                          class={buttonVariants({ variant: "secondary" })}
                          to="/sign-up"
                          hash={token()}
                        >
                          create an account
                        </Link>
                      </div>
                    }
                  >
                    {(session) => (
                      <>
                        <p class="text-muted-foreground text-sm">
                          Signed in as {session().username}.
                        </p>
                        <div class="flex flex-wrap gap-3">
                          <Show
                            when={invite().alreadyMember}
                            fallback={
                              <Button disabled={pending()} onClick={join}>
                                {pending() ? "joining..." : "join organization"}
                              </Button>
                            }
                          >
                            <p>You already belong to this organization.</p>
                            <Link
                              class={buttonVariants()}
                              to="/$orgSlug"
                              params={{ orgSlug: invite().slug }}
                            >
                              open organization
                            </Link>
                          </Show>
                          <Button variant="secondary" disabled={pending()} onClick={switchAccount}>
                            switch account
                          </Button>
                        </div>
                      </>
                    )}
                  </Show>
                </>
              )}
            </Show>
          );
        }}
      </Show>
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <Link class="text-muted-foreground text-sm underline" to="/">
        back to bg
      </Link>
    </>
  );
}
