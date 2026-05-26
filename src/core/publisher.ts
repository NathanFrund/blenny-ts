import { TransportHub } from "./hub.ts";

let hubInstance: TransportHub | null = null;

export class BlennyPublisher {
  static init(hub: TransportHub): void {
    hubInstance = hub;
  }

  static reset(): void {
    hubInstance = null;
  }

  static broadcastHtml(html: string): void {
    if (!hubInstance) throw new PublisherError("BlennyPublisher not initialized — call BlennyPublisher.init(hub) at boot");
    hubInstance.patchElements(html);
  }

  static directHtml(html: string, userId: string): void {
    if (!hubInstance) throw new PublisherError("BlennyPublisher not initialized — call BlennyPublisher.init(hub) at boot");
    hubInstance.patchElements(html, { userId });
  }

  static broadcastData(data: string): void {
    if (!hubInstance) throw new PublisherError("BlennyPublisher not initialized — call BlennyPublisher.init(hub) at boot");
    hubInstance.mergeSignals(JSON.parse(data) as Record<string, unknown>, { intent: "data" });
  }

  static directData(data: string, userId: string): void {
    if (!hubInstance) throw new PublisherError("BlennyPublisher not initialized — call BlennyPublisher.init(hub) at boot");
    hubInstance.mergeSignals(JSON.parse(data) as Record<string, unknown>, { intent: "data", userId });
  }
}

export class PublisherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublisherError";
  }
}
