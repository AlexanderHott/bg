import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  NoSuchKey,
  NoSuchUpload,
  NotFound,
  S3Client,
  UploadPartCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { envServer } from "@/envServer";
import { err, ok, tryAsync, type Result } from "@/lib/result";

const sharedConfig = {
  region: envServer.S3_REGION,
  forcePathStyle: envServer.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: envServer.S3_ACCESS_KEY_ID,
    secretAccessKey: envServer.S3_SECRET_ACCESS_KEY,
  },
} satisfies S3ClientConfig;

const internalClient = new S3Client({
  ...sharedConfig,
  endpoint: envServer.S3_INTERNAL_ENDPOINT,
});

const publicSigningClient = new S3Client({
  ...sharedConfig,
  endpoint: envServer.S3_PUBLIC_ENDPOINT,
});

export type StartMultipartUploadError =
  | {
      kind: "START_UPLOAD_FAILED";
      cause: unknown;
    }
  | {
      kind: "NO_UPLOAD_ID";
    };
export async function startMultipartUpload(options: {
  key: string;
  mediaType: string;
  signal: AbortSignal;
}): Promise<Result<string, StartMultipartUploadError>> {
  const uploadCommand = new CreateMultipartUploadCommand({
    Bucket: envServer.S3_BUCKET,
    Key: options.key,
    ContentType: options.mediaType,
  });
  const responseResult = await tryAsync(() =>
    internalClient.send(uploadCommand, { abortSignal: options.signal }),
  );
  if (!responseResult.ok) {
    return err({ kind: "START_UPLOAD_FAILED", cause: responseResult.error });
  }
  const response = responseResult.value;

  if (!response.UploadId) {
    return err({ kind: "NO_UPLOAD_ID" });
  }
  return ok(response.UploadId);
}

const SIGNED_URL_LIFETIME_SECONDS = 15 * 60;
const SIGNED_VIEW_URL_LIFETIME_SECONDS = 60 * 60;

export type SignUploadPartError =
  | {
      kind: "INVALID_PART_NUMBER";
    }
  | {
      kind: "SIGN_UPLOAD_PART_FAILED";
      cause: unknown;
    };

export async function signUploadPart(options: {
  key: string;
  uploadId: string;
  partNumber: number;
}): Promise<Result<{ method: "PUT"; url: string; expiresAt: Date }, SignUploadPartError>> {
  if (
    !Number.isInteger(options.partNumber) ||
    options.partNumber < 1 ||
    options.partNumber > 10_000
  ) {
    return err({ kind: "INVALID_PART_NUMBER" });
  }

  const command = new UploadPartCommand({
    Bucket: envServer.S3_BUCKET,
    Key: options.key,
    UploadId: options.uploadId,
    PartNumber: options.partNumber,
  });
  const signedAt = Date.now();
  const urlResult = await tryAsync(() =>
    getSignedUrl(publicSigningClient, command, {
      expiresIn: SIGNED_URL_LIFETIME_SECONDS,
    }),
  );
  if (!urlResult.ok) {
    return err({
      kind: "SIGN_UPLOAD_PART_FAILED",
      cause: urlResult.error,
    });
  }

  return ok({
    method: "PUT",
    url: urlResult.value,
    expiresAt: new Date(signedAt + SIGNED_URL_LIFETIME_SECONDS * 1_000),
  });
}

export type SignOpenObjectError = {
  kind: "SIGN_OPEN_OBJECT_FAILED";
  cause: unknown;
};

export async function signOpenObject(options: {
  key: string;
}): Promise<Result<string, SignOpenObjectError>> {
  const command = new GetObjectCommand({
    Bucket: envServer.S3_BUCKET,
    Key: options.key,
  });
  const urlResult = await tryAsync(() =>
    getSignedUrl(publicSigningClient, command, {
      expiresIn: SIGNED_VIEW_URL_LIFETIME_SECONDS,
    }),
  );
  if (!urlResult.ok) {
    return err({
      kind: "SIGN_OPEN_OBJECT_FAILED",
      cause: urlResult.error,
    });
  }

  return ok(urlResult.value);
}

export type AbortMultipartUploadError = {
  kind: "ABORT_UPLOAD_FAILED";
  cause: unknown;
};

export async function abortMultipartUpload(options: {
  key: string;
  uploadId: string;
  signal?: AbortSignal;
}): Promise<Result<undefined, AbortMultipartUploadError>> {
  const command = new AbortMultipartUploadCommand({
    Bucket: envServer.S3_BUCKET,
    Key: options.key,
    UploadId: options.uploadId,
  });

  const responseResult = await tryAsync(() =>
    internalClient.send(command, {
      abortSignal: options.signal,
    }),
  );

  if (!responseResult.ok) {
    // there is already no active upload
    if (responseResult.error instanceof NoSuchUpload) {
      return ok(undefined);
    }

    return err({
      kind: "ABORT_UPLOAD_FAILED",
      cause: responseResult.error,
    });
  }

  return ok(undefined);
}

type UploadedPart = {
  partNumber: number;
  etag: string;
  sizeBytes: number;
};

export type ListUploadedPartsError =
  | {
      kind: "UPLOAD_NOT_FOUND";
    }
  | {
      kind: "INVALID_LIST_PARTS_RESPONSE";
    }
  | {
      kind: "LIST_PARTS_FAILED";
      cause: unknown;
    };

