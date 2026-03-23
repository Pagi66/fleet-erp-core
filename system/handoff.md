# Handoff

## Current Capabilities
- Event-driven compliance engine with shared event bus and engine routing.
- Daily log enforcement flow.
- PMS task generation, overdue handling, replanning, and notification.
- Defect reporting and escalation based on severity and ETTR.
- Shared task model with lifecycle, escalation tracking, and history.
- File-based persistence with backup fallback and validation.
- Central logging, runtime safeguards, health checks, HTTP endpoints, configuration, and RBAC.

## Modules Implemented
- Core: `src/core/types.ts`, `src/core/store.ts`, `src/core/engine.ts`, `src/core/logger.ts`, `src/core/config.ts`, `src/core/rbac.ts`
- Events: `src/events/event-system.ts`, `src/events/log-events.ts`, `src/events/pms-events.ts`, `src/events/defect-events.ts`, `src/events/scheduler.ts`
- Rules: `src/rules/daily-log.rule.ts`, `src/rules/pms-task.rule.ts`, `src/rules/defect.rule.ts`
- Actions: task/compliance/escalation actions under `src/actions/`
- HTTP: `src/http/server.ts`
- App bootstrap: `src/index.ts`

## Pending Work
- No active in-session implementation task pending after workflow logging setup.
- Future work should continue appending to `system/session-log.md` and updating task trackers per turn.
- Automated actions now rely on explicit `SYSTEM` actor injection from scheduler/event paths through engine dispatch; manual task completion uses explicit role input via HTTP.
- Latest bookkeeping update appended to workflow tracking files for the completed role-consistency validation pass.
- Final validation pass completed: task `assignedRole` now excludes `SYSTEM` across task model, persistence validation, PMS event creation, and HTTP input validation.
- Multi-ship task scoping is now in place: task queries require `shipId`, and task-producing events carry `shipId`.
- Ship isolation is now hardened: task-event processing rejects missing `shipId`, task actions validate ship context, and cross-ship task-id reuse is rejected.
- Event deduplication, task history snapshots, replanning lineage, and health reporting are now ship-aware.
- Daily log enforcement is now ship-scoped for logs, compliance, notifications, escalations, and scheduler-emitted daily events.
- In-app notifications are now persisted and exposed by ship and role.
- Notification persistence now includes dedupe keys, and duplicate notification creation no-ops in the store.

## Known Issues
- Legacy empty placeholder files still exist from earlier scaffolding: `src/actions/logActions.ts`, `src/rules/logRules.ts`, and old empty directories/files outside the current concrete architecture.
- Session workflow logging is file-based and manual by agent convention, not enforced by runtime automation.

## Next Steps
- Keep using `context/index.md` first for every task.
- Load only the relevant rule and flow files for the task at hand.
- Append a new action entry to `system/session-log.md` after every concrete change.
- Update `tasks/in-progress.md` and `tasks/done.md` alongside each future task.
- Preserve the invariant that task creation requires explicit `assignedRole`, scheduler automation emits `SYSTEM`, and task lifecycle methods require explicit validated `actor`.
- Keep `SYSTEM` restricted to automation actor paths only, never as a task assignee.
- Preserve the invariant that all PMS and defect task events include `shipId` and that HTTP task inspection stays ship-scoped.
- Preserve the invariant that ships must exist before task creation and that persisted version mismatches log clearly until a migration path is implemented.
- Preserve the invariant that task history snapshots remain full-state and that engine command dispatch enforces event/command ship-context alignment.
- Preserve the invariant that daily-log idempotency is keyed by `shipId` plus business date and that HTTP errors always use the standard response envelope.
- Preserve the invariant that notifications remain store-owned and are only surfaced through the HTTP adapter.
- Preserve the invariant that notification dedupe remains ship-scoped and survives persistence reloads.
- Preserve the invariant that notification dedupe keys may be caller-provided or store-derived without changing duplicate-skip behavior.
- Preserve the invariant that notification identity uses explicit `type`, not message parsing.
