import type { DatabaseConnection } from "@blenny/core/db-connection.ts";
import type {
  AvatarPutResult,
  AvatarService,
} from "@blenny/lib/avatar/service.ts";
import { getAvatarFromBucket } from "@blenny/lib/avatar/surreal.ts";
import type { AvatarGetResult } from "@blenny/lib/avatar/service.ts";

export class SurrealBucketAvatarService implements AvatarService {
  constructor(private readonly db: DatabaseConnection) {}

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

  get(userId: string): Promise<AvatarGetResult | null> {
    return getAvatarFromBucket(this.db, userId);
  }
}
