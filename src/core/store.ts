import type { NewUserInput, UserData } from "./validation.ts";

export interface StoredUser extends UserData {
  id: string;
}

export interface UserStore {
  findById(id: string, fields?: string[]): Promise<StoredUser | null>;
  findByUsername(
    username: string,
    fields?: string[],
  ): Promise<StoredUser | null>;
  findAll(): Promise<StoredUser[]>;
  createUser(data: NewUserInput): Promise<StoredUser>;
  setPassword(id: string, newPassword: string): Promise<void>;
  updateAvatarKey(id: string, key: string): Promise<void>;
  updateRole(id: string, role: string): Promise<void>;
  changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>;
  deleteUser(id: string): Promise<boolean>;
}

export interface BlobStore {
  set(prefix: string, id: string, file: File): Promise<string>;
  getAsResponse(prefix: string, id: string): Promise<Response>;
  remove(prefix: string, id: string): Promise<void>;
}
