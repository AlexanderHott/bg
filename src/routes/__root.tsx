import { HydrationScript } from "@solidjs/web";
import { TanStackDevtools } from "@tanstack/solid-devtools";
import { detectPlatform, HotkeysProvider } from "@tanstack/solid-hotkeys";
import { hotkeysDevtoolsPlugin } from "@tanstack/solid-hotkeys-devtools";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/solid-router";
import { TanStackRouterDevtools } from "@tanstack/solid-router-devtools";
import { createIsomorphicFn } from "@tanstack/solid-start";
import { getRequestHeader } from "@tanstack/solid-start/server";
import { Loading } from "solid-js";

import styleCss from "../styles.css?url";

// The server reads the request's user agent so hotkey labels hydrate without changing.
const getHotkeyPlatform = createIsomorphicFn()
  .server(() => detectPlatform(getRequestHeader("User-Agent") ?? ""))
  .client(() => detectPlatform());

export const Route = createRootRouteWithContext()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    links: [{ rel: "stylesheet", href: styleCss }],
  }),
  loader: () => ({ hotkeyPlatform: getHotkeyPlatform() }),
  staleTime: Infinity,
  shellComponent: RootComponent,
});

function RootComponent() {
  const data = Route.useLoaderData();
  return (
    <html lang="en">
      <head>
        <HydrationScript />
        <HeadContent />
      </head>
      <body>
        <HotkeysProvider defaultOptions={{ platform: data().hotkeyPlatform }}>
          <Loading>
            <Outlet />
            <TanStackDevtools plugins={[hotkeysDevtoolsPlugin()]} />
            <TanStackRouterDevtools />
          </Loading>
        </HotkeysProvider>
        <Scripts />
      </body>
    </html>
  );
}
