import type { JSX } from "solid-js";

import { Button } from "@/components/ui/Button";
import {
  TextField,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from "@/components/ui/TextField";

type FormTextFieldProps = {
  label: string;
  type: "text" | "password";
  autocomplete?: string;
  field: () => {
    name: string;
    state: {
      value: string;
      meta: { isTouched: boolean; errors: readonly unknown[] };
    };
    handleBlur: () => void;
    handleChange: (value: string) => void;
  };
  onInput?: (value: string) => void;
  children?: JSX.Element;
};

export function FormTextField(props: FormTextFieldProps) {
  const field = () => props.field();
  return (
    <TextField
      validationState={
        field().state.meta.isTouched && field().state.meta.errors.length > 0 ? "invalid" : "valid"
      }
    >
      <TextFieldLabel>{props.label}</TextFieldLabel>
      <TextFieldInput
        type={props.type}
        autocomplete={props.autocomplete}
        name={field().name}
        value={field().state.value}
        onBlur={field().handleBlur}
        onInput={(event) => (props.onInput ?? field().handleChange)(event.currentTarget.value)}
      />
      {props.children}
      <TextFieldErrorMessage>{formatErrors(field().state.meta.errors)}</TextFieldErrorMessage>
    </TextField>
  );
}

export function FormSubmitButton(props: {
  canSubmit: boolean;
  isSubmitting: boolean;
  label: string;
}) {
  return (
    <Button type="submit" disabled={!props.canSubmit}>
      {props.isSubmitting ? "..." : `[ ${props.label} ]`}
    </Button>
  );
}

export function selectSubmissionState(state: { canSubmit: boolean; isSubmitting: boolean }) {
  return { canSubmit: state.canSubmit, isSubmitting: state.isSubmitting };
}

function formatErrors(errors: readonly unknown[]) {
  return errors.map(errorMessage).filter(Boolean).join(", ");
}

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return undefined;
}
