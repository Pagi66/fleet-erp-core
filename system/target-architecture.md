# Fleet ERP Target Architecture

This document defines the target backend architecture for Fleet ERP Core.

It is based on the current repo, the domain notes in `context/` and `flows/`, and the intended operating model discussed for the Nigerian Navy fleet maintenance use case.

This architecture optimizes first for domain correctness, auditability, and long-term extensibility. It is designed as a split-ready modular monolith now, with future service separation seams made explicit.

## Mission

Fleet ERP Core is not only a maintenance workflow engine.

It is a fleet maintenance and records accountability platform with two equal top-tier capabilities:

- Maintenance Operations
- Records, Retrieval, and Audit

The platform must support:

- ship-scoped operational ownership
- FSG oversight and downward tasking
- Logistics Command directives to FSG
- paper-to-digital transition with scanned documents remaining authoritative for now
- strict lineage from directive to record to task to outcome
- jurisdiction-aware retrieval and visibility

## Core Architectural Position

The target shape is a modular monolith with explicit bounded contexts, explicit contracts, and explicit events.

For now:

- one codebase
- one deployable backend
- one persistence boundary

But the code must be structured so that future service extraction can happen by context rather than by technical layer alone.

## Domain Principles

### P-001 Ship First Ownership

The `Ship` is the primary operational boundary.

Almost all operational records, tasks, defects, logs, and history belong to a ship first.

Higher authorities act on ship-scoped data through visibility, directives, approvals, escalation, support, and retrieval.

### P-002 Directional Command Flow

The target command flow is:

- Ship Operations (`MEO`, `WEO`)
- `FSG`
- `LOGISTICS_COMMAND`

`FSG` may originate work into ship scope.

`LOGISTICS_COMMAND` originates directives and records to `FSG`, not directly to ships.

### P-003 Records And Tasks Are Different Things

A formal record is not the same thing as an executable task.

A record captures instruction, request, evidence, accountability, and history.

A task captures operational execution.

One record may produce zero, one, or many tasks.

### P-004 Lineage Is Mandatory

No important downstream task or derived record may be orphaned from its origin.

The system must preserve lineage across:

- directive
- derived record
- derived task
- status transitions
- outcome and closure

### P-005 Retrieval Is A Core Capability

Retrieval, audit trail, and record history are first-class core capabilities, not reporting extras.

### P-006 Transitional Authority Model

For now, scanned paper remains the formal authority for many records.

The system must therefore support paper-authoritative and digital-authoritative records in the same architecture.

### P-007 Configuration Over Hardcoding

Ship-specific responsibility boundaries must be configurable.

Temporary generic classification is allowed, but the design must support ship-specific mappings later without redesigning the core model.

## Actors

The target first-class actors are:

- `MARINE_ENGINEERING_OFFICER`
- `WEAPON_ELECTRICAL_OFFICER`
- `FLEET_SUPPORT_GROUP`
- `LOGISTICS_COMMAND`
- `SYSTEM`

Notes:

- `COMMANDING_OFFICER` exists in the current repo but is not part of the target operational architecture unless explicitly reintroduced later.
- `MEO` and `WEO` share one ship workspace, but each can only create and manage records in their own technical responsibility areas.

## Access And Visibility Model

### Ship Scope

Ship users can only see the history and current state of their own ship.

### FSG Scope

`FLEET_SUPPORT_GROUP` can see only ships within its assigned jurisdiction.

`FSG` can:

- view ship history in its jurisdiction
- create directives and records into ship scope
- assign maintenance actions and records down to ships
- receive escalations and requests from ships

### Logistics Scope

`LOGISTICS_COMMAND` can see across its wider command scope.

`LOGISTICS_COMMAND` can:

- monitor `FSG` and ship-level outcomes
- create directives and records to `FSG`
- review and control major maintenance planning and higher-echelon actions

## Target Bounded Contexts

