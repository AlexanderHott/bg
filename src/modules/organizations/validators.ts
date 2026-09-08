import * as v from "valibot";

export const OrganizationSlugValidator = v.pipe(
  v.string("enter an organization slug"),
  v.minLength(3, "slug must have at least 3 characters"),
  v.maxLength(32, "slug cannot have more than 32 characters"),
);
export const OrganizationNameValidator = v.pipe(
  v.string("enter an organization name"),
  v.minLength(1, "enter an organization name"),
  v.maxLength(32, "organization name cannot have more than 32 characters"),
);
export const InviteValidityDaysValidator = v.picklist(
  [1, 7, 30],
  "choose an invite duration of 1, 7, or 30 days",
);
