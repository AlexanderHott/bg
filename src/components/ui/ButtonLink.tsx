import type { ComponentProps } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";

import { Button, type ButtonProps } from "./Button";

export const ButtonLink = createLink((props: ComponentProps<"a"> & ButtonProps<"a">) => (
  <Button as="a" {...props} />
));
