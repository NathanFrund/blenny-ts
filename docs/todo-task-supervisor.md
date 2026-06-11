# Follow-ups: TaskSupervisor enhancements

## 1. Status endpoint

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

## 2. Pause/resume individual tasks

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
