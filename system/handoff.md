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

## Architecture Handoff For Next Session

### What Was Completed In This Session

- fully reviewed the current repo structure and main backend/frontend entry points
- confirmed the current backend shape is a rule-driven modular monolith centered on `src/core/engine.ts`, `src/core/store.ts`, and `src/http/server.ts`
- captured the target backend architecture in `system/target-architecture.md`
- translated that target architecture into a repo-mapped execution plan in `system/implementation-plan.md`

### Architecture Decisions Now Treated As Agreed

- optimize first for backend domain correctness
- keep the system as a split-ready modular monolith for now
- treat `Ship` as the primary operational boundary
- treat `FSG` as both oversight and downward tasking authority into ship scope
- treat `LOGISTICS_COMMAND` as originating actions and records to `FSG`, not directly to ships
- keep records and executable tasks as separate but linked domain objects
- make lineage mandatory from directive to record to task to outcome
- treat record retrieval and audit trail as top-tier capabilities equal to maintenance execution
- use one primary `systemGroup` per important record and task
- use a broad extensible record registry, not a narrow approval-record-only model
- treat attachments and scanned supporting documents as first-class
- model the current system as paper-authoritative for now, with room for later digital-authoritative migration
- leave `CO` out of the target architecture even though the current repo still contains `COMMANDING_OFFICER`

### Key Repo Findings To Carry Forward

- `src/core/types.ts` is the first shared-kernel bottleneck and will need the earliest refactor
- `src/core/store.ts` currently contains too many contexts in one class and is the main modularity bottleneck
- `src/actions/create-approval-record.action.ts` hardcodes approval chains that still include `COMMANDING_OFFICER`
- `src/core/rbac.ts` still encodes old operating-chain assumptions
- `src/http/server.ts` is already large and should eventually be split by context
- current record modeling is still mostly `approval record` oriented rather than `record registry` oriented

### Start Here Next Session

Continue with `Iteration D Phase 2` from `system/implementation-plan.md`: introduce the `records/` module extraction from the store.

`Iteration C` is complete: Explicit ship-to-FSG jurisdiction is modeled and enforced in record visibility and awareness retrieval.

`Iteration D Phase 1` is complete: Type system has been split into context-specific modules (shared, records, maintenance, defects) with core/types.ts now serving as a re-export hub for backward compatibility. This provides the foundation for breaking up the InMemoryStore and introducing domain-specific repositories.

### First Files To Touch

- `src/actions/create-approval-record.action.ts`
- `src/core/rbac.ts`
- `src/core/store.ts`
- `src/http/server.ts`
- approval-read/reporting paths that still assume the old chain shape

### Specific First-Iteration Goals

- remove deeper architectural reliance on `COMMANDING_OFFICER`
- reshape approval routing toward `Ship Ops -> FSG -> LOGISTICS_COMMAND`
- start separating approval-record assumptions from the broader record-registry direction
- preserve the new `systemGroup`, `referenceNumber`, authority, and lineage invariants while refactoring

### Important Constraint For The Next Session

Do not jump straight to service extraction or folder-level reorganization first.

The next session should stabilize shared domain vocabulary and invariants before larger structural refactors.

### What Was Implemented In Iteration A

- `src/core/types.ts` now carries shared domain vocabulary for `SystemGroupId`, record authority metadata, and lineage source types
- tasks now require one primary `systemGroup` and carry lineage backbone fields
- defects now carry one primary `systemGroup`
- approval/fleet records now carry:
  - globally unique human-readable `referenceNumber`
  - `systemGroup`
  - `authorityMode`
  - `sourceKind`
  - `digitizationStage`
  - lineage fields
- `src/actions/create-approval-record.action.ts` now generates default record metadata and reference numbers
- `src/core/store.ts` persists, migrates, validates, and snapshots the new fields
- `src/http/server.ts` validates and accepts the new payload fields
- `src/core/rbac.ts` now allows `FSG` and `LOGISTICS_COMMAND` to originate approval-record creation

### Validation Status

- repo smoke check passed via `node C:\Users\HP\.codex\skills\fleet-engine-smoke-check\scripts\run_smoke_check.js`

### Important Constraint For The Next Session

- `COMMANDING_OFFICER` is still present in current approval-chain code for compatibility
- treat that as transitional debt to unwind next, not as a pattern to extend
