import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { bookBrief, cancelBrief, rescheduleBrief } from "./__fixtures__/briefs";
import bookDefaultsOmitted from "./__fixtures__/brief-hash/book-defaults-omitted.json";
import bookEscaped from "./__fixtures__/brief-hash/book-escaped.json";
import bookFull from "./__fixtures__/brief-hash/book-full.json";
import bookPractitionerNull from "./__fixtures__/brief-hash/book-practitioner-null.json";
import bookRaisedLimit from "./__fixtures__/brief-hash/book-raised-limit.json";
import bookShuffled from "./__fixtures__/brief-hash/book-shuffled.json";
import cancelPaired from "./__fixtures__/brief-hash/cancel-paired.json";
import { parseBrief, type BriefInput } from "./brief";
import { canonicalJson, revisionHash, sha256Hex } from "./canonical";

describe("canonicalJson: RFC 8785 vectors", () => {
  it("§3.2.2 sample: literals, numbers and string escapes", () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
        '"literals":[null,true,false]}',
    );
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("§3.2.3 sorts keys by UTF-16 code units, not code points", () => {
    const input = JSON.parse(
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh",' +
        '"1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control",' +
        '"\\u00f6":"Latin Small Letter O With Diaeresis"}',
    );
    // Asserted on the string: JSON.parse would put the integer-like key "1" first again.
    expect(canonicalJson(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control",' +
        '"ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign",' +
        '"😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  const fromBits = (hex: string): number => {
    const view = new DataView(new ArrayBuffer(8));
    view.setBigUint64(0, BigInt(`0x${hex}`));
    return view.getFloat64(0);
  };

  it.each([
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ])("Appendix B: IEEE 754 %s serialises as %s", (bits, expected) => {
    expect(canonicalJson(fromBits(bits))).toBe(expected);
  });

  it.each([
    ["NaN", "7fffffffffffffff"],
    ["Infinity", "7ff0000000000000"],
  ])("Appendix B: %s is an error", (_label, bits) => {
    expect(() => canonicalJson(fromBits(bits))).toThrow();
  });

  it("throws on undefined, which has no JSON form", () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });

  it("drops undefined members, as JSON does", () => {
    expect(canonicalJson({ b: 1, a: undefined })).toBe('{"b":1}');
  });

  const reorderKeys = (value: unknown, order: (keys: string[]) => string[]): unknown => {
    if (Array.isArray(value)) return value.map((v) => reorderKeys(v, order));
    if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      return Object.fromEntries(
        order(Object.keys(obj)).map((k) => [k, reorderKeys(obj[k], order)]),
      );
    }
    return value;
  };

  it("property: key order never changes the output", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const reversed = reorderKeys(value, (keys) => [...keys].reverse());
        expect(canonicalJson(reversed)).toBe(canonicalJson(value));
      }),
    );
  });

  it("property: canonical output is valid JSON and a fixed point", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const once = canonicalJson(value);
        expect(canonicalJson(JSON.parse(once))).toBe(once);
      }),
    );
  });
});

describe("sha256Hex", () => {
  it("matches the FIPS 180-2 vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes UTF-8 bytes", () => {
    // "ł" is U+0142, UTF-8 C5 82. Expected value from Python's hashlib.
    expect(sha256Hex("\u0142")).toBe(
      "6bd022e87d92407bdc51339598d8578ce666e8f33dcce747bfdebae2b5d9459b",
    );
  });
});

