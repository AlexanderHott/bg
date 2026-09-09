import type { UploadFileError } from "./browser";
import { isSupportedImageMediaType } from "./images";

export function validateImage(file: File, maxSizeBytes: number) {
  if (!isSupportedImageMediaType(file.type)) {
    return "Choose a jpeg, png, webp, or avif image.";
  }
  if (file.size === 0) return "Choose a non-empty image.";
  if (file.size > maxSizeBytes) {
    return `Choose an image no larger than ${formatBytes(maxSizeBytes)}.`;
  }
  return undefined;
}

export function uploadErrorMessage(error: UploadFileError) {
  switch (error.kind) {
    case "CANCELLED":
      return "Upload cancelled.";
    case "SERVER_REQUEST_FAILED":
      return "The upload service could not be reached. Try again.";
    case "PART_UPLOAD_FAILED":
      if (error.reason === "MISSING_ETAG") {
        return "The storage server did not return an upload receipt. Check its CORS settings.";
      }
      return `Part ${error.partNumber} could not be uploaded. Try again.`;
    case "RETRY_LIMIT_REACHED":
      return "The upload could not be resumed. Try again.";
    case "FILE_ERROR":
      switch (error.error.kind) {
        case "INVALID_FILE":
          return `The image has an invalid ${error.error.field}.`;
        case "REQUEST_CONFLICT":
          return "This upload request belongs to a different image. Choose the image again.";
        case "SIZE_MISMATCH":
          return "The stored image size did not match the selected file. Try again.";
        case "FILE_NOT_FOUND":
        case "FILE_NOT_READY":
        case "UPLOAD_NOT_FOUND":
        case "INVALID_UPLOAD_STATE":
        case "INVALID_UPLOAD_PARTS":
          return "The upload could not be finalized. Try again.";
      }
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1_000;
  let unitIndex = 0;
  while (value >= 1_000 && unitIndex < units.length - 1) {
    value /= 1_000;
    unitIndex += 1;
  }

  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}
