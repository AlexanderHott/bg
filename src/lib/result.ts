export interface Ok<T> {
  ok: true;
  value: T;
}
export interface Err<E> {
  ok: false;
  error: E;
}
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true as const, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false as const, error };
}

export function trySync<T>(fn: () => T): Result<T, unknown> {
  try {
    const value = fn();
    return ok(value);
  } catch (error) {
    return err(error);
  }
}

export async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, unknown>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (error) {
    return err(error);
  }
}
