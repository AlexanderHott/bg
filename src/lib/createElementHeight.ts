import { createSignal, onSettled } from "solid-js";

/** Tracks an element's border-box height for positioning content below it. */
export function createElementHeight() {
  const [height, setHeight] = createSignal<string>();
  let element: HTMLElement;

  onSettled(() => {
    const measure = () => setHeight(`${element.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(element, { box: "border-box" });
    return () => observer.disconnect();
  });

  return {
    height,
    ref: (node: HTMLElement) => {
      element = node;
    },
  };
}
