import { createForm, formOptions } from "@tanstack/solid-form";
import { createHotkey, formatForDisplay, type RegisterableHotkey } from "@tanstack/solid-hotkeys";
import { useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import * as v from "valibot";

import {
  FormSubmitButton,
  FormTextField,
  selectSubmissionState,
} from "@/components/forms/FormControls";

import { createAndJoinOrganizationFn } from "../serverFunctions";
import { OrganizationNameValidator, OrganizationSlugValidator } from "../validators";

interface CreateOrganizationFormData {
  slug: string;
  organizationName: string;
}

export function CreateOrganizationForm() {
  const createAndJoinOrganization = useServerFn(createAndJoinOrganizationFn);
  const navigate = useNavigate();
  let syncSlug = true;

  const formOpts = formOptions({
    defaultValues: {
      organizationName: "",
      slug: "",
    } satisfies CreateOrganizationFormData,
  });
  const form = createForm(() => ({
    ...formOpts,
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
  }));

  const canSubmit = form.useSelector((state) => state.canSubmit && !state.isSubmitting);
  const submitHotkey = { mod: true, key: "Enter" } satisfies RegisterableHotkey;
  createHotkey(
    submitHotkey,
    () => form.handleSubmit(),
    () => ({ enabled: canSubmit(), ignoreInputs: false }),
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
        <form.Field
          name="organizationName"
          listeners={{
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
          }}
          children={(field) => (
            <FormTextField
              label="organization name"
              type="text"
              autocomplete="off"
              data-1p-ignore
              field={field}
            />
          )}
        />

        <form.Field
          name="slug"
          children={(field) => (
            <FormTextField label="slug" type="text" autocomplete="off" field={field} />
          )}
        />

        <form.Subscribe
          selector={selectSubmissionState}
          children={(state) => (
            <FormSubmitButton {...state()}>
              create · {formatForDisplay(submitHotkey).toLocaleLowerCase()}
            </FormSubmitButton>
          )}
        />
      </form>
    </div>
  );
}
