import "server-only";
import { createHash } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Member } from "@/lib/generated/prisma/client";

const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("AUTH_SECRET is not set.");
const encodedKey = new TextEncoder().encode(secret);

// Ties the token to the password's current state, not just to time. Once the
// password actually changes, this fingerprint no longer matches, so the same
// link can't be reused even if it hasn't expired yet - no separate
// "used tokens" table needed to enforce single-use.
function fingerprint(member: Pick<Member, "passwordHash">): string {
  return createHash("sha256").update(member.passwordHash ?? "none").digest("hex");
}

export async function createResetToken(member: Member): Promise<string> {
  return new SignJWT({ memberId: member.id, purpose: "password_reset", pw: fingerprint(member) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(encodedKey);
}

export async function verifyResetToken(token: string, member: Member): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    return (
      payload.purpose === "password_reset" &&
      payload.memberId === member.id &&
      payload.pw === fingerprint(member)
    );
  } catch {
    return false;
  }
}

export async function decodeResetToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    return typeof payload.memberId === "number" && payload.purpose === "password_reset" ? payload.memberId : null;
  } catch {
    return null;
  }
}