export async function listUploadedParts(options: {
  key: string;
  uploadId: string;
  signal?: AbortSignal;
}): Promise<Result<Array<UploadedPart>, ListUploadedPartsError>> {
  const parts: Array<UploadedPart> = [];
  let partNumberMarker: string | undefined;

  while (true) {
    const pageResult = await listUploadedPartsPage(options, partNumberMarker);
    if (!pageResult.ok) return pageResult;
    parts.push(...pageResult.value.parts);
    if (!pageResult.value.nextPartNumberMarker) return ok(parts);
    partNumberMarker = pageResult.value.nextPartNumberMarker;
  }
}

async function listUploadedPartsPage(
  options: { key: string; uploadId: string; signal?: AbortSignal },
  partNumberMarker: string | undefined,
): Promise<
  Result<
    { parts: Array<UploadedPart>; nextPartNumberMarker: string | undefined },
    ListUploadedPartsError
  >
> {
  const command = new ListPartsCommand({
    Bucket: envServer.S3_BUCKET,
    Key: options.key,
    UploadId: options.uploadId,
    PartNumberMarker: partNumberMarker,
  });
  const responseResult = await tryAsync(() =>
    internalClient.send(command, { abortSignal: options.signal }),
  );
  if (!responseResult.ok) {
    if (responseResult.error instanceof NoSuchUpload) return err({ kind: "UPLOAD_NOT_FOUND" });
    return err({ kind: "LIST_PARTS_FAILED", cause: responseResult.error });
  }

  const response = responseResult.value;
  const partsResult = parseUploadedParts(response.Parts ?? []);
  if (!partsResult.ok) return partsResult;
  if (response.IsTruncated && !response.NextPartNumberMarker) {
    return err({ kind: "INVALID_LIST_PARTS_RESPONSE" });
  }
  return ok({
    parts: partsResult.value,
    nextPartNumberMarker: response.IsTruncated ? response.NextPartNumberMarker : undefined,
  });
}

function parseUploadedParts(
  parts: ReadonlyArray<{ PartNumber?: number; ETag?: string; Size?: number }>,
) {
  const parsed: Array<UploadedPart> = [];
  for (const part of parts) {
    if (part.PartNumber === undefined || part.ETag === undefined || part.Size === undefined) {
      return err({ kind: "INVALID_LIST_PARTS_RESPONSE" } as const);
    }
    parsed.push({ partNumber: part.PartNumber, etag: part.ETag, sizeBytes: part.Size });
  }
  return ok(parsed);
}

type CompletedUploadPart = {
  partNumber: number;
  etag: string;
};

export type CompleteMultipartUploadError =
  | {
      kind: "UPLOAD_NOT_FOUND";
    }
  | {
      kind: "COMPLETE_UPLOAD_FAILED";
      cause: unknown;
    };

export async function completeMultipartUpload(options: {
  key: string;
  uploadId: string;
  parts: ReadonlyArray<CompletedUploadPart>;
  signal?: AbortSignal;
}): Promise<Result<undefined, CompleteMultipartUploadError>> {
  const parts = options.parts
    .map((part) => ({
      PartNumber: part.partNumber,
      ETag: part.etag,
    }))
    .sort((left, right) => left.PartNumber - right.PartNumber);

  const command = new CompleteMultipartUploadCommand({
    Bucket: envServer.S3_BUCKET,
    Key: options.key,
    UploadId: options.uploadId,
    MultipartUpload: {
      Parts: parts,
    },
  });

  const responseResult = await tryAsync(() =>
    internalClient.send(command, {
      abortSignal: options.signal,
    }),
  );

  if (!responseResult.ok) {
    if (responseResult.error instanceof NoSuchUpload) {
      return err({ kind: "UPLOAD_NOT_FOUND" });
    }

    return err({
      kind: "COMPLETE_UPLOAD_FAILED",
      cause: responseResult.error,
    });
  }

  return ok(undefined);
}

export type ObjectStat = {
  sizeBytes: number;
  mediaType?: string;
  etag?: string;
};

export type StatObjectError =
  | {
      kind: "OBJECT_NOT_FOUND";
    }
  | {
      kind: "INVALID_OBJECT_METADATA";
    }
  | {
      kind: "STAT_OBJECT_FAILED";
      cause: unknown;
    };

export async function statObject(options: {
  key: string;
  signal?: AbortSignal;
}): Promise<Result<ObjectStat, StatObjectError>> {
  const command = new HeadObjectCommand({
    Bucket: envServer.S3_BUCKET,
    Key: options.key,
  });

  const responseResult = await tryAsync(() =>
    internalClient.send(command, {
      abortSignal: options.signal,
    }),
  );

  if (!responseResult.ok) {
    if (responseResult.error instanceof NotFound || responseResult.error instanceof NoSuchKey) {
      return err({ kind: "OBJECT_NOT_FOUND" });
    }

    return err({
      kind: "STAT_OBJECT_FAILED",
      cause: responseResult.error,
    });
  }

  const response = responseResult.value;

  if (response.ContentLength === undefined) {
    return err({ kind: "INVALID_OBJECT_METADATA" });
  }

  return ok({
    sizeBytes: response.ContentLength,
    mediaType: response.ContentType,
    etag: response.ETag,
  });
}
export type DeleteObjectError = {
  kind: "DELETE_OBJECT_FAILED";
  cause: unknown;
};

export async function deleteObject(options: {
  key: string;
  signal?: AbortSignal;
}): Promise<Result<undefined, DeleteObjectError>> {
  const command = new DeleteObjectCommand({
    Bucket: envServer.S3_BUCKET,
    Key: options.key,
  });

  const responseResult = await tryAsync(() =>
    internalClient.send(command, {
      abortSignal: options.signal,
    }),
  );
  if (!responseResult.ok) {
    return err({ kind: "DELETE_OBJECT_FAILED", cause: responseResult.error });
  }

  return ok(undefined);
}
