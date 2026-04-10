# Fleet ERP Architecture Implementation Plan

This document maps the target architecture into concrete implementation work against the current repo.

Use it as the execution guide for upcoming iterations.

Primary reference:

- `system/target-architecture.md`

## Current Repo Reality

The current backend already has strong domain intent, but several concerns are still collapsed together.

Main hotspots:

- `src/core/types.ts`
  - one large shared vocabulary for every concept
- `src/core/store.ts`
  - one large stateful persistence and domain behavior class
- `src/core/engine.ts`
  - central orchestrator for multiple contexts
- `src/http/server.ts`
  - one growing route surface
- `src/actions/create-approval-record.action.ts`
  - hardcodes approval chains around current role assumptions
- `src/core/rbac.ts`
  - current authorization assumptions still encode the old operating chain

## Architectural Gap Summary

The biggest gaps between current code and target architecture are:

1. `CO` is still embedded in the role model, approval chains, and escalation assumptions.
2. Records are currently modeled mainly as approval records, not as a broad record registry.
3. Tasks and records are linked only loosely; lineage is not a first-class invariant.
4. There is no explicit directive model for `LOGISTICS_COMMAND -> FSG -> ship` flows.
5. `systemGroup` does not yet exist as the cross-cutting classification backbone.
6. Jurisdiction and command scope are implicit rather than explicit.
7. Retrieval and audit are partly present, but they are still tied to approval-awareness flows more than a general records registry.

## Execution Strategy

Implement the architecture in three phases.

The rule is:

- stabilize shared vocabulary first
- then split domain responsibilities
- then expand record families and retrieval depth

Do not attempt service extraction before the modular monolith boundaries are stable.

## Phase 1: Backbone Refactor

Goal:

- establish the minimal shared concepts required for the future system

### 1.1 Introduce `systemGroup`

Outcome:

- records and tasks gain one primary system-group classification

Files to touch first:

- `src/core/types.ts`
- `src/core/store.ts`
- `src/http/server.ts`
- record and task creation actions

Tasks:

- add a temporary generic `SystemGroupId` type
- add `systemGroup` to `FleetRecord`
- add `systemGroup` to `Task`
- add optional support to `Defect` if needed for consistent routing
- update validation logic so important records cannot be created without a primary system group

Recommended temporary generic groups:

- `PROPULSION`
- `AUXILIARIES`
- `ELECTRICAL_POWER`
- `WEAPONS`
- `SENSORS_AND_NAVIGATION`
- `COMMUNICATIONS`
- `HULL_AND_SEAKEEPING`
- `DAMAGE_CONTROL_AND_SAFETY`
- `SUPPLY_AND_SUPPORT`
- `GENERAL_ENGINEERING`

### 1.2 Remove Target Dependence On `CO`

Outcome:

- target flows align to `MEO/WEO -> FSG -> LOGISTICS_COMMAND`

Files to touch first:

- `src/core/types.ts`
- `src/core/rbac.ts`
- `src/actions/create-approval-record.action.ts`
- `src/http/server.ts`
- approval-related tests and scenarios

Tasks:

- decide whether `COMMANDING_OFFICER` stays temporarily for compatibility or is deprecated immediately
- remove `CO` from new approval chain generation logic
- remove `CO` from new retrieval and awareness assumptions
- mark existing `CO` report or route code as transitional or obsolete

Recommended approach:

- do not hard-delete the enum value on the first pass if it would destabilize the repo
- instead introduce a target-only chain builder that no longer inserts `CO`
- migrate scenarios and route behavior to the new chain
- remove the old role completely after coverage is stable

### 1.3 Add Record Reference Numbers

Outcome:

- every formal record gets a human-readable globally unique reference number

Files to touch first:

- `src/core/types.ts`
- `src/core/store.ts`
- `src/actions/create-approval-record.action.ts`
- HTTP create-record handlers

Tasks:

- add `referenceNumber` to the record model
- add record-number generation service or helper
- ensure uniqueness across ships and record families
- expose reference numbers in retrieval responses

### 1.4 Add Transitional Record Authority Metadata

Outcome:

