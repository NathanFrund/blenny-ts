import type { DatabaseConnection } from "../../core/db-connection.ts";
import type { AvatarGetResult } from "./service.ts";

export async function getAvatarFromBucket(
  db: DatabaseConnection,
  userId: string,
): Promise<AvatarGetResult | null> {
  const path = `avatars:/${userId}`;
  const [raw] = await db.query(`f'${path}'.get()`);

  let bytes: Uint8Array | null = null;
  if (raw instanceof Uint8Array) {
    bytes = raw;
  } else if (raw instanceof ArrayBuffer) {
    bytes = new Uint8Array(raw);
  }

  if (!bytes) return null;

  const [metaRows] = await db.query(
    "SELECT mimeType FROM type::record('avatar_meta', $id)",
    { id: userId },
  );
  const metaRow = (metaRows as { mimeType?: string }[] | undefined)?.[0];
  const mimeType = metaRow?.mimeType ?? "application/octet-stream";

  return { bytes, mimeType };
}
