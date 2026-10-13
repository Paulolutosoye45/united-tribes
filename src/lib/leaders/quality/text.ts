/**
 * Words, the way the database counts them: a run of letters is a word, a run of symbols or digits is not.
 * Yoruba, Igbo and Hausa letters count. This must agree with leader_word_count() in the database.
 */
export function countWords(text: string): number {
  return (text ?? "")
    .trim()
    .split(/\s+/)
    .filter((w) => /[A-Za-zÀ-ɏḀ-ỿ]/.test(w)).length;
}

/** Lower case, no accents, letters and digits only, single spaces. Used to compare two texts, never shown. */
export function normalise(text: string): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function tokens(text: string): string[] {
  const flat = normalise(text);
  return flat ? flat.split(" ") : [];
}

// BigInt() calls rather than literals: the project compiles for an older target than BigInt literals need.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const BITS = BigInt(64);
const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const MIX = BigInt("0xff51afd7ed558ccd");
const SHIFT = BigInt(33);
const MASK = (ONE << BITS) - ONE;

function fnv1a64(text: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK;
  }
  // FNV is weak in its high bits for short inputs; one more round of mixing spreads them.
  hash ^= hash >> SHIFT;
  hash = (hash * MIX) & MASK;
  hash ^= hash >> SHIFT;
  return hash;
}

/**
 * A 64-bit fingerprint where similar texts get similar numbers. Word pairs are the features, so changing a few
 * words changes a few bits. Returned as a signed decimal string, which is what the database's bigint takes
 * (a JavaScript number cannot hold 64 bits).
 */
export function simhash(text: string): string {
  const words = tokens(text);
  const features = words.length > 1 ? words.slice(0, -1).map((w, i) => `${w} ${words[i + 1]}`) : words;
  const votes = new Array<number>(64).fill(0);
  for (const feature of features) {
    const h = fnv1a64(feature);
    for (let bit = 0; bit < 64; bit++) votes[bit] += (h >> BigInt(bit)) & ONE ? 1 : -1;
  }
  let out = ZERO;
  for (let bit = 0; bit < 64; bit++) if (votes[bit] > 0) out |= ONE << BigInt(bit);
  return BigInt.asIntN(64, out).toString();
}

/** How many of the 64 bits differ. */
export function hamming(a: string, b: string): number {
  let x = BigInt.asUintN(64, BigInt(a)) ^ BigInt.asUintN(64, BigInt(b));
  let n = 0;
  while (x) {
    n += Number(x & ONE);
    x >>= ONE;
  }
  return n;
}
