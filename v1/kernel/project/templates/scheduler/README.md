# CBIM dream scheduler — Windows Task Scheduler bindings

This directory holds the rendered scheduler artefacts produced by
`cbim project sync` / `cbim init`:

- `dream_trigger.ps1` — the PowerShell trigger script that fires
  headless `claude` with a locked-down MCP tool whitelist. Path to the
  project root is baked in at render time.
- `win_dream_task.xml` — a Windows Task Scheduler task definition (daily
  trigger, default 03:30 local time) that runs `dream_trigger.ps1` under
  the current user's interactive token.

## Register the task (once per machine + project)

Open an elevated PowerShell in the project root and run:

```powershell
schtasks.exe /Create /XML .cbim\scheduler\tools\win_dream_task.xml /TN CbimDreamTick
```

- `/TN CbimDreamTick` — task name Windows uses to reference the entry.
  Pick something else if you already have a task with this name.
- The XML embeds an absolute path to `dream_trigger.ps1`; do not move
  the rendered files around after registration. Re-running
  `cbim project sync` refreshes the XML in place.

## Unregister the task

```powershell
schtasks.exe /Delete /TN CbimDreamTick /F
```

## Verify it runs

- Task Scheduler UI → Task Scheduler Library → `CbimDreamTick` → History
  tab. Each run leaves an entry; a green "Task completed" line means the
  trigger executed. It does NOT mean the dream tick itself succeeded.
- `dream_trigger.ps1` appends one `.cbim/logs/dream_trigger_YYYY-MM-DD.log`
  entry per invocation with the invocation timestamp, the `claude` exit
  code, and any captured output. Read this log to see whether the tick
  itself finished cleanly.
- The dream engine's authoritative record lives at
  `.cbim/scheduler/dream/last_success.json` and per-run directories
  under `.cbim/scheduler/dream/<run_id>/` — the trigger only invokes the
  loop, it does not own the result.

## Troubleshooting

- **`claude` command not found** — the Task Scheduler runs with the
  user's normal `PATH` at logon time, which may miss additions made
  during a shell session. Test with `powershell -NoProfile -Command
  claude --version`. If that fails, either install `claude` to a
  system-wide path or edit `dream_trigger.ps1` to invoke `claude`
  through an absolute path (regeneration on `cbim project sync` will
  clobber that edit — prefer fixing `PATH`).
- **Skipped: dream run in progress** — the trigger log will say so
  when `.cbim/scheduler/dream/current.json` shows a running tick with
  a recent heartbeat. This is the deliberate single-flight gate; the
  next scheduled run will retry. If the heartbeat is genuinely stale
  (>30 min), run `dream_abort` interactively before the next trigger.
- **Task marked failed but log looks clean** — Task Scheduler decides
  success by process exit code. `dream_trigger.ps1` propagates the
  `claude` exit code; a non-zero exit is usually a headless-mode
  timeout or an MCP tool rejection. Inspect the log's captured output
  section.
- **Wrong trigger time** — regenerate with a different `trigger_time`
  via `cbim project sync` (the value flows from
  `.cbim/config.json` → `scheduler.dream_trigger_time`, defaulting to
  `03:30`). Re-registering the task after regeneration is required for
  the schedule change to take effect.

## macOS / Linux

Not yet supplied — the daemon binding (`launchd` plist on macOS,
`systemd --user` timer or cron on Linux) will land in a follow-up. The
`README.md` and `dream_trigger.ps1` are Windows-only for now.
