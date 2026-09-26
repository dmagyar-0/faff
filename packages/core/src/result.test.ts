import { describe, expect, it } from "vitest";

import { err, ok } from "./result";

describe("Result", () => {
  it("ok carries a value", () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
  });

  it("err carries a reason, and a detail only when there is one", () => {
    expect(err("in_past")).toEqual({ ok: false, reason: "in_past" });
    expect("detail" in err("in_past")).toBe(false);
    expect(err("not_in_window", ["a"])).toEqual({
      ok: false,
      reason: "not_in_window",
      detail: ["a"],
    });
  });
});
