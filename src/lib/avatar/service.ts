export interface AvatarPutResult {
  key: string;
}

export interface AvatarGetResult {
  bytes: Uint8Array;
  mimeType: string;
}

export interface AvatarService {
  put(userId: string, file: File): Promise<AvatarPutResult>;
  get(userId: string): Promise<AvatarGetResult | null>;
}
