/**
 * Assert that a value is not null or undefined.
 * Throws an error if the assertion fails.
 */
export function asserted<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new Error(message ?? "Assertion failed: value was null or undefined");
  }
  return value;
}
