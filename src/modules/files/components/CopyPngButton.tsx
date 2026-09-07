import { Check, Copy, LoaderCircle } from "lucide-solid";
import { createSignal, onCleanup, Show } from "solid-js";

import { Button } from "@/components/ui/Button";

import { copyPng } from "../clipboard";

export function CopyPngButton(props: { url: string; name: string }) {
  const [status, setStatus] = createSignal<"idle" | "copying" | "copied">("idle");
  const [error, setError] = createSignal<string>();
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(resetTimer));

  async function copy() {
    if (status() === "copying") return;
    clearTimeout(resetTimer);
    setError(undefined);
    setStatus("copying");
    const result = await copyPng(props.url);
    if (!result.ok) {
      setStatus("idle");
      setError(result.error);
      return;
    }
    setStatus("copied");
    resetTimer = setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <>
      <Button
        size="icon"
        variant="outline"
        disabled={status() === "copying"}
        aria-label={`Copy transparent ${props.name} as PNG`}
        title={status() === "copied" ? "Copied!" : status() === "copying" ? "Copying…" : "Copy PNG"}
        onClick={() => void copy()}
      >
        <Show
          when={status() === "copied"}
          fallback={
            <Show
              when={status() === "copying"}
              fallback={<Copy class="size-4" aria-hidden="true" />}
            >
              <LoaderCircle
                class="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            </Show>
          }
        >
          <Check class="size-4" aria-hidden="true" />
        </Show>
      </Button>
      <span class="sr-only" role="status">
        {status() === "copied" ? `${props.name} copied as PNG` : ""}
      </span>
      <Show when={error()}>
        {(message) => (
          <p class="text-destructive w-full text-xs" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </>
  );
}
