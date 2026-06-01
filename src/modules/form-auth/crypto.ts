import { tracer } from "../../core/tracing.ts";

function deriveKey(password: string, salt: string): Promise<string> {
  return tracer.startActiveSpan("auth.deriveKey", async (span) => {
    try {
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
    } finally {
      span.end();
    }
  });
}

export { deriveKey };
