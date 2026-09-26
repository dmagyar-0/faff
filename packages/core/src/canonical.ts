/**
 * Canonical JSON and the revision hash (P3). The web card, the approval RPC and the worker must
 * all produce the same bytes for the same Brief, so this is the only place either is computed.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import canonicalize from "canonicalize";

import { BriefV1, type Brief, type BriefInput } from "./brief";

/**
 * RFC 8785 JSON Canonicalization Scheme. Throws on values JSON can't represent (`NaN`,
 * `Infinity`, `undefined` at the top level): passing one is a programmer error.
 */
export const canonicalJson = (value: unknown): string => {
  const out = canonicalize(value);
  if (out === undefined) throw new TypeError("canonicalJson: the value has no JSON form");
  return out;
};

export type RevisionHash = `sha256:${string}`;

export const sha256Hex = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));

/**
 * `"sha256:" + hex(SHA-256(UTF-8(JCS(BriefV1.parse(brief)))))`.
 *
 * It hashes the **parsed** Brief, after defaults are applied and refinements checked, so two
 * producers that differ only in omitted defaulted fields get the same hash. An invalid Brief is a
 * programmer error here (parse it first with `parseBrief`), so it throws.
 */
export const revisionHash = (brief: Brief | BriefInput): RevisionHash => {
  const parsed = BriefV1.safeParse(brief);
  if (!parsed.success) {
    throw new TypeError(`revisionHash: not a valid faff.brief/v1 (${parsed.error.message})`);
  }
  return `sha256:${sha256Hex(canonicalJson(parsed.data))}`;
};
