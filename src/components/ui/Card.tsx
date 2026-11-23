import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

type CardProps = JSX.IntrinsicElements["div"] & {
  size?: "default" | "sm";
};

function Card(props: CardProps) {
  const others = omit(props, "class", "size");

  return (
    <div
      data-slot="card"
      data-size={props.size ?? "default"}
      class={[
        "group/card bg-card text-card-foreground ring-foreground/10 flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl py-(--card-spacing) text-sm ring-1 [--card-spacing:--spacing(4)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        props.class,
      ]}
      {...others}
    />
  );
}

function CardHeader(props: JSX.IntrinsicElements["div"]) {
  const others = omit(props, "class");

  return (
    <div
      data-slot="card-header"
      class={[
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) [.border-b]:pb-(--card-spacing)",
        props.class,
      ]}
      {...others}
    />
  );
}

function CardTitle(props: JSX.IntrinsicElements["div"]) {
  const others = omit(props, "class");

  return (
    <div
      data-slot="card-title"
      class={[
        "cn-font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        props.class,
      ]}
      {...others}
    />
  );
}

function CardContent(props: JSX.IntrinsicElements["div"]) {
  const others = omit(props, "class");

  return <div data-slot="card-content" class={["px-(--card-spacing)", props.class]} {...others} />;
}

export { Card, CardHeader, CardTitle, CardContent };