- records can model paper-backed authority now and digital authority later

Files to touch first:

- `src/core/types.ts`
- `src/core/store.ts`
- record creation actions
- HTTP contract for record creation

Tasks:

- add `authorityMode`
- add `sourceKind`
- add `digitizationStage`
- add optional source-document metadata

Recommended initial defaults:

- `authorityMode = PAPER_AUTHORITATIVE`
- `sourceKind = DIGITAL_ENTRY`
- `digitizationStage = INDEXED`

### 1.5 Add Minimal Lineage Backbone

Outcome:

- tasks and records can point back to their source

Files to touch first:

- `src/core/types.ts`
- `src/core/store.ts`
- task creation actions
- record creation actions

Tasks:

- add `originRecordId`
- add `originDirectiveId`
- add `derivedFromType`
- add `derivedFromId`
- preserve `parentTaskId` as part of the lineage model

### 1.6 Introduce Explicit Jurisdiction Metadata

Outcome:

- `FSG` visibility becomes explicit and testable

Files to touch first:

- `src/core/types.ts`
- `src/core/store.ts`
- `src/http/server.ts`
- awareness and record retrieval functions

Tasks:

- add a structure that maps ships to FSG jurisdiction
- stop relying on implicit role visibility only
- require jurisdiction checks in record retrieval and awareness summaries

## Phase 2: Context Separation Inside The Monolith

Goal:

- separate domain responsibilities without introducing network boundaries

### 2.1 Split `src/core/types.ts`

Outcome:

- shared kernel plus per-context models

Recommended target folders:

- `src/shared/`
- `src/fleet-structure/`
- `src/assets/`
- `src/records/`
- `src/maintenance/`
- `src/defects/`
- `src/directives/`
- `src/audit/`
- `src/awareness/`

Suggested first extraction:

- move shared primitive enums and ids into `src/shared/types.ts`
- move record models into `src/records/types.ts`
- move task models into `src/maintenance/types.ts`
- move defect models into `src/defects/types.ts`

### 2.2 Break Up `InMemoryStore`

Outcome:

- repository-like state modules by context

Current issue:

- `src/core/store.ts` currently owns ships, equipment, logs, tasks, defects, records, notifications, approval history, awareness summaries, and persistence mechanics.

Suggested extraction order:

1. `ShipRepository` / fleet structure state
2. `RecordRepository`
3. `TaskRepository`
4. `DefectRepository`
5. `NotificationRepository`
6. `AuditRepository` or timeline state

Persistence can remain shared initially, but domain operations should stop living in one giant class.

### 2.3 Introduce Record Registry Module

Outcome:

- formal records become a first-class context rather than just approval workflow data

New module ideas:

- `src/records/reference-number.ts`
- `src/records/repository.ts`
- `src/records/service.ts`
- `src/records/visibility.ts`
- `src/records/lineage.ts`

Responsibilities:

- record creation
- record indexing
- visibility computation
- record-type validation
- attachment metadata management

### 2.4 Introduce Directive Module

Outcome:

- higher-echelon tasking stops being implied through records alone

New module ideas:

- `src/directives/types.ts`
- `src/directives/repository.ts`
- `src/directives/service.ts`
- `src/directives/events.ts`

Initial behavior:

- create directive
- target FSG or ship through allowed chain
- derive record(s) and task(s)
- preserve source lineage

### 2.5 Refactor Approval Into A Record Workflow Capability

Outcome:

- approvals become one record-workflow mechanism, not the whole record model

Current issue:

- approval logic currently defines the record lifecycle too strongly

Tasks:

- move approval flow under `records/workflows/`
- make record lifecycle broader than approval only
- support records that are indexed or archived without multi-step approval

### 2.6 Refactor HTTP By Context

Outcome:

- routes become context modules instead of one giant handler

Current issue:

- `src/http/server.ts` owns health, reports, tasks, notifications, records, awareness, transitions, and events in one file

Suggested route split:

- `src/http/routes/health.ts`
- `src/http/routes/records.ts`
- `src/http/routes/tasks.ts`
- `src/http/routes/defects.ts`
- `src/http/routes/directives.ts`
- `src/http/routes/awareness.ts`
- `src/http/routes/reports.ts`

