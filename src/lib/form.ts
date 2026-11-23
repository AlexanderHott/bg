// Solid 2 bindings for @tanstack/form-core. Replace with @tanstack/solid-form once it
// ships Solid 2 (TanStack/form#2464).
import { createSignal, onCleanup, onSettled, type Accessor } from "solid-js";

interface StoreSource<TState> {
  get: () => TState;
  subscribe: (listener: (state: TState) => void) => { unsubscribe: () => void };
}

/** Selects from a form-core store (`form.store`, `field.store`) as an accessor. */
export function useSelector<TState, TSelected>(
  source: StoreSource<TState>,
  selector: (state: TState) => TSelected,
): Accessor<TSelected> {
  // Stores notify synchronously from wherever the write happened, which can be an owned scope.
  const [selected, setSelected] = createSignal(() => selector(source.get()), { ownedWrite: true });
  const { unsubscribe } = source.subscribe((state) => setSelected(() => selector(state)));
  onCleanup(unsubscribe);
  return selected;
}

/** Mounts `form` while the calling component is alive: `const form = useForm(new FormApi({...}))`. */
export function useForm<TForm extends { mount: () => () => void }>(form: TForm): TForm {
  onSettled(() => form.mount());
  return form;
}

/**
 * Mounts `field` while the calling component is alive. The accessor notifies on every
 * field state change, so read `field().state` where it's rendered.
 */
export function useField<TField extends { mount: () => () => void; store: StoreSource<unknown> }>(
  field: TField,
): Accessor<TField> {
  const state = useSelector(field.store, (state) => state);
  onSettled(() => field.mount());
  return () => {
    state();
    return field;
  };
}
