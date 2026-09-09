import { createSignal, onCleanup, onMount } from "solid-js";

/** Tracks an element's border-box height for positioning content below it. */
export function createElementHeight() {
  const [height, setHeight] = createSignal<string>();
  let element: HTMLElement;

  onMount(() => {
    const measure = () => setHeight(`${element.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(element, { box: "border-box" });
    onCleanup(() => observer.disconnect());
  });

  return {
    height,
    ref: (node: HTMLElement) => {
      element = node;
    },
  };
}