The modular monolith should be organized around these contexts.

### 1. Fleet Structure Context

Purpose:

- define the fleet hierarchy and visibility boundaries
- own ships, ship classes, jurisdictions, and authority assignments

Key entities:

- `Ship`
- `Jurisdiction`
- `CommandAssignment`
- `ShipResponsibilityProfile`

Responsibilities:

- ship registry
- ship metadata
- FSG-to-ship jurisdiction mapping
- role-to-system-group responsibility mapping per ship

Future split suitability:

- high

### 2. Asset Catalog Context

Purpose:

- define ship equipment, systems, and classification backbone

Key entities:

- `SystemGroup`
- `Equipment`
- `AssetReference`
- `EquipmentAssignment`

Responsibilities:

- temporary generic system groups now
- ship-specific system group mappings later
- equipment identifiers and asset indexing
- responsibility resolution support for `MEO` and `WEO`

Future split suitability:

- medium to high

### 3. Records Registry Context

Purpose:

- own all formal records, document metadata, references, and retrieval indexes

Key entities:

- `Record`
- `RecordReference`
- `Attachment`
- `DocumentCustody`
- `RecordLineage`

Core invariant:

- every formal record has a globally unique human-readable reference number

Responsibilities:

- record registry lifecycle
- type-safe record families
- attachment metadata
- authority mode and digitization stage
- search and retrieval indexes
- lineage links to directives, tasks, defects, and other records

Initial record families:

- `MAINTENANCE_LOG`
- `DEFECT`
- `WORK_REQUEST`

Expected next record families:

- `MAINTENANCE_REQUEST`
- `DELAYED_REPAIR_RECORD`
- `TECHNICAL_REPORT`
- `WEEKLY_REPORT`
- `STEADY_STEAMING_REPORT`
- `ANNUAL_MAINTENANCE_PLAN`
- `SPARE_PARTS_REQUEST`
- `SUPPLY_RETURN`
- `SUPERSESSION_CERTIFICATE`

Future split suitability:

- very high

### 4. Maintenance Operations Context

Purpose:

- own executable work, schedules, completion, replanning, and execution state

Key entities:

- `MaintenanceTask`
- `MaintenancePlan`
- `TaskExecution`
- `TaskAssignment`

Responsibilities:

- PMS generation
- task completion
- overdue handling
- replanning
- task derivation from directives or records
- execution outcome capture

Future split suitability:

- very high

### 5. Defects Context

Purpose:

- own defect recognition, lifecycle, ETTR evaluation, escalation, and derived repair flow

Key entities:

- `Defect`
- `DefectAssessment`
- `DefectEscalation`

Responsibilities:

- defect logging
- defect classification
- ETTR and severity tracking
- delayed repair tracking
- promotion into larger maintenance workflows when thresholds are crossed

Future split suitability:

- high

### 6. Directives And Tasking Context

Purpose:

- model higher-echelon instructions and downward command flow

Key entities:

- `Directive`
- `DirectiveTarget`
- `DirectiveOutcome`

Responsibilities:

- Logistics to FSG tasking
- FSG to ship tasking
- derivation of records and tasks from directives
- command provenance

Future split suitability:

- high

### 7. Audit And Retrieval Context

Purpose:

- provide cross-context history, chain-of-custody, and search views

Key entities:

- `AuditEntry`
- `TimelineEntry`
- `SearchIndexDocument`
- `VisibilityScope`

Responsibilities:

- append-only audit history
- unified retrieval views
- history timelines per ship, record, defect, and task
- lineage graph traversal

Future split suitability:

- high

### 8. Notifications And Awareness Context

Purpose:

- surface operational attention, stale work, and cross-role pending actions

Key entities:

- `Notification`
- `AwarenessRecord`
- `AttentionSignal`

Responsibilities:

- role-aware notifications
- command dashboards
- stale and pending alerts
- visibility-shaped awareness summaries

