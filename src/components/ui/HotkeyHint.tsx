import { createFormatForDisplay, type DisplayHotkey } from "@tanstack/solid-hotkeys";

/** Renders ` · g h` after a label: `<>settings<HotkeyHint hotkey={["G", "S"]} /></>`. Hidden on touch screens. */
export function HotkeyHint(props: { hotkey: DisplayHotkey }) {
  const formatForDisplay = createFormatForDisplay();
  return (
    <span class="pointer-coarse:hidden">
      {" "}
      · {formatForDisplay(props.hotkey).toLocaleLowerCase()}
    </span>
  );
}
