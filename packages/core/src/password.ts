/**
 * Passwords and browser sessions.
 *
 * scrypt comes with Node, so this adds no native dependency and no build step
 * on the deployment box. Parameters are stored inside each hash, so they can
 * be raised later without invalidating existing passwords.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { hashToken } from "./tokens";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 };

export const MIN_PASSWORD_LENGTH = 12;

/** `scrypt$N$r$p$salt$hash`, everything needed to verify it later. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plain.normalize("NFKC"), salt, KEY_LENGTH, DEFAULT_PARAMS);
  const { N, r, p } = DEFAULT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const expected = Buffer.from(hashRaw!, "base64");
  let derived: Buffer;
  try {
    derived = await scrypt(plain.normalize("NFKC"), Buffer.from(saltRaw!, "base64"), expected.length, {
      N,
      r,
      p,
    });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Reject the passwords that make a breach trivial, without being precious about it. */
export function passwordProblem(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (/^\s|\s$/.test(plain)) return "Remove the leading or trailing spaces.";
  if (/^(.)\1+$/.test(plain)) return "That is a single repeated character.";
  return null;
}

export interface GeneratedSession {
  token: string;
  tokenHash: string;
}

/**
 * The cookie carries a random token; only its sha256 is stored. A stolen
 * database row cannot be replayed as a session, and any session can be
 * revoked by deleting its row.
 */
export function generateSessionToken(): GeneratedSession {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export { hashToken as hashSessionToken };
