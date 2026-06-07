import type { BlobStore } from "../../core/store.ts";
import type { AvatarGetResult, AvatarPutResult, AvatarService } from "./service.ts";

export class BlobStoreAvatarService implements AvatarService {
  constructor(private readonly blobStore: BlobStore) {}

  async put(userId: string, file: File): Promise<AvatarPutResult> {
    const key = await this.blobStore.set("avatars", userId, file);
    return { key };
  }

  async get(userId: string): Promise<AvatarGetResult | null> {
    const res = await this.blobStore.getAsResponse("avatars", userId);
    if (res.status === 404) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mimeType = res.headers.get("Content-Type") ?? "application/octet-stream";
    return { bytes, mimeType };
  }
}
