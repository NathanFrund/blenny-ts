import {
  configure,
  getAnsiColorFormatter,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogger,
  type Logger,
  reset as logtapeReset,
} from "@logtape/logtape";
import type { MiddlewareHandler } from "@hono/hono";
import type { BlennyConfig } from "./config.ts";

// ── Interface ──────────────────────────────────────────────

export interface BlennyLogger {
  debug(template: string, ...args: unknown[]): void;
  info(template: string, ...args: unknown[]): void;
  warn(template: string, ...args: unknown[]): void;
  error(template: string, ...args: unknown[]): void;
  child(context: Record<string, unknown>): BlennyLogger;
}

// ── LogTape implementation ─────────────────────────────────

class LogTapeBlennyLogger implements BlennyLogger {
  constructor(private logger: Logger) {}

  debug(template: string, ...args: unknown[]): void {
    (this.logger.debug as (msg: string, ...args: unknown[]) => void)(
      template,
      ...args,
    );
  }

  info(template: string, ...args: unknown[]): void {
    (this.logger.info as (msg: string, ...args: unknown[]) => void)(
      template,
      ...args,
    );
  }

  warn(template: string, ...args: unknown[]): void {
    (this.logger.warn as (msg: string, ...args: unknown[]) => void)(
      template,
      ...args,
    );
  }

  error(template: string, ...args: unknown[]): void {
    (this.logger.error as (msg: string, ...args: unknown[]) => void)(
      template,
      ...args,
    );
  }

  child(context: Record<string, unknown>): BlennyLogger {
    return new LogTapeBlennyLogger(this.logger.with(context));
  }
}

// ── Factory ────────────────────────────────────────────────

export async function createLogger(
  config: BlennyConfig,
): Promise<BlennyLogger> {
  const level = config.logLevel;
  const format = config.logFormat;

  const formatter = format === "json"
    ? getJsonLinesFormatter()
    : getAnsiColorFormatter();
  const { parseLogLevel } = await import("@logtape/logtape");

  await configure({
    sinks: {
      console: getConsoleSink({ formatter }),
    },
    loggers: [{
      category: ["blenny"],
      sinks: ["console"],
      lowestLevel: parseLogLevel(level),
    }, {
      category: ["logtape", "meta"],
      sinks: ["console"],
      lowestLevel: parseLogLevel("warning"),
    }],
  });

  return new LogTapeBlennyLogger(getLogger(["blenny"]));
}

export async function resetLogger(): Promise<void> {
  await logtapeReset();
}

// ── Null logger (tests / silent mode) ──────────────────────

export const NULL_LOGGER: BlennyLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NULL_LOGGER,
};

// ── Request logging middleware ─────────────────────────────

export function requestLogger(logger: BlennyLogger): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const url = new URL(c.req.url);
    const status = c.res.status;
    const method = c.req.method;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    const reqLog = logger.child({
      method,
      path: url.pathname,
      status,
      duration,
    });
    reqLog[level](`${method} ${url.pathname} ${status} ${duration}ms`);
  };
}
