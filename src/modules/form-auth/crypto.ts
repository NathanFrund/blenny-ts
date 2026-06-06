import { withSpan } from "../../core/tracing.ts";

async function pbkdf2(password: string, salt: string): Promise<string> {
  return withSpan("auth.deriveKey", async (_span) => {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode(salt),
        iterations: 100_000,
        hash: "SHA-256",
      },
      keyMaterial,
      256,
    );
    return Array.from(new Uint8Array(bits))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  });
}

function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deriveKey(password: string): Promise<{ hash: string; salt: string }> {
  const salt = generateSalt();
  const hash = await pbkdf2(password, salt);
  return { hash, salt };
}

export async function verifyKey(password: string, salt: string): Promise<string> {
  return await pbkdf2(password, salt);
}
