const WORKER_ID = crypto.randomUUID();

export function getWorkerId(): string {
  return WORKER_ID;
}

export function isServeMode(): boolean {
  return Deno.env.get("BLENNY_RUN_MODE") === "serve";
}
