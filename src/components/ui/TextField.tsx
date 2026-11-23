import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as TextFieldPrimitive from "@kobalte/core/text-field";
import type { JSX, ValidComponent } from "@solidjs/web";
import { cva } from "class-variance-authority";
import { omit } from "solid-js";

type TextFieldRootProps<T extends ValidComponent = "div"> =
  TextFieldPrimitive.TextFieldRootProps<T> & {
    class?: JSX.ClassValue;
  };

const TextField = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, TextFieldRootProps<T>>,
) => {
  const others = omit(props as TextFieldRootProps, "class");
  return <TextFieldPrimitive.Root class={["flex flex-col gap-1", props.class]} {...others} />;
};

type TextFieldInputProps<T extends ValidComponent = "input"> =
  TextFieldPrimitive.TextFieldInputProps<T> & {
    class?: JSX.ClassValue;
    type?:
      | "button"
      | "checkbox"
      | "color"
      | "date"
      | "datetime-local"
      | "email"
      | "file"
      | "hidden"
      | "image"
      | "month"
      | "number"
      | "password"
      | "radio"
      | "range"
      | "reset"
      | "search"
      | "submit"
      | "tel"
      | "text"
      | "time"
      | "url"
      | "week";
  };

const TextFieldInput = <T extends ValidComponent = "input">(
  props: PolymorphicProps<T, TextFieldInputProps<T>>,
) => {
  const others = omit(props as TextFieldInputProps, "type", "class");
  return (
    <TextFieldPrimitive.Input
      type={props.type ?? "text"}
      class={[
        "border-input ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring data-invalid:border-error-foreground data-invalid:text-error-foreground flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        props.class,
      ]}
      {...others}
    />
  );
};

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
  {
    variants: {
      variant: {
        label: "data-[invalid]:text-destructive",
        error: "text-xs text-destructive",
      },
    },
    defaultVariants: {
      variant: "label",
    },
  },
);

type TextFieldLabelProps<T extends ValidComponent = "label"> =
  TextFieldPrimitive.TextFieldLabelProps<T> & { class?: JSX.ClassValue };

const TextFieldLabel = <T extends ValidComponent = "label">(
  props: PolymorphicProps<T, TextFieldLabelProps<T>>,
) => {
  const others = omit(props as TextFieldLabelProps, "class");
  return <TextFieldPrimitive.Label class={[labelVariants(), props.class]} {...others} />;
};

type TextFieldErrorMessageProps<T extends ValidComponent = "div"> =
  TextFieldPrimitive.TextFieldErrorMessageProps<T> & {
    class?: JSX.ClassValue;
  };

const TextFieldErrorMessage = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, TextFieldErrorMessageProps<T>>,
) => {
  const others = omit(props as TextFieldErrorMessageProps, "class");
  return (
    <TextFieldPrimitive.ErrorMessage
      class={[labelVariants({ variant: "error" }), props.class]}
      {...others}
    />
  );
};

export { TextField, TextFieldInput, TextFieldLabel, TextFieldErrorMessage };