Future split suitability:

- medium

## Aggregate Roots

The recommended aggregate roots are:

- `Ship`
- `Record`
- `Directive`
- `MaintenanceTask`
- `Defect`

Guidance:

- `Ship` is the ownership and access boundary.
- `Record` is the formal accountability boundary.
- `Directive` is the command-origin boundary.
- `MaintenanceTask` is the execution boundary.
- `Defect` is the technical fault boundary.

Do not collapse all of these into one giant ship aggregate in code. Ship is the primary scope, not the only aggregate root.

## Shared Domain Backbone

The following concepts should become shared language across contexts.

### System Group

Every important record and task must have one primary `systemGroup`.

This is the main operational classification for routing, permissions, retrieval, and reporting.

Current recommendation:

- use a temporary generic system-group catalog now
- make it replaceable by ship-specific catalogs later

### Reference Number

Every formal record must have a human-readable, globally unique reference number.

Recommended structure:

- prefix for organization or fleet
- record family code
- ship or jurisdiction segment
- time segment
- sequence segment

Example pattern only:

- `NN-FLT-WR-NNS-ALPHA-202604-0007`

### Authority Metadata

Each record should include:

- `authorityMode`: `PAPER_AUTHORITATIVE | DIGITAL_AUTHORITATIVE`
- `sourceKind`: `SCANNED_PAPER | DIGITAL_ENTRY | IMPORTED_DOCUMENT`
- `digitizationStage`: `INDEXED | PARTIALLY_STRUCTURED | FULLY_STRUCTURED`

### Lineage Metadata

Each record or task should support:

- `originDirectiveId`
- `originRecordId`
- `parentTaskId`
- `derivedFromType`
- `derivedFromId`

This is the minimum backbone required for cross-context traceability.

## Record Registry Design

### Base Record Shape

All formal records should share a common base model.

Suggested base fields:

- `id`
- `referenceNumber`
- `recordType`
- `shipId`
- `systemGroup`
- `title`
- `description`
- `originRole`
- `originAuthority`
- `createdAt`
- `businessDate`
- `status`
- `authorityMode`
- `sourceKind`
- `digitizationStage`
- `visibilityPolicy`
- `lineage`
- `linkedEntities`
- `attachmentIds`

### Type-Specific Payloads

Specific record families should attach typed payloads rather than inventing unrelated storage models.

Examples:

- `MaintenanceRequestPayload`
- `TechnicalReportPayload`
- `DelayedRepairPayload`
- `SpareRequestPayload`

### Attachments

Attachments are first-class.

Suggested attachment metadata:

- `attachmentId`
- `recordId`
- `fileName`
- `mimeType`
- `uploadedAt`
- `uploadedBy`
- `documentRole`
- `checksum`
- `storageLocator`
- `isAuthoritativeCopy`

The initial implementation may use simple file metadata and local storage, but the domain model must be stable enough for future object storage and retention policies.

## Tasking And Directive Model

To support downward command flow correctly, the target architecture should introduce explicit directives.

### Directive Semantics

A directive is a command-origin object.

Examples:

- Logistics issues a maintenance directive to FSG
- FSG issues ship-specific actioning based on that directive

Directive behavior:

- may create records
- may create tasks
- may request acknowledgement
- may require closure evidence

### Derived Work Model

A directive can derive:

- one or more formal records
- one or more executable maintenance tasks
- one or more escalated defect actions

Each derived object must keep the source link.

## Retrieval Model

Retrieval should not be implemented as a generic text search first.

It should start as a structured operational and audit retrieval model.

### Primary Retrieval Keys

- `ship`
- `date range`
- `record type`
- `system group`
- `status`
- `originating role or authority`
- `linked task or defect id`
- `reference number`

### Secondary Retrieval Keys

- `equipment id`
- `keyword`
- `attachment presence`
- `authority mode`
- `digitization stage`
- `escalation stage`