describe("revisionHash: golden vectors", () => {
  const vectors = {
    bookFull,
    bookShuffled,
    bookEscaped,
    bookDefaultsOmitted,
    bookPractitionerNull,
    bookRaisedLimit,
    cancelPaired,
  };

  it.each(Object.entries(vectors))("%s hashes to its committed value", (_name, vector) => {
    const parsed = parseBrief(vector.brief);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(revisionHash(parsed.value)).toBe(vector.hash);
  });

  it("book-full's canonical form matches an independent JCS (Python), byte for byte", () => {
    const parsed = parseBrief(bookFull.brief);
    if (!parsed.ok) throw new Error("book-full must parse");
    expect(canonicalJson(parsed.value)).toBe(bookFull.canonical);
    expect(`sha256:${sha256Hex(bookFull.canonical)}`).toBe(bookFull.hash);
  });

  it("key order, number spelling, \\u escapes and omitted defaults don't change the hash", () => {
    expect(
      new Set([bookFull, bookShuffled, bookEscaped, bookDefaultsOmitted].map((v) => v.hash)).size,
    ).toBe(1);
  });

  it("an absent optional field and one set to null hash differently", () => {
    expect(bookPractitionerNull.hash).not.toBe(bookFull.hash);
  });

  it("one changed value changes the hash", () => {
    expect(bookRaisedLimit.hash).not.toBe(bookFull.hash);
  });

  it("hashes an unparsed input the same as its parsed Brief", () => {
    expect(revisionHash(bookDefaultsOmitted.brief as BriefInput)).toBe(bookFull.hash);
  });

  it("throws on an invalid Brief: hashing one is a programmer error", () => {
    expect(() => revisionHash({ ...bookBrief, revision: 0 })).toThrow(/revisionHash/);
  });

  it("has the sha256: prefix and 64 hex digits", () => {
    expect(revisionHash(bookBrief)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("revisionHash: properties", () => {
  const unicode = fc.string({ unit: "grapheme", minLength: 1, maxLength: 60 });
  const briefArb = fc
    .record({
      base: fc.constantFrom<BriefInput>(bookBrief, rescheduleBrief, cancelBrief),
      revision: fc.integer({ min: 1, max: 10_000 }),
      displayName: unicode,
      firstName: unicode.filter((s) => s.length <= 50),
      notes: fc.option(fc.string({ unit: "grapheme", maxLength: 300 }), { nil: undefined }),
      maxDialAttempts: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
    })
    .map(({ base, revision, displayName, firstName, notes, maxDialAttempts }) => {
      const brief: Record<string, unknown> = {
        ...base,
        revision,
        business: { ...base.business, displayName },
        forPerson: { firstName },
      };
      if (notes !== undefined) brief["notesForAgent"] = notes;
      if (maxDialAttempts !== undefined) brief["limits"] = { maxDialAttempts };
      return brief;
    })
    .filter((b) => parseBrief(b).ok);

  const shuffleKeys = (value: unknown, pick: (n: number) => number): unknown => {
    if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, pick));
    if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value);
      const out: [string, unknown][] = [];
      while (entries.length > 0) {
        const [entry] = entries.splice(pick(entries.length), 1);
        if (entry) out.push([entry[0], shuffleKeys(entry[1], pick)]);
      }
      return Object.fromEntries(out);
    }
    return value;
  };

  it("never throws for a valid Brief, and parsing is a fixed point", () => {
    fc.assert(
      fc.property(briefArb, (input) => {
        const parsed = parseBrief(input);
        if (!parsed.ok) throw new Error("filtered");
        const again = parseBrief(parsed.value);
        expect(again.ok && revisionHash(again.value)).toBe(revisionHash(parsed.value));
      }),
    );
  });

  it("is independent of key order", () => {
    fc.assert(
      fc.property(briefArb, fc.infiniteStream(fc.nat()), (input, stream) => {
        const it = stream[Symbol.iterator]();
        const pick = (n: number): number => (it.next().value as number) % n;
        expect(revisionHash(shuffleKeys(input, pick) as BriefInput)).toBe(
          revisionHash(input as BriefInput),
        );
        // zod rebuilds objects in schema order, so also shuffle *after* parsing: that is what
        // proves canonicalJson sorts, rather than inheriting zod's order.
        const parsed = parseBrief(input);
        if (!parsed.ok) throw new Error("filtered");
        expect(canonicalJson(shuffleKeys(parsed.value, pick))).toBe(canonicalJson(parsed.value));
      }),
    );
  });

  it("survives a JSON round trip (what the database stores)", () => {
    fc.assert(
      fc.property(briefArb, (input) => {
        expect(revisionHash(JSON.parse(JSON.stringify(input)) as BriefInput)).toBe(
          revisionHash(input as BriefInput),
        );
      }),
    );
  });

  it("changes when the revision number changes", () => {
    fc.assert(
      fc.property(briefArb, (input) => {
        const next = { ...input, revision: (input["revision"] as number) + 1 };
        expect(revisionHash(next as BriefInput)).not.toBe(revisionHash(input as BriefInput));
      }),
    );
  });
});
