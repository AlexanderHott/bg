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
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
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
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
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

function CardContent(props: JSX.IntrinsicElements["div"]) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div data-slot="card-content" class={cn("px-(--card-spacing)", local.class)} {...others} />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
