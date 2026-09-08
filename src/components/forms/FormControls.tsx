import { LoaderCircle } from "lucide-solid";
import { createUniqueId, Show, type JSX } from "solid-js";

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
  "data-1p-ignore"?: boolean;
  validatingMessage?: string;
  successMessage?: string;
  field: () => {
    name: string;
    state: {
      value: string;
      meta: { isTouched: boolean; isValidating: boolean; errors: readonly unknown[] };
    };
    handleBlur: () => void;
    handleChange: (value: string) => void;
  };
};

export function FormTextField(props: FormTextFieldProps) {
  const field = () => props.field();
  const statusId = createUniqueId();
  const isValidating = () => field().state.meta.isValidating;
  const successMessage = () =>
    field().state.meta.errors.length === 0 ? props.successMessage : undefined;
  return (
    <TextField
      validationState={
        !isValidating() && field().state.meta.isTouched && field().state.meta.errors.length > 0
          ? "invalid"
          : "valid"
      }
    >
      <TextFieldLabel>{props.label}</TextFieldLabel>
      <TextFieldInput
        type={props.type}
        autocomplete={props.autocomplete}
        data-1p-ignore={props["data-1p-ignore"]}
        name={field().name}
        value={field().state.value}
        aria-busy={isValidating()}
        aria-describedby={isValidating() || successMessage() ? statusId : undefined}
        onBlur={field().handleBlur}
        onInput={(event) => field().handleChange(event.currentTarget.value)}
      />
      <div class="h-4 overflow-y-auto text-xs leading-4" aria-atomic="true">
        <Show
          when={isValidating()}
          fallback={
            <Show
              when={successMessage()}
              fallback={
                <TextFieldErrorMessage class="text-xs leading-4">
                  {formatErrors(field().state.meta.errors)}
                </TextFieldErrorMessage>
              }
            >
              <div id={statusId} class="text-green-700 dark:text-green-400">
                {successMessage()}
              </div>
            </Show>
          }
        >
          <div id={statusId} class="text-muted-foreground flex items-start gap-1">
            <LoaderCircle
              class="mt-0.5 size-3 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span>{props.validatingMessage ?? "Checking..."}</span>
          </div>
        </Show>
      </div>
    </TextField>
  );
}

export function FormSubmitButton(props: {
  canSubmit: boolean;
  isSubmitting: boolean;
  children: JSX.Element;
}) {
  return (
    <Button type="submit" disabled={!props.canSubmit}>
      {props.isSubmitting ? "..." : props.children}
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
