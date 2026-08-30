import { createForm, formOptions } from "@tanstack/solid-form";
import { useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import * as v from "valibot";

import { Button } from "@/components/ui/Button";
import {
  TextField,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from "@/components/ui/TextField";

import { createAndJoinOrganizationFn } from "../serverFunctions";
import { OrganizationNameValidator, OrganizationSlugValidator } from "../validators";

interface CreateOrganizationFormData {
  slug: string;
  name: string;
}

export function CreateOrganizationForm() {
  const createAndJoinOrganization = useServerFn(createAndJoinOrganizationFn);
  const navigate = useNavigate();

  const formOpts = formOptions({
    defaultValues: {
      name: "",
      slug: "",
    } satisfies CreateOrganizationFormData,
  });
  const form = createForm(() => ({
    ...formOpts,
    onSubmit: async ({ value }) => {
      await createAndJoinOrganization({
        data: {
          name: value.name,
          slug: value.slug,
        },
      });

      await navigate({ to: "/$orgSlug", params: { orgSlug: value.slug } });
    },
    validators: {
      onChange: v.object({
        slug: OrganizationSlugValidator,
        name: OrganizationNameValidator,
      }),
    },
  }));

  return (
    <div class="flex max-w-sm grow flex-col gap-4">
      <div>create organization</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
        class="flex flex-col gap-4"
      >
        <form.Field
          name="name"
          children={(field) => (
            <TextField
              validationState={
                field().state.meta.isTouched && field().state.meta.errors.length > 0
                  ? "invalid"
                  : "valid"
              }
            >
              <TextFieldLabel>name</TextFieldLabel>
              <TextFieldInput
                type="text"
                name={field().name}
                value={field().state.value}
                onBlur={field().handleBlur}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  field().handleChange(value);
                }}
              />
              <TextFieldErrorMessage>
                {field()
                  .state.meta.errors.map((e) => (typeof e === "string" ? e : e?.message))
                  .join(", ")}
              </TextFieldErrorMessage>
            </TextField>
          )}
        />

        <form.Field
          name="slug"
          children={(field) => (
            <TextField
              validationState={
                field().state.meta.isTouched && field().state.meta.errors.length > 0
                  ? "invalid"
                  : "valid"
              }
            >
              <TextFieldLabel>slug</TextFieldLabel>
              <TextFieldInput
                type="text"
                name={field().name}
                value={field().state.value}
                onBlur={field().handleBlur}
                onInput={(e) => field().handleChange(e.currentTarget.value)}
              />
              <TextFieldErrorMessage>
                {field()
                  .state.meta.errors.map((e) => e?.message)
                  .join(", ")}
              </TextFieldErrorMessage>
            </TextField>
          )}
        />

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
          children={(state) => {
            return (
              <Button type="submit" disabled={!state().canSubmit}>
                {state().isSubmitting ? "..." : "[ create ]"}
              </Button>
            );
          }}
        />
      </form>
    </div>
  );
}
