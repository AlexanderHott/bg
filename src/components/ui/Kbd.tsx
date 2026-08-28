import { cn } from "@/lib/cn";
import { splitProps, type JSX } from "solid-js";

function Kbd(props: JSX.IntrinsicElements["kbd"]) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <kbd
      data-slot="kbd"
      class={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        local.class,
      )}
      {...others}
    />
  );
}

function KbdGroup(props: JSX.IntrinsicElements["div"]) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="kbd-group"
      class={cn("inline-flex items-center gap-1", local.class)}
      {...others}
    />
  );
}

export { Kbd, KbdGroup };