### Retrieval Views

The architecture should support three major retrieval modes:

- operational lookup
- records lookup
- audit lookup

Operational lookup focuses on work in progress and readiness.

Records lookup focuses on document finding and evidence retrieval.

Audit lookup focuses on provenance, approvals, transitions, and lineage.

## Events And Integration Style

The backend should remain event-driven internally, but event names and ownership should move closer to context boundaries.

### Domain Event Categories

Recommended categories:

- `ShipRecordLogged`
- `DirectiveIssued`
- `DirectiveAccepted`
- `RecordRegistered`
- `RecordSubmitted`
- `RecordLinkedToTask`
- `TaskGenerated`
- `TaskCompleted`
- `TaskOverdue`
- `DefectLogged`
- `DefectEscalated`
- `AttachmentAdded`
- `AuditEntryRecorded`

The current event vocabulary is still useful, but it is narrower than the target system and currently mixes engine concerns with domain semantics.

## Current Repo To Target Mapping

### Current Core

Today the backend roughly consists of:

- events
- rules
- actions
- one large in-memory persisted store
- one HTTP server
- read-model and reporting helpers

### Recommended Mapping

Current modules should evolve like this:

- `src/core/types.ts`
  - split into per-context types and a smaller shared-kernel vocabulary
- `src/core/store.ts`
  - break apart into context repositories or state modules
- `src/core/engine.ts`
  - remain the orchestration engine for now, but delegate into context-specific services
- `src/rules/*`
  - keep for compliance and transition rules, but align them to bounded contexts
- `src/actions/*`
  - refactor toward application services or command handlers per context
- `src/http/server.ts`
  - move toward context-based API modules instead of one growing route file

## Service Split Seams

When the monolith is ready to split, the strongest seams are:

1. `records-registry`
2. `maintenance-operations`
3. `defects`
4. `fleet-structure-and-assets`
5. `audit-and-retrieval`

The weakest early seam is notifications, which can remain integrated longer.

## Sequencing Recommendation

The architecture should be implemented in phases.

### Phase 1

- remove target dependence on `CO`
- introduce explicit ship jurisdiction model
- introduce `systemGroup` backbone
- define record registry base model
- add global human-readable reference number generation
- add lineage backbone fields

### Phase 2

- separate records from executable tasks more cleanly
- introduce directive model
- refactor store toward bounded repositories
- refactor HTTP routes by context

### Phase 3

- add richer record families from FMR-derived requirements
- add attachment and document custody workflows
- add retrieval indexes and audit timelines
- replace temporary system groups with ship-specific mappings

## Non-Goals

The target architecture should avoid:

- designing around UI pages first
- keeping all business concepts inside one giant store model forever
- treating records as free-form notes without typed structure
- allowing important work without lineage
- hardcoding permanent global MEO and WEO technical boundaries
- relying on implicit visibility instead of explicit jurisdiction rules

## Immediate Design Decisions

The following should now be treated as decided unless changed explicitly:

- backend domain correctness has priority
- modular monolith now, future split-ready
- `Ship` is the primary operational boundary
- `FSG` can monitor and assign work to ships
- `LOGISTICS_COMMAND` originates to `FSG`
- records and tasks are separate but linked
- lineage is mandatory
- ship-originated important work must be formally logged
- ship-originated records flow upward automatically
- `MEO` and `WEO` share one workspace but have role-bounded authority
- `CO` is out of the target architecture
- `systemGroup` is the primary classification backbone
- one primary system group per record
- broad extensible record registry
- attachments are first-class
- paper-authoritative transition model now
- retrieval and audit are equal to maintenance execution
- reference numbers are human-readable and globally unique

## Architecture Rule

All future backend iterations should be evaluated against this question:

Does this change strengthen ship-scoped ownership, lineage, retrieval, and command-aware accountability, or does it push the system back toward a generic task app?

If it weakens those properties, it is the wrong direction.
