import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TTL_SECONDS = 3 * 60 * 60;

export const TABLE_COOKIE = "sgr_table";

function getSecret() {
  const secret = process.env.ORDER_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ORDER_SESSION_SECRET must be set to at least 32 characters.");
  }
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// Pseudonymous client key for rate limiting; the raw IP is never stored.
export function hashClient(ip: string | null) {
  return createHmac("sha256", getSecret())
    .update(`client:${ip ?? "unknown"}`)
    .digest("hex")
    .slice(0, 48);
}

export function newNonce() {
  return randomBytes(32).toString("base64url");
}

export function createSessionToken(sessionId: string, nonce: string, slug: string) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const body = `${sessionId}.${nonce}.${expires}.${slug}`;
  return `${sessionId}.${nonce}.${expires}.${sign(body)}`;
}

export type TableSessionToken = { sessionId: string; nonceHash: string };

export function verifySessionToken(
  token: string | undefined,
  slug: string,
): TableSessionToken | null {
  if (!token || token.length > 400) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const [sessionId, nonce, expires, signature] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || Number(expires) < Date.now() / 1000) {
    return null;
  }

  const expected = Buffer.from(sign(`${sessionId}.${nonce}.${expires}.${slug}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  return { sessionId, nonceHash: sha256Hex(nonce) };
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/m",
  maxAge: SESSION_TTL_SECONDS,
};
