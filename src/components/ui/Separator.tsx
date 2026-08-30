import { Separator as KBSeparator } from "@kobalte/core/separator";
function Separator() {
  return (
    <KBSeparator
      data-slot="separator"
      orientation={"horizontal"}
      class="bg-border shrink-0 data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch"
    />
  );
}
export { Separator };
