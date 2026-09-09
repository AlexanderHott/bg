import { createLink } from "@tanstack/solid-router";
import type { ComponentProps } from "solid-js";

import { Button, type ButtonProps } from "./Button";

export const ButtonLink = createLink((props: ComponentProps<"a"> & ButtonProps<"a">) => (
  <Button as="a" {...props} />
));
