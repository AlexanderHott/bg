import * as v from "valibot";
export const OrganizationSlugValidator = v.pipe(v.string(), v.minLength(3), v.maxLength(32));
export const OrganizationNameValidator = v.pipe(v.string(), v.minLength(1), v.maxLength(32));
