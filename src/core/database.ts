import type { BlennyConfig } from "./config.ts";
import { DbManager } from "./db-manager.ts";

export async function connectDatabase(
  config: BlennyConfig,
): Promise<DbManager | null> {
  const manager = new DbManager(config);
  await manager.connect();
  return manager.connected ? manager : null;
}
