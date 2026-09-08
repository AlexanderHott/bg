// Preserve signed URLs across polling, but upgrade to thumbnails and replace failed URLs.
export function selectImagePreview(
  image: { id: string; url?: string; thumbnailUrl?: string },
  previous: { id: string; url?: string; thumbnail: boolean } | undefined,
  failedUrls: ReadonlySet<string>,
) {
  const thumbnail = !!image.thumbnailUrl && !failedUrls.has(image.thumbnailUrl);
  const url = thumbnail ? image.thumbnailUrl : image.url;
  if (
    previous?.id === image.id &&
    previous.thumbnail === thumbnail &&
    previous.url &&
    !failedUrls.has(previous.url)
  ) {
    return previous;
  }
  return {
    id: image.id,
    thumbnail,
    url: url && !failedUrls.has(url) ? url : undefined,
  };
}
