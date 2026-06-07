import type { Surreal } from "@surrealdb/surrealdb";
import type { AvatarGetResult, AvatarPutResult, AvatarService } from "./service.ts";

export class SurrealBucketAvatarService implements AvatarService {
  constructor(private readonly db: Surreal) {}

  async put(userId: string, file: File): Promise<AvatarPutResult> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = `avatars:/${userId}`;
    await this.db.query(`f'${path}'.put($bytes)`, { bytes });
    await this.db.query(
      "UPSERT type::record('avatar_meta', $id) MERGE { mimeType: $mime }",
      { id: userId, mime: file.type },
    );
    return { key: `avatars:${userId}` };
  }

  async get(userId: string): Promise<AvatarGetResult | null> {
    const path = `avatars:/${userId}`;
    const [raw] = await this.db.query(`f'${path}'.get()`);

    let bytes: Uint8Array | null = null;
    if (raw instanceof Uint8Array) {
      bytes = raw;
    } else if (raw instanceof ArrayBuffer) {
      bytes = new Uint8Array(raw);
    }

    if (!bytes) return null;

    const [metaRows] = await this.db.query(
      "SELECT mimeType FROM type::record('avatar_meta', $id)",
      { id: userId },
    );
    const metaRow = (metaRows as { mimeType?: string }[] | undefined)?.[0];
    const mimeType = metaRow?.mimeType ?? "application/octet-stream";

    return { bytes, mimeType };
  }
}
