import { splitProps, type JSX } from "solid-js";

import { cn } from "@/lib/cn";

type CardProps = JSX.IntrinsicElements["div"] & {
  size?: "default" | "sm";
};

function Card(props: CardProps) {
  const [local, others] = splitProps(props, ["class", "size"]);

  return (
    <div
      data-slot="card"
      data-size={local.size ?? "default"}
      class={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        local.class,
      )}
      {...others}
    />
  );
}

function CardHeader(props: JSX.IntrinsicElements["div"]) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-header"
      class={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        local.class,
      )}
      {...others}
    />
  );
}

function CardTitle(props: JSX.IntrinsicElements["div"]) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-title"
      class={cn(
        "cn-font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        local.class,
      )}
      {...others}
    />
  );
}

function CardDescription(props: JSX.IntrinsicElements["div"]) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-description"
      class={cn("text-sm text-muted-foreground", local.class)}
      {...others}
    />
  );
}

function CardAction(props: JSX.IntrinsicElements["div"]) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-action"
      class={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", local.class)}
      {...others}
    />
  );
}

function CardContent(props: JSX.IntrinsicElements["div"]) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div data-slot="card-content" class={cn("px-(--card-spacing)", local.class)} {...others} />
  );
}

function CardFooter(props: JSX.IntrinsicElements["div"]) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-footer"
      class={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        local.class,
      )}
      {...others}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
