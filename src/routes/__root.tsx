import { HydrationScript } from "@solidjs/web";
import { TanStackDevtools } from "@tanstack/solid-devtools";
import { hotkeysDevtoolsPlugin } from "@tanstack/solid-hotkeys-devtools";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/solid-router";
import { TanStackRouterDevtools } from "@tanstack/solid-router-devtools";
import { Loading } from "solid-js";

import styleCss from "../styles.css?url";

export const Route = createRootRouteWithContext()({
  head: () => ({
    links: [{ rel: "stylesheet", href: styleCss }],
  }),
  shellComponent: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HydrationScript />
        <HeadContent />
      </head>
      <body>
        <Loading>
          <Outlet />
          <TanStackDevtools plugins={[hotkeysDevtoolsPlugin()]} />
          <TanStackRouterDevtools />
        </Loading>
        <Scripts />
      </body>
    </html>
  );
}
