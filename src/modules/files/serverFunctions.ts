import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import * as v from "valibot";

import { authMiddleware } from "@/modules/auth/middleware";
import { getOrganization } from "@/modules/organizations/organizations";
import { OrganizationSlugValidator } from "@/modules/organizations/validators";

import { beginFileUpload, completeFileUpload, getReadyImage, listReadyImages } from "./files";

const MAX_FILE_SIZE_BYTES = 2_000_000_000;

const BeginFileUploadValidator = v.object({
  organizationSlug: OrganizationSlugValidator,
  requestId: v.pipe(v.string(), v.uuid()),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
  mediaType: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
  sizeBytes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_FILE_SIZE_BYTES)),
});

const CompleteFileUploadValidator = v.object({
  organizationSlug: OrganizationSlugValidator,
  fileId: v.pipe(v.string(), v.uuid()),
  parts: v.pipe(
    v.array(
      v.object({
        partNumber: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000)),
        etag: v.pipe(v.string(), v.minLength(1), v.maxLength(1_024)),
      }),
    ),
    v.minLength(1),
    v.maxLength(10_000),
  ),
});

const ListReadyImagesValidator = v.object({
  organizationSlug: OrganizationSlugValidator,
});

const GetReadyImageValidator = v.object({
  organizationSlug: OrganizationSlugValidator,
  fileId: v.pipe(v.string(), v.uuid()),
});

export const listReadyImagesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(ListReadyImagesValidator)
  .handler(async ({ context, data }) => {
    const organization = await getOrganization({
      userId: context.userId,
      organizationSlug: data.organizationSlug,
    });

    if (!organization) {
      throw new Error("Organization not found");
    }

    return listReadyImages({ organizationId: organization.id });
  });

export const getReadyImageFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(GetReadyImageValidator)
  .handler(async ({ context, data }) => {
    const organization = await getOrganization({
      userId: context.userId,
      organizationSlug: data.organizationSlug,
    });

    if (!organization) {
      throw new Error("Organization not found");
    }

    return getReadyImage({
      organizationId: organization.id,
      fileId: data.fileId,
    });
  });

export const beginFileUploadFn = createServerFn({
  method: "POST",
})
  .middleware([authMiddleware])
  .validator(BeginFileUploadValidator)
  .handler(async ({ context, data }) => {
    const organization = await getOrganization({
      userId: context.userId,
      organizationSlug: data.organizationSlug,
    });

    if (!organization) {
      throw new Error("Organization not found");
    }

    const { signal } = getRequest();

    return beginFileUpload({
      organizationId: organization.id,
      requestId: data.requestId,
      name: data.name,
      mediaType: data.mediaType,
      sizeBytes: data.sizeBytes,
      signal,
    });
  });

export const completeFileUploadFn = createServerFn({
  method: "POST",
})
  .middleware([authMiddleware])
  .validator(CompleteFileUploadValidator)
  .handler(async ({ context, data }) => {
    const organization = await getOrganization({
      userId: context.userId,
      organizationSlug: data.organizationSlug,
    });

    if (!organization) {
      throw new Error("Organization not found");
    }

    const { signal } = getRequest();

    return completeFileUpload({
      organizationId: organization.id,
      fileId: data.fileId,
      parts: data.parts,
      signal,
    });
  });
