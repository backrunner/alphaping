/** A deadline covers both response headers and body consumption. */
export function createRequestScope(timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request timed out. Please retry.", "TimeoutError")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
    cancel: () => {
      clearTimeout(timer);
      controller.abort();
    },
  };
}
