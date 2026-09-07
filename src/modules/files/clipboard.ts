import { err, ok } from "@/lib/result";

// Start the clipboard write during the click, while the PNG is still downloading.
export async function copyPng(url: string) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return err("Image copying is unavailable in this browser. Download the PNG instead.");
  }

  const png = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error("Could not fetch the PNG.");
    return new Blob([await response.blob()], { type: "image/png" });
  });
  // A rejected clipboard permission can leave the image promise unread.
  void png.catch(() => undefined);

  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return ok(undefined);
  } catch {
    return err("Could not copy the PNG. Try again or download it instead.");
  }
}
