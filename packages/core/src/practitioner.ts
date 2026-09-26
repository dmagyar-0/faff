/**
 * Practitioner names are compared after case-folding and stripping titles and punctuation
 * (M1 plan §3.4), so "Dr. Patel", "dr patel" and "Patel" name the same person.
 */
const TITLES = new Set(["dr", "doctor", "mr", "mrs", "ms", "miss", "mx", "prof", "professor"]);

export const normalisePractitioner = (name: string): string =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !TITLES.has(word))
    .join(" ");

export const samePractitioner = (a: string, b: string): boolean =>
  normalisePractitioner(a) === normalisePractitioner(b);
