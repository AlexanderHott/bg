import { Show } from "solid-js";

import type { DownloadSettings as Settings } from "../policy";

export function BatchSettings(props: {
  value: Settings;
  onChange: (value: Settings) => void;
  disabled?: boolean;
  simple?: boolean;
}) {
  return (
    <fieldset disabled={props.disabled} class="grid gap-3 disabled:opacity-60 sm:grid-cols-3">
      <label class="flex flex-col gap-1 text-sm">
        Download
        <select
          class="bg-background rounded-md border px-3 py-2"
          value={props.value.mode}
          onChange={(event) =>
            props.onChange({
              mode: event.currentTarget.value === "audio" ? "audio" : "video",
              conversion: "original",
            })
          }
        >
          <option value="video">Video and audio</option>
          <option value="audio">Audio only</option>
        </select>
      </label>
      <Show when={!props.simple}>
        <Show when={props.value.mode === "video"}>
          <label class="flex flex-col gap-1 text-sm">
            Maximum resolution
            <select
              class="bg-background rounded-md border px-3 py-2"
              value={props.value.maxHeight ?? "best"}
              onChange={(event) => {
                const height = Number(event.currentTarget.value);
                props.onChange({
                  ...props.value,
                  maxHeight:
                    height === 720 || height === 1080 || height === 2160 ? height : undefined,
                });
              }}
            >
              <option value="best">Best available</option>
              <option value="2160">Up to 2160p</option>
              <option value="1080">Up to 1080p</option>
              <option value="720">Up to 720p</option>
            </select>
          </label>
        </Show>
        <label class="flex flex-col gap-1 text-sm">
          Output
          <select
            class="bg-background rounded-md border px-3 py-2"
            value={props.value.conversion}
            onChange={(event) => {
              const conversion = event.currentTarget.value;
              if (
                conversion === "original" ||
                conversion === "mp4" ||
                conversion === "mp3" ||
                conversion === "m4a"
              )
                props.onChange({ ...props.value, conversion });
            }}
          >
            <option value="original">Original quality · preserve codecs</option>
            <Show
              when={props.value.mode === "video"}
              fallback={
                <>
                  <option value="mp3">Convert to MP3</option>
                  <option value="m4a">M4A · AAC</option>
                </>
              }
            >
              <option value="mp4">MP4 · H.264 + AAC</option>
            </Show>
          </select>
        </label>

        <Show when={props.value.conversion !== "original"}>
          <p class="text-muted-foreground text-xs">
            Conversion takes extra time and may reduce quality.
          </p>
        </Show>
      </Show>
    </fieldset>
  );
}
