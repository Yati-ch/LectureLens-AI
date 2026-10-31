import crypto from "node:crypto";

/** Account recovery codes: one-time-display secrets that let a student reset a forgotten password without email. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L lookalikes
const CODE_LENGTH = 16; // ~79 bits of entropy

/** Generate a code like "K7QM-2XPA-9TRD-WH4N" using unbiased random sampling. */
export function generateRecoveryCode() {
  let out = "";
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < CODE_LENGTH) {
    for (const byte of crypto.randomBytes(32)) {
      if (byte < limit && out.length < CODE_LENGTH) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out.match(/.{4}/g).join("-");
}

/** Accept lowercase, spaces and missing dashes when a student types the code back in. */
export function normalizeRecoveryCode(input) {
  return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 64);
}

/** Salted scrypt hash, stored as "salt:digest" like passwords. */
export function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(secret, salt, 64).toString("hex")}`;
}

export function verifySecret(secret, stored) {
  const [salt, digest] = String(stored || "").split(":");
  if (!salt || !digest) return false;
  const got = crypto.scryptSync(secret, salt, 64);
  const want = Buffer.from(digest, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const hashRecoveryCode = (code) => hashSecret(normalizeRecoveryCode(code));
export const verifyRecoveryCode = (code, stored) => verifySecret(normalizeRecoveryCode(code), stored);

// Verified against when no real hash exists, so unknown emails take as long as real ones.
const DUMMY_HASH = hashSecret("no-such-account");
export const verifyRecoveryCodeOrDummy = (code, stored) => {
  const ok = verifyRecoveryCode(code, stored || DUMMY_HASH);
  return Boolean(stored) && ok;
};
