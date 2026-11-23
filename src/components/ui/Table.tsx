import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

function Table(props: JSX.IntrinsicElements["table"]) {
  const others = omit(props, "class");

  return (
    <div data-slot="table-container" class="relative w-full overflow-x-auto">
      <table data-slot="table" class={["w-full caption-bottom text-sm", props.class]} {...others} />
    </div>
  );
}

function TableHeader(props: JSX.IntrinsicElements["thead"]) {
  const others = omit(props, "class");

  return <thead data-slot="table-header" class={["[&_tr]:border-b", props.class]} {...others} />;
}

function TableBody(props: JSX.IntrinsicElements["tbody"]) {
  const others = omit(props, "class");

  return (
    <tbody data-slot="table-body" class={["[&_tr:last-child]:border-0", props.class]} {...others} />
  );
}

function TableRow(props: JSX.IntrinsicElements["tr"]) {
  const others = omit(props, "class");

  return (
    <tr
      data-slot="table-row"
      class={[
        "hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        props.class,
      ]}
      {...others}
    />
  );
}

function TableHead(props: JSX.IntrinsicElements["th"]) {
  const others = omit(props, "class");

  return (
    <th
      data-slot="table-head"
      class={[
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap has-[[role=checkbox]]:pr-0",
        props.class,
      ]}
      {...others}
    />
  );
}

function TableCell(props: JSX.IntrinsicElements["td"]) {
  const others = omit(props, "class");

  return (
    <td
      data-slot="table-cell"
      class={["p-2 align-middle whitespace-nowrap has-[[role=checkbox]]:pr-0", props.class]}
      {...others}
    />
  );
}

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell };
