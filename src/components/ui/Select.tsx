import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SelectPrimitive from "@kobalte/core/select";
import { CheckIcon, ChevronDownIcon } from "@lucide/solid";
import type { JSX, ValidComponent } from "@solidjs/web";
import { omit } from "solid-js";

// Configure popup placement, gutter, and shift on the root.
const Select = SelectPrimitive.Root;
const SelectFieldLabel = SelectPrimitive.Label;

function SelectValue<Option>(
  props: PolymorphicProps<"span", SelectPrimitive.SelectValueProps<Option>>,
) {
  const others = omit(props, "class");
  return (
    <SelectPrimitive.Value<Option>
      data-slot="select-value"
      class={["data-placeholder-shown:text-muted-foreground flex flex-1 text-left", props.class]}
      {...others}
    />
  );
}

type SelectTriggerProps<T extends ValidComponent = "button"> =
  SelectPrimitive.SelectTriggerProps<T> & {
    class?: JSX.ClassValue;
    children?: JSX.Element;
    size?: "sm" | "default";
  };

function SelectTrigger<T extends ValidComponent = "button">(
  props: PolymorphicProps<T, SelectTriggerProps<T>>,
) {
  const others = omit(props as SelectTriggerProps, "class", "size", "children");
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={props.size ?? "default"}
      class={[
        "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-placeholder-shown:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 flex w-fit items-center justify-between gap-1.5 rounded-lg border bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        props.class,
      ]}
      {...others}
    >
      {props.children}
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
  const others = omit(props, "class", "children");
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        class={[
          "bg-popover text-popover-foreground ring-foreground/10 relative isolate z-50 w-(--kb-popper-anchor-width) min-w-36 origin-(--kb-select-content-transform-origin) overflow-hidden rounded-lg shadow-md ring-1",
          props.class,
        ]}
        {...others}
      >
        <SelectPrimitive.Listbox<
          Option,
          OptGroup
        > class="max-h-(--kb-popper-content-available-height) overflow-x-hidden overflow-y-auto p-1 outline-none">
          {props.children}
        </SelectPrimitive.Listbox>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem(props: PolymorphicProps<"li", SelectPrimitive.SelectItemProps>) {
  const others = omit(props, "class", "children");
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      class={[
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        props.class,
      ]}
      {...others}
    >
      <SelectPrimitive.ItemLabel class="flex flex-1 shrink-0 items-center gap-2 whitespace-nowrap">
        {props.children}
      </SelectPrimitive.ItemLabel>
      <SelectPrimitive.ItemIndicator class="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon class="pointer-events-none size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectFieldLabel, SelectItem, SelectTrigger, SelectValue };
