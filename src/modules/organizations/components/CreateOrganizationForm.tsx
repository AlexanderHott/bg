import { createForm, formOptions } from "@tanstack/solid-form";
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
          children={(field) => <FormTextField label="name" type="text" field={field} />}
        />

        <form.Field
          name="slug"
          children={(field) => <FormTextField label="slug" type="text" field={field} />}
        />

        <form.Subscribe
          selector={selectSubmissionState}
          children={(state) => <FormSubmitButton label="create" {...state()} />}
        />
      </form>
    </div>
  );
}
