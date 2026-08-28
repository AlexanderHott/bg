import { createSignal, Show, type JSX } from "solid-js";
import { Button } from "./Button";

export interface SensitiveProps {
  fallback: JSX.Element;
  children: JSX.Element;
}

export function Sensitive(props: Readonly<SensitiveProps>) {
  const [revealed, setRevealed] = createSignal(false);

  return (
    <Button
      variant="ghost"
      onClick={() => setRevealed(!revealed())}
      classList={{
        "blur-xs": !revealed(),
      }}
    >
      <Show when={revealed()} fallback={props.fallback}>
        {props.children}
      </Show>
    </Button>
  );
}
