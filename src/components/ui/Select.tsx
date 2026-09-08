import type { PolymorphicProps } from "@kobalte/core";
import * as SelectPrimitive from "@kobalte/core/select";
import * as SeparatorPrimitive from "@kobalte/core/separator";
import { CheckIcon, ChevronDownIcon } from "lucide-solid";
import { splitProps, type JSX, type ValidComponent } from "solid-js";

import { cn } from "@/lib/cn";

// Configure popup placement, gutter, and shift on the root.
const Select = SelectPrimitive.Root;
const SelectFieldLabel = SelectPrimitive.Label;
const SelectHiddenSelect = SelectPrimitive.HiddenSelect;

function SelectGroup(props: JSX.IntrinsicElements["ul"]) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <ul
      role="group"
      data-slot="select-group"
      class={cn("scroll-my-1 p-1", local.class)}
      {...others}
    />
  );
}

function SelectValue<Option>(
  props: PolymorphicProps<"span", SelectPrimitive.SelectValueProps<Option>>,
) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <SelectPrimitive.Value<Option>
      data-slot="select-value"
      class={cn("flex flex-1 text-left data-placeholder-shown:text-muted-foreground", local.class)}
      {...others}
    />
  );
}

type SelectTriggerProps<T extends ValidComponent = "button"> =
  SelectPrimitive.SelectTriggerProps<T> & {
    class?: string;
    children?: JSX.Element;
    size?: "sm" | "default";
  };

function SelectTrigger<T extends ValidComponent = "button">(
  props: PolymorphicProps<T, SelectTriggerProps<T>>,
) {
  const [local, others] = splitProps(props as SelectTriggerProps, ["class", "size", "children"]);
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={local.size ?? "default"}
      class={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder-shown:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        local.class,
      )}
      {...others}
    >
      {local.children}
      <SelectPrimitive.Icon>
        <ChevronDownIcon class="text-muted-foreground pointer-events-none size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent<Option = unknown, OptGroup = never>(
  props: Omit<PolymorphicProps<"div", SelectPrimitive.SelectContentProps>, "children"> &
    Pick<SelectPrimitive.SelectListboxOptions<Option, OptGroup>, "children">,
) {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        class={cn(
          "relative isolate z-50 w-(--kb-popper-anchor-width) min-w-36 origin-(--kb-select-content-transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
          local.class,
        )}
        {...others}
      >
        <SelectPrimitive.Listbox<
          Option,
          OptGroup
        > class="max-h-(--kb-popper-content-available-height) overflow-x-hidden overflow-y-auto p-1 outline-none">
          {local.children}
        </SelectPrimitive.Listbox>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

// Use as the sectionComponent when the select has grouped options.
function SelectLabel(props: PolymorphicProps<"li", SelectPrimitive.SelectSectionProps>) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <SelectPrimitive.Section
      data-slot="select-label"
      class={cn("px-1.5 py-1 text-xs text-muted-foreground", local.class)}
      {...others}
    />
  );
}

function SelectItem(props: PolymorphicProps<"li", SelectPrimitive.SelectItemProps>) {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      class={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        local.class,
      )}
      {...others}
    >
      <SelectPrimitive.ItemLabel class="flex flex-1 shrink-0 items-center gap-2 whitespace-nowrap">
        {local.children}
      </SelectPrimitive.ItemLabel>
      <SelectPrimitive.ItemIndicator class="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon class="pointer-events-none size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator(props: PolymorphicProps<"li", SeparatorPrimitive.SeparatorRootProps>) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <SeparatorPrimitive.Root
      as="li"
      data-slot="select-separator"
      class={cn("pointer-events-none -mx-1 my-1 h-px bg-border", local.class)}
      {...others}
    />
  );
}

export {
  Select,
  SelectContent,
  SelectFieldLabel,
  SelectGroup,
  SelectHiddenSelect,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
