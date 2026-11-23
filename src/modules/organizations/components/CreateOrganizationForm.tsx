import { FieldApi, FormApi } from "@tanstack/form-core";
import { createHotkey, formatForDisplay, type RegisterableHotkey } from "@tanstack/solid-hotkeys";
import { useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import * as v from "valibot";

import {
  FormSubmitButton,
  FormTextField,
  selectSubmissionState,
} from "@/components/forms/FormControls";
import { useField, useForm, useSelector } from "@/lib/form";

import { createAndJoinOrganizationFn } from "../serverFunctions";
import { OrganizationNameValidator, OrganizationSlugValidator } from "../validators";

export function CreateOrganizationForm() {
  const createAndJoinOrganization = useServerFn(createAndJoinOrganizationFn);
  const navigate = useNavigate();
  let syncSlug = true;

  const form = useForm(
    new FormApi({
      defaultValues: { organizationName: "", slug: "" },
      onSubmit: async ({ value }) => {
        await createAndJoinOrganization({
          data: {
            name: value.organizationName,
            slug: value.slug,
          },
        });

        await navigate({ to: "/$orgSlug", params: { orgSlug: value.slug } });
      },
      validators: {
        onChange: v.object({
          slug: OrganizationSlugValidator,
          organizationName: OrganizationNameValidator,
        }),
      },
    }),
  );
  const organizationName = useField(
    new FieldApi({
      form,
      name: "organizationName",
      listeners: {
        onChange: ({ value }) => {
          if (!syncSlug) return;
          form.setFieldValue(
            "slug",
            value
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, ""),
          );
        },
        onBlur: () => {
          syncSlug = false;
        },
      },
    }),
  );
  const slug = useField(new FieldApi({ form, name: "slug" }));
  const submission = useSelector(form.store, selectSubmissionState);
  const submitHotkey = { mod: true, key: "Enter" } satisfies RegisterableHotkey;
  createHotkey(
    submitHotkey,
    () => form.handleSubmit(),
    () => ({
      enabled: submission().canSubmit && !submission().isSubmitting,
      ignoreInputs: false,
    }),
  );

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
        <FormTextField
          label="organization name"
          type="text"
          autocomplete="off"
          data-1p-ignore
          field={organizationName()}
        />
        <FormTextField label="slug" type="text" autocomplete="off" field={slug()} />
        <FormSubmitButton {...submission()}>
          create · {formatForDisplay(submitHotkey).toLocaleLowerCase()}
        </FormSubmitButton>
      </form>
    </div>
  );
}
