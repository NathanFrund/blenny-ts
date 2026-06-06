# Follow-ups: TaskSupervisor enhancements

## 1. OTel instrumentation

Each task run creates a `task.{name}` span with duration, plus a failure-count
up/down counter. Follows the existing pattern in `hub.ts`, `auth.ts`,
`crypto.ts`.

```ts
// inside TaskSupervisor.run():
withSpan(`task.${name}`, async (span) => {
  span.setAttribute("task.interval", task.intervalMs);
  await task.fn();
  task.failures = 0;
}, { attributes: { "task.max_backoff": task.maxBackoff } });
```

On failure: `span.setStatus({ code: SpanStatusCode.ERROR })` +
`recordException`.

Also add `task.active` gauge (up on `start()`, down on `stop()`) and `task.runs`
counter.

## 2. Status endpoint

A `GET /system/tasks` endpoint exposing the supervisor's task registry:

```json
{
  "tasks": [
    { "name": "clock", "intervalMs": 1000, "failures": 0, "running": true },
    { "name": "reaper", "intervalMs": 30000, "failures": 0, "running": true }
  ]
}
```

The supervisor is already on `AppState`, so wiring this into
`registerPlatformEndpoints` is a few lines.

## 3. Pause/resume individual tasks

Currently only global `start()`/`stop()`. Some modules may want to throttle
specific tasks without killing all of them.

```ts
supervisor.pause("flush-dirty"); // cancel timer, keep task config
supervisor.resume("flush-dirty"); // restart from task config
supervisor.isPaused("flush-dirty"); // boolean check

// Or alternative API:
supervisor.stop("flush-dirty");
supervisor.start("flush-dirty");
```
