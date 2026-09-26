/**
 * Results, not throws (M1 plan §2). Domain outcomes are returned values because their reasons
 * are data: they go into `task_events`, escalations and tool responses. Throwing is reserved for
 * programmer errors, such as an unparsed Brief reaching a function that needs a parsed one.
 *
 * Reason codes are exported string-literal unions, so the worker, the tools and the graders
 * match on the same values.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<R extends string, D = unknown> = {
  readonly ok: false;
  readonly reason: R;
  readonly detail?: D;
};
export type Result<T, R extends string, D = unknown> = Ok<T> | Err<R, D>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <R extends string, D = unknown>(reason: R, detail?: D): Err<R, D> =>
  detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
