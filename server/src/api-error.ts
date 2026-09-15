// The error type every route maps to a JSON body.
//
// It lives on its own because everything in the server throws it — stores,
// routes, the generator — and none of them should have to import an addressing
// module to do so.

/**
 * Error with an HTTP status; route handlers map it to a JSON error body.
 * `extra` is merged into the body next to `error` (e.g. the current rev
 * on a 409 conflict).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}
