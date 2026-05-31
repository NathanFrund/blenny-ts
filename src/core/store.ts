import type { NewUserInput, UserData } from "./validation.ts";

export interface StoredUser extends UserData {
  id: string;
}

export interface UserStore {
  findById(id: string): Promise<StoredUser | null>;
  findByUsername(username: string): Promise<StoredUser | null>;
  createUser(data: NewUserInput): Promise<StoredUser>;
  updatePasswordHash(id: string, newHash: string): Promise<void>;
  updateAvatarKey(id: string, key: string): Promise<void>;
  deleteUser(id: string): Promise<boolean>;
}

export interface BlobStore {
  set(prefix: string, id: string, file: File): Promise<string>;
  getAsResponse(prefix: string, id: string): Promise<Response>;
  remove(prefix: string, id: string): Promise<void>;
}
