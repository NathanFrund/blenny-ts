import { TransportHub } from "./hub.ts";
import { SignalSchema } from "./validation.ts";
import type { SignalData } from "./validation.ts";
import * as v from "@valibot/valibot";

let hubInstance: TransportHub | null = null;

/**
 * Zero-ceremony real-time broadcast for ad-hoc use.
 *
 * Module code should prefer `state.hub.action(...)` for explicitness.
 * This static API exists for timers, event callbacks, and CLI tools
 * where threading a hub reference is overhead.
 *
 * Singleton tradeoff: tests use BlennyPublisher.reset() for isolation.
 * In production there is one hub per process; the singleton mirrors that.
 */
export class BlennyPublisher {
  static init(hub: TransportHub): void {
    if (hubInstance && hubInstance !== hub) {
      throw new PublisherError(
        "BlennyPublisher already initialized with a different hub — call reset() first",
      );
    }
    hubInstance = hub;
  }

  static reset(): void {
    hubInstance = null;
  }

  /**
   * Broadcast HTML to all connected clients.
   * Content is sent verbatim — escape user-provided text with `escapeHtml()`
   * from `src/core/validation.ts` to avoid XSS.
   */
  static broadcastHtml(html: string): void {
    if (!hubInstance) throw new PublisherError("BlennyPublisher not initialized — call BlennyPublisher.init(hub) at boot");
    hubInstance.patchElements(html);
  }

  /**
   * Send HTML to a specific user.
   * Content is sent verbatim — escape user-provided text with `escapeHtml()`
   * from `src/core/validation.ts` to avoid XSS.
   */
  static directHtml(html: string, userId: string): void {
    if (!hubInstance) throw new PublisherError("BlennyPublisher not initialized — call BlennyPublisher.init(hub) at boot");
    hubInstance.patchElements(html, { userId });
  }

  static broadcastData(data: string): void {
    if (!hubInstance) throw new PublisherError("BlennyPublisher not initialized — call BlennyPublisher.init(hub) at boot");
    const parsed = parseJsonData(data);
    hubInstance.mergeSignals(parsed, { intent: "data" });
  }

  static directData(data: string, userId: string): void {
    if (!hubInstance) throw new PublisherError("BlennyPublisher not initialized — call BlennyPublisher.init(hub) at boot");
    const parsed = parseJsonData(data);
    hubInstance.mergeSignals(parsed, { intent: "data", userId });
  }
}

function parseJsonData(data: string): SignalData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new PublisherError("broadcastData/directData received invalid JSON");
  }
  const result = v.safeParse(SignalSchema, parsed);
  if (!result.success) {
    throw new PublisherError(
      "broadcastData/directData requires a JSON object — received: " + typeof parsed,
    );
  }
  return result.output;
}

export class PublisherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublisherError";
  }
}
