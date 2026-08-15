import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, SCRYPT_OPTIONS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newSessionId(): string {
  return randomBytes(32).toString("hex");
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  const parts = [`sid=${token}`, "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${SESSION_TTL_SECONDS}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.header("set-cookie", sessionCookieHeader(token, secure));
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.header("set-cookie", `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`);
}

export function parseSessionCookie(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "sid") return rest.join("=");
  }
  return null;
}
