import {
  configure,
  getAnsiColorFormatter,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogfmtFormatter,
  getLogger,
  getThrottlingFilter,
  type Logger,
  reset as logtapeReset,
} from "@logtape/logtape";
import type { MiddlewareHandler } from "@hono/hono";
import type { BlennyConfig } from "./config.ts";
import { publish, subscribe } from "./hub.ts";

// ── Interface ──────────────────────────────────────────────

export interface BlennyLogger {
  debug(template: string, ...args: unknown[]): void;
  info(template: string, ...args: unknown[]): void;
  warn(template: string, ...args: unknown[]): void;
  error(template: string, ...args: unknown[]): void;
  error(error: unknown, props?: Record<string, unknown>): void;
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

  error(template: string, ...args: unknown[]): void;
  error(error: unknown, props?: Record<string, unknown>): void;
  error(
    templateOrError: string | unknown,
    ...args: unknown[]
  ): void {
    if (typeof templateOrError === "string") {
      (this.logger.error as (msg: string, ...args: unknown[]) => void)(
        templateOrError,
        ...args,
      );
    } else {
      const props = args[0] as Record<string, unknown> | undefined;
      if (props) {
        (this.logger.error as (
          err: unknown,
          props: Record<string, unknown>,
        ) => void)(
          templateOrError,
          props,
        );
      } else {
        (this.logger.error as (err: unknown) => void)(templateOrError);
      }
    }
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
  const timezone = config.logTimezone;
  const throttleLimit = config.logThrottleLimit;
  const throttleWindowMs = config.logThrottleWindowMs;

  const formatterOptions = timezone ? { timeZone: timezone } : undefined;

  const formatter = format === "json"
    ? getJsonLinesFormatter()
    : format === "logfmt"
    ? getLogfmtFormatter(formatterOptions)
    : getAnsiColorFormatter(formatterOptions);

  const { parseLogLevel } = await import("@logtape/logtape");

  const throttleFilter = throttleLimit > 0
    ? getThrottlingFilter({
      limit: throttleLimit,
      windowMs: throttleWindowMs,
      summary: {
        logger: getLogger(["blenny", "log-throttle"]),
        level: "warning",
        message: "Log message suppressed {suppressed} times.",
      },
    })
    : undefined;

  await configure({
    ...(throttleFilter ? { filters: { throttle: throttleFilter } } : {}),
    sinks: {
      console: getConsoleSink({ formatter }),
    },
    loggers: [{
      category: ["blenny"],
      sinks: ["console"],
      filters: throttleFilter ? ["throttle"] : undefined,
      lowestLevel: parseLogLevel(level),
    }, {
      category: ["logtape", "meta"],
      sinks: ["console"],
      lowestLevel: parseLogLevel("warning"),
    }],
  });

  const logger = new LogTapeBlennyLogger(getLogger(["blenny"]));

  subscribe("log", (payload) => {
    const { level: lvl, template, args } = payload;
    if (payload.error) {
      logger.error(payload.error, payload.errorProps);
    } else {
      logger[lvl](template, args ?? {});
    }
  });

  return logger;
}

export async function resetLogger(): Promise<void> {
  await logtapeReset();
}

// ── Null logger (tests / silent mode) ──────────────────────

export const NULL_LOGGER: BlennyLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (_templateOrError: string | unknown, ..._args: unknown[]) => {},
  child: () => NULL_LOGGER,
};

// ── Request logging middleware ─────────────────────────────

export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const url = new URL(c.req.url);
    const status = c.res.status;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    publish("log", {
      level,
      template: "{method} {path} {status} {duration}ms",
      args: { method: c.req.method, path: url.pathname, status, duration },
    });
  };
}