Keep a single server entry point, but dispatch into context handlers.

## Phase 3: Domain Expansion

Goal:

- grow from the current narrow record set into the real fleet records platform

### 3.1 Expand Record Families

Add first:

- `MAINTENANCE_REQUEST`
- `DELAYED_REPAIR_RECORD`
- `TECHNICAL_REPORT`
- `WEEKLY_REPORT`
- `SPARE_PARTS_REQUEST`

Add later:

- `STEADY_STEAMING_REPORT`
- `ANNUAL_MAINTENANCE_PLAN`
- `SUPPLY_RETURN`
- `SUPERSESSION_CERTIFICATE`

### 3.2 Add Attachment And Document Custody Workflows

Outcome:

- records can reliably reference scanned paper and supporting evidence

Tasks:

- attachment metadata model
- authoritative-copy indicator
- source document locator
- attachment validation rules by record family

### 3.3 Build General Retrieval Layer

Outcome:

- retrieval becomes broader than approval-awareness listings

Tasks:

- create structured record queries by ship, type, date, status, system group, origin, and reference number
- add linked-id lookup for task/defect/directive lineage
- add timeline and audit responses

### 3.4 Add Ship-Specific Responsibility Profiles

Outcome:

- the temporary generic system-group model becomes ship-aware

Tasks:

- add per-ship responsibility mapping
- route MEO/WEO permissions through ship configuration
- stop assuming static role ownership globally

## Concrete File Mapping

These are the highest-value early changes by file.

### `src/core/types.ts`

Change first:

- add `SystemGroupId`
- add authority metadata enums
- add record reference number
- add lineage fields
- mark `COMMANDING_OFFICER` as transitional if not removed immediately

Later:

- split into per-context types

### `src/actions/create-approval-record.action.ts`

Change first:

- stop hardcoding chains with `CO`
- require or derive `referenceNumber`
- require `systemGroup`
- store authority metadata
- prepare for broader record families

### `src/core/rbac.ts`

Change first:

- remove target assumptions about `CO`
- move from role-only logic toward role + ship + jurisdiction + system-group checks

### `src/core/store.ts`

Change first:

- add record metadata and lineage support
- add jurisdiction support
- stop treating approval-only records as the whole records domain

Later:

- split into repositories by context

### `src/http/server.ts`

Change first:

- add support for new record metadata fields
- align retrieval endpoints with jurisdiction checks
- prepare route extraction by context

### `tests/scenarios/*`

Change first:

- remove `CO`-dependent happy-path assumptions from target flows
- add tests for:
  - FSG jurisdiction scoping
  - record reference numbers
  - system-group enforcement
  - lineage preservation
  - paper-authoritative record defaults

## Recommended Order Of First Real Code Iterations

### Iteration A

- add `SystemGroupId`
- add `referenceNumber`
- add authority metadata
- add lineage metadata

### Iteration B

- refactor record creation and approval chain generation to remove `CO`
- update RBAC and scenarios accordingly

### Iteration C

- add explicit ship-to-FSG jurisdiction support
- enforce it in retrieval and awareness

### Iteration D

- introduce `records/` module extraction from the store

### Iteration E

- introduce `directives/` module and directive-derived work creation

## Acceptance Criteria For Phase 1

Phase 1 is complete when:

- all formal records have `referenceNumber`
- all formal records have `systemGroup`
- all formal records have authority metadata
- new work can preserve lineage fields
- new target approval/tasking chains no longer require `CO`
- jurisdiction data exists and is enforced in retrieval paths
- tests cover the new invariants

## Guardrails

- do not rewrite the whole monolith in one pass
- do not remove working domain rules without replacement
- do not turn retrieval into free-text search before structured retrieval exists
- do not introduce service boundaries before in-process context boundaries are stable
- do not let UI needs dictate backend terminology

## Next Action

The next code iteration should be:

`Iteration A: add systemGroup, record reference numbers, authority metadata, and lineage backbone to the current record and task model.`

That gives every later change a stable domain spine to build on.
