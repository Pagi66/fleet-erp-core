# Operational Awareness Layer

## Goal

Provide role-specific, real-time visibility over approval records without changing approval logic, ownership, transitions, or workflow rules.

This layer is a read and aggregation projection built on top of:

- `FleetRecord`
- `ApprovalFlow`
- `ApprovalHistoryEntry`
- `Ship`
- existing store read methods such as `getApprovalRecordsByShip`, `getApprovalRecordsVisibleToRole`, and `getStaleApprovalRecordsByShip`

It should sit beside the current approval engine, not inside it.

## Design Principles

- Read-only: consume store state and history, never mutate workflow state.
- Role-aware: every response is filtered through `visibleTo` and current workflow ownership.
- Ship-aware: ship is a first-class grouping dimension for dashboards and summaries.
- Explainable: every attention signal should be derivable from `status`, `currentOwner`, `approvalHistory`, and `lastActionAt`.
- Cheap to compute: support direct scans now, with clear index shapes if persisted query storage is added later.

## Scope

Primary scope is approval-record awareness for:

- `MARINE_ENGINEERING_OFFICER`
- `COMMANDING_OFFICER`
- `FLEET_SUPPORT_GROUP`
- `LOGISTICS_COMMAND`

`WEAPON_ELECTRICAL_OFFICER` can use the same projection later with no model change.

## Read Model

Define a dashboard projection for each visible record.

```ts
type AwarenessBucket =
  | "OWNED"
  | "PENDING_MY_ACTION"
  | "RECENTLY_REJECTED"
  | "VISIBLE_NOT_OWNED";

type AttentionSignal =
  | "STALE"
  | "BLOCKED_BY_REJECTION"
  | "PENDING_TOO_LONG";

interface ApprovalAwarenessRecord {
  recordId: string;
  shipId: string;
  shipName: string;
  shipClass: string;
  kind: FleetRecordKind;
  title: string;
  businessDate: string;
  originRole: AssignedRoleId;
  status: ApprovalStatus;
  currentOwner: AssignedRoleId;
  approvalLevel: number;
  currentStepIndex: number;
  chain: AssignedRoleId[];
  visibleTo: AssignedRoleId[];
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  lastActionAt: string | null;
  lastActionBy: RoleId | null;
  lastActionReason: string | null;
  lastActionNote: string | null;
  lastHistoryAction: ApprovalHistoryType | null;
  lastHistoryAt: string | null;
  previousOwner: AssignedRoleId | null;
  bucket: AwarenessBucket;
  attentionSignals: AttentionSignal[];
  ageHoursSinceLastAction: number | null;
  ageHoursSinceSubmission: number | null;
}

interface RoleDashboardSummary {
  role: AssignedRoleId;
  shipId?: string;
  generatedAt: string;
  totals: {
    visible: number;
    owned: number;
    needingMyAction: number;
    recentlyRejected: number;
    visibleNotOwned: number;
    stale: number;
    blockedByRejection: number;
    pendingTooLong: number;
  };
  countsByStatus: Record<ApprovalStatus, number>;
  countsByRole: Record<AssignedRoleId, number>;
  countsByShip: Record<string, number>;
  records: ApprovalAwarenessRecord[];
}
```

## Bucket Semantics

Each visible record belongs to one primary bucket for a role:

- `OWNED`
  Current owner is the role, regardless of status.
- `PENDING_MY_ACTION`
  Current owner is the role and status is `SUBMITTED`.
  This is the most important operational queue because action can be taken now.
- `RECENTLY_REJECTED`
  Record is visible to the role, current status is `REJECTED`, and `rejectedAt` falls within a configurable recent window such as 72 hours.
- `VISIBLE_NOT_OWNED`
  Role can see the record through `visibleTo`, but `currentOwner !== role`.

Recommended precedence:

1. `PENDING_MY_ACTION`
2. `RECENTLY_REJECTED`
3. `OWNED`
4. `VISIBLE_NOT_OWNED`

This prevents a submitted record owned by a role from being buried in the broader owned bucket.

## Attention Signals

Signals are additive, not mutually exclusive.

- `STALE`
  Trigger when record is non-terminal and `now - lastActionAt >= staleThresholdHours`.
  Reuse the same logic shape already used by `getStaleApprovalRecordsByShip`.
- `BLOCKED_BY_REJECTION`
  Trigger when status is `REJECTED`.
  This reflects a record sent backward and awaiting correction or resubmission.
- `PENDING_TOO_LONG`
  Trigger when status is `SUBMITTED` and `now - submittedAt >= pendingThresholdHours`.

Recommended defaults:

- `recentlyRejectedWindowHours = 72`
- `staleThresholdHours = 24`
- `pendingThresholdHours = 48`

Keep these as query parameters or config, not hardcoded workflow rules.

## Role-Based Views

### MEO

- Records currently owned:
  Draft records originated by MEO and rejected records returned to MEO.
- Pending approval:
  Submitted records currently waiting on MEO only when MEO is the active approver in a visible chain.
- Recently rejected:
  Rejections returned from CO, FSG, or Log Comd.
- Visible but not owned:
  MEO-originated records currently with CO, FSG, or Log Comd.

This matches repo context where MEO is responsible for engineering logs, machinery readiness, and record quality before escalation.

### CO

- Records currently owned:
  Submitted records escalated to CO for command approval.
- Pending approval:
  Same as currently owned `SUBMITTED` records, because CO action is required.
- Recently rejected:
  Records CO rejected or records visible in the chain that were rejected upstream.
- Visible but not owned:
  Records initiated by MEO and advanced onward to FSG or Log Comd.

This aligns with CO as overall authority and first escalation point for unresolved issues.

### FSG

- Records currently owned:
  Technical reports and maintenance requests currently at FSG review.
- Pending approval:
  Submitted records with `currentOwner = FLEET_SUPPORT_GROUP`.
- Recently rejected:
  Records bounced back from Log Comd or visible records rejected at FSG stage.
- Visible but not owned:
  Records still with CO or already advanced to Log Comd.

This aligns with FSG handling intermediate maintenance and technical review.

### LOG_COMD

- Records currently owned:
  Major maintenance or high-level work requests awaiting final review.
- Pending approval:
  Submitted records with `currentOwner = LOGISTICS_COMMAND`.
- Recently rejected:
  Records rejected at final command review and sent backward.
- Visible but not owned:
  Records in lower stages but visible due to command oversight.

This aligns with Log Comd oversight for major maintenance and planning.

## Query Patterns

These queries should be implemented as projection helpers over existing store data.

### 1. Records I own

Definition:

```ts
records.filter((record) => record.approval.currentOwner === role)
```

Store pattern:

- Start from `getApprovalRecordsVisibleToRole(shipId, role)` when a role-scoped endpoint is used.
- Optionally start from `getApprovalRecordsByShip(shipId)` for admin or aggregate endpoints.

Suggested helper:

```ts
getApprovalRecordsOwnedByRole(shipId: string, role: AssignedRoleId): FleetRecord[]
```

### 2. Records needing my action

Definition:

```ts
records.filter(
  (record) =>
    record.approval.currentOwner === role &&
    record.approval.status === "SUBMITTED"
)
```

This is the highest-value operational query because it represents actionable approval workload.

Suggested helper:

```ts
getApprovalRecordsNeedingRoleAction(shipId: string, role: AssignedRoleId): FleetRecord[]
```

### 3. Records I can see

Definition:

```ts
records.filter((record) => record.visibleTo.includes(role))
```

Existing helper already present:

```ts
getApprovalRecordsVisibleToRole(shipId: string, role: AssignedRoleId)
```

### 4. Stale records

Definition:

```ts
records.filter((record) => {
  if (record.approval.status === "APPROVED" || record.approval.status === "REJECTED") {
    return false;
  }

  return hoursBetween(now, record.approval.lastActionAt) >= staleThresholdHours;
})
```

Existing helper already present:

```ts
getStaleApprovalRecordsByShip(shipId: string, occurredAt: string, thresholdHours: number)
```

### 5. Recently rejected

Definition:

```ts
records.filter(
  (record) =>
    record.visibleTo.includes(role) &&
    record.approval.status === "REJECTED" &&
    hoursBetween(now, record.approval.rejectedAt) <= recentlyRejectedWindowHours
)
```

Suggested helper:

```ts
getRecentlyRejectedApprovalRecords(shipId: string, role: AssignedRoleId, now: string, windowHours: number): FleetRecord[]
```

### 6. Visible but not owned

Definition:

```ts
records.filter(
  (record) =>
    record.visibleTo.includes(role) &&
    record.approval.currentOwner !== role
)
```

Suggested helper:

```ts
getApprovalRecordsVisibleButNotOwned(shipId: string, role: AssignedRoleId): FleetRecord[]
```

## Projection Logic

Build the dashboard in three passes:

### Pass 1: collect candidate records

- By ship:
  `store.getApprovalRecordsVisibleToRole(shipId, role)`
- Cross-ship:
  scan all ships and concatenate visible records for the role

### Pass 2: enrich each record

For each `FleetRecord`:

- join ship metadata from `Ship`
- compute ages from `lastActionAt` and `submittedAt`
- inspect latest history entry from `approvalHistory`
- derive `previousOwner` from history only for rejected records
- assign primary bucket
- assign additive attention signals

### Pass 3: aggregate

Reduce enriched records into:

- `countsByStatus`
- `countsByRole`
- `countsByShip`
- top-level totals for actionable queues and alerts

## Aggregation Logic

### Counts per status

Count visible records by approval status:

```ts
{
  DRAFT: number,
  SUBMITTED: number,
  APPROVED: number,
  REJECTED: number
}
```

Use this for role dashboard summary and ship dashboard summary.

### Counts per role

Count by current owner:

```ts
{
  COMMANDING_OFFICER: number,
  MARINE_ENGINEERING_OFFICER: number,
  WEAPON_ELECTRICAL_OFFICER: number,
  FLEET_SUPPORT_GROUP: number,
  LOGISTICS_COMMAND: number
}
```

Interpretation:

- operational backlog currently sitting with each role
- useful for spotting bottlenecks without changing ownership

### Counts per ship

Count visible records grouped by `shipId`.

Optional expansion:

- `countsByShipStatus[shipId][status]`
- `countsByShipRole[shipId][currentOwner]`

These are useful for multi-ship command dashboards.

## API Shape

Suggested endpoints should remain read-only and parallel the current lightweight HTTP server style.

### Role dashboard

`GET /awareness/records/dashboard?role=MARINE_ENGINEERING_OFFICER&shipId=NNS-001&now=2026-03-24T10:00:00Z`

Returns:

- role summary totals
- counts by status
- counts by role
- counts by ship
- full enriched record list

Use `shipId` as optional:

- present: ship-scoped dashboard
- absent: cross-ship dashboard for the role

### Owned queue

`GET /awareness/records/owned?role=COMMANDING_OFFICER&shipId=NNS-001`

Returns records where `currentOwner === role`.

### Action queue

`GET /awareness/records/actionable?role=FLEET_SUPPORT_GROUP&shipId=NNS-001`

Returns records where `currentOwner === role` and `status === SUBMITTED`.

### Visible queue

`GET /awareness/records/visible?role=LOGISTICS_COMMAND&shipId=NNS-001`

Returns all records visible to the role.

### Rejection queue

`GET /awareness/records/rejected?role=MARINE_ENGINEERING_OFFICER&shipId=NNS-001&windowHours=72`

Returns recently rejected visible records.

### Stale queue

`GET /awareness/records/stale?role=COMMANDING_OFFICER&shipId=NNS-001&thresholdHours=24&now=2026-03-24T10:00:00Z`

Returns stale records visible to the role, ideally with computed `ageHoursSinceLastAction`.

### Aggregate summary

`GET /awareness/records/summary?role=LOGISTICS_COMMAND&shipId=NNS-001`

Returns only aggregates:

- totals
- counts by status
- counts by role
- counts by ship

This is useful when a UI first loads counts before pulling full record cards.

## HTTP Handler Notes

If implemented in the current `src/http/server.ts` style:

- validate `role` as `AssignedRoleId`
- validate optional `shipId`
- validate numeric thresholds and window values
- default `now` to server current time if omitted
- reuse existing store methods wherever possible

No endpoint in this layer should emit engine events or update the store.

## Suggested Store Read Helpers

These helpers keep the read model clean while preserving the non-intrusive boundary:

```ts
getApprovalRecordsOwnedByRole(shipId: string, role: AssignedRoleId): FleetRecord[]
getApprovalRecordsNeedingRoleAction(shipId: string, role: AssignedRoleId): FleetRecord[]
getApprovalRecordsVisibleButNotOwned(shipId: string, role: AssignedRoleId): FleetRecord[]
getRecentlyRejectedApprovalRecords(
  shipId: string,
  role: AssignedRoleId,
  now: string,
  windowHours: number,
): FleetRecord[]
getApprovalDashboardSummary(
  role: AssignedRoleId,
  options?: { shipId?: string; now?: string; staleThresholdHours?: number; pendingThresholdHours?: number; recentlyRejectedWindowHours?: number }
): RoleDashboardSummary
```

These can be implemented as pure scans over in-memory records and approval history.

## Efficiency Notes

For the current in-memory store, a linear scan per ship is acceptable.

If a persisted query store or database is added later, the awareness layer should index by:

- `(shipId, currentOwner)`
- `(shipId, status)`
- `(shipId, visibleTo role)`
- `(shipId, lastActionAt)`
- `(shipId, rejectedAt)`

For cross-ship command dashboards, add:

- `(currentOwner)`
- `(visibleTo role)`
- `(shipId, currentOwner, status)`

## Why This Fits The Existing Repo

- Uses the approval chain and ownership already defined in `ApprovalFlow`
- Reuses visibility control already enforced through `visibleTo`
- Reuses stale detection already exposed by `getStaleApprovalRecordsByShip`
- Uses approval history only as evidence for UI context, not as a source of new workflow transitions
- Keeps event, rule, and action flow untouched

## Implementation Boundary

Do:

- add projection helpers
- add read-only HTTP endpoints
- compute aggregates and attention signals

Do not:

- modify approval transitions
- modify approval ownership
- modify `ApprovalRule`
- emit events from dashboard requests
- write derived dashboard state back into approval records

## UI-Ready Command Dashboard

### Objective

Present the awareness layer as a decision-focused command dashboard for each role.

The dashboard should help a user answer three questions quickly:

1. What needs my action now?
2. What is becoming risky or blocked?
3. What should I remain aware of without acting now?

This is a read-only operational view. It must not present escalation controls or workflow mutation actions.

### Top-Level Layout

Use a simple three-section vertical layout:

1. `ACTION REQUIRED`
2. `NEEDS ATTENTION`
3. `FOR AWARENESS`

Recommended screen order:

- summary bar
- `ACTION REQUIRED`
- `NEEDS ATTENTION`
- `FOR AWARENESS`

This keeps the highest-consequence queue at the top and pushes passive visibility lower.

### Section Mapping

Map awareness buckets into dashboard sections as follows:

#### ACTION REQUIRED

Primary purpose:

- records where the role can act immediately

Bucket mapping:

- `PENDING_MY_ACTION`

Typical records:

- submitted approvals owned by the current role

#### NEEDS ATTENTION

Primary purpose:

- records that are not necessarily actionable this second, but are risky, stale, blocked, or recently bounced back

Bucket and signal mapping:

- `RECENTLY_REJECTED`
- any record with `STALE`
- any record with `PENDING_TOO_LONG`
- any record with `BLOCKED_BY_REJECTION`

Guidance:

- If a record is already in `ACTION REQUIRED`, keep it there and show its attention indicators on the card.
- Do not duplicate the same record in multiple sections.

#### FOR AWARENESS

Primary purpose:

- visible records that provide context but do not currently require action by the role

Bucket mapping:

- `OWNED`
  only when not already shown in `ACTION REQUIRED`
- `VISIBLE_NOT_OWNED`

Typical records:

- draft records still with originator
- records in another approval step but visible through `visibleTo`
- approved records that remain visible for context

### Signals to Visual Indicators

Signals should be compact, scannable, and consistent across all roles.

Recommended indicator mapping:

- `STALE`
  show amber badge: `Stale`
- `PENDING_TOO_LONG`
  show red badge: `Pending too long`
- `BLOCKED_BY_REJECTION`
  show red badge: `Rejected`

Recommended supporting cues:

- terminal `APPROVED`
  muted green status pill
- `SUBMITTED`
  blue status pill
- `DRAFT`
  neutral status pill
- `REJECTED`
  red status pill

Visual rule:

- keep badges flat and textual
- avoid multiple icon types
- limit each card to the highest-value 2-3 indicators

### Card Structure

Each record should render as a compact command card.

Suggested card fields:

```ts
interface DashboardRecordCard {
  id: string;
  title: string;
  ship: {
    id: string;
    name: string;
    classType: string;
  };
  status: ApprovalStatus;
  owner: AssignedRoleId;
  originRole: AssignedRoleId;
  kind: FleetRecordKind;
  ageHoursSinceLastAction: number | null;
  ageHoursSinceSubmission: number | null;
  reason: string | null;
  note: string | null;
  bucket: AwarenessBucket;
  attentionSignals: AttentionSignal[];
  computed: {
    isStale: boolean;
    isPendingTooLong: boolean;
  };
}
```

Recommended card layout:

- line 1:
  title
- line 2:
  ship name | record kind | status
- line 3:
  owner | age | origin role
- line 4:
  reason or note
- inline badges:
  stale, pending too long, rejected

Field behavior:

- `title`
  primary label, always visible
- `ship`
  always visible because command dashboards are ship-aware
- `status`
  always visible as a pill
- `owner`
  always visible to reinforce responsibility
- `age`
  prefer `ageHoursSinceLastAction`; fall back to `ageHoursSinceSubmission` only for submitted items if last action age is null
- `reason/note`
  show `lastActionReason` first, then `lastActionNote`; hide line entirely if both are null

### Sorting Rules

The dashboard should preserve the awareness-layer priority ordering.

#### Section priority

1. `ACTION REQUIRED`
2. `NEEDS ATTENTION`
3. `FOR AWARENESS`

#### Record priority within the full dataset

1. `PENDING_MY_ACTION` with attention signals
2. `PENDING_MY_ACTION`
3. `RECENTLY_REJECTED`
4. `OWNED`
5. `VISIBLE_NOT_OWNED`

#### Sorting inside each section

Within a section, sort by:

1. `ageHoursSinceLastAction` descending
2. `createdAt` ascending

Interpretation:

- oldest untouched operational risk rises first
- older created records break ties consistently

### Summary Bar

Place a compact summary bar above the sections.

Required counts:

- `pending`
- `stale`
- `rejected`
- `total`

Suggested mapping:

- `pending`
  count of `PENDING_MY_ACTION`
- `stale`
  count of visible records where `computed.isStale === true`
- `rejected`
  count of visible records where bucket is `RECENTLY_REJECTED` or signal includes `BLOCKED_BY_REJECTION`
- `total`
  total visible records in the current dashboard scope

Suggested shape:

```ts
interface DashboardSummaryBar {
  pending: number;
  stale: number;
  rejected: number;
  total: number;
}
```

This should be glanceable and should not require expansion.

### Component Breakdown

Use a small, repeatable component set.

#### 1. DashboardShell

Responsibility:

- page frame
- title
- role label
- summary bar
- section stacking

Inputs:

- `role`
- `summary`
- `sections`

#### 2. SummaryBar

Responsibility:

- show top counts without requiring drill-down

Inputs:

- `pending`
- `stale`
- `rejected`
- `total`

#### 3. DashboardSection

Responsibility:

- render section label and list of cards

Inputs:

- `title`
- `description`
- `records`

Sections:

- `ACTION REQUIRED`
- `NEEDS ATTENTION`
- `FOR AWARENESS`

#### 4. RecordCard

Responsibility:

- render one approval-awareness item in compact operational form

Inputs:

- `DashboardRecordCard`

#### 5. SignalBadge

Responsibility:

- render a single text indicator for:
  `Stale`, `Pending too long`, `Rejected`

#### 6. EmptyState

Responsibility:

- show when a section has no items

Examples:

- `No records currently require your action`
- `No at-risk records in view`
- `No additional records for awareness`

### Data-to-UI Mapping

#### Awareness record to UI card

- `recordId`
  card key and deep-link identifier
- `title`
  card heading
- `shipName`
  primary ship label
- `shipClass`
  secondary ship context
- `status`
  status pill
- `currentOwner`
  owner line
- `originRole`
  origin context
- `ageHoursSinceLastAction`
  age label
- `lastActionReason`
  primary explanatory text
- `lastActionNote`
  secondary explanatory text when reason is absent
- `attentionSignals`
  signal badges
- `bucket`
  section placement

#### Dashboard summary to UI header

- `totals.needingMyAction`
  summary `pending`
- `totals.stale`
  summary `stale`
- `totals.blockedByRejection`
  or `totals.recentlyRejected`
  summary `rejected`
- `totals.visible`
  summary `total`

#### Counts by dimension to optional drill-downs

- `countsByStatus`
  filter chips or compact analytics strip
- `countsByRole`
  backlog ownership overview
- `countsByShip`
  ship segmentation overview

These should remain secondary to the action-first sections.

### Section Construction Rules

Build sections from the sorted awareness records without duplicating records.

Recommended logic:

```ts
const actionRequired = records.filter(
  (record) => record.bucket === "PENDING_MY_ACTION",
);

const needsAttention = records.filter(
  (record) =>
    record.bucket !== "PENDING_MY_ACTION" &&
    (
      record.bucket === "RECENTLY_REJECTED" ||
      record.attentionSignals.includes("STALE") ||
      record.attentionSignals.includes("PENDING_TOO_LONG") ||
      record.attentionSignals.includes("BLOCKED_BY_REJECTION")
    ),
);

const forAwareness = records.filter(
  (record) =>
    record.bucket !== "PENDING_MY_ACTION" &&
    !(
      record.bucket === "RECENTLY_REJECTED" ||
      record.attentionSignals.includes("STALE") ||
      record.attentionSignals.includes("PENDING_TOO_LONG") ||
      record.attentionSignals.includes("BLOCKED_BY_REJECTION")
    ),
);
```

This preserves exclusivity at the section level while keeping the single underlying bucket model intact.

### Role-Specific Variations

Keep the same layout for every role and only vary emphasis.

#### MEO Dashboard

Primary focus:

- drafts returned for correction
- recently rejected engineering records
- records waiting to move upward to CO

Tone of awareness:

- quality and completeness of technical records
- machinery-readiness accountability

Likely section emphasis:

- `ACTION REQUIRED`
  MEO-owned submitted or returned items
- `NEEDS ATTENTION`
  stale drafts, rejected items, delayed submissions
- `FOR AWARENESS`
  records currently with CO, FSG, or Log Comd

#### CO Dashboard

Primary focus:

- approval decisions awaiting command review
- stale submissions escalated from engineering

Tone of awareness:

- command oversight
- operational bottleneck visibility

Likely section emphasis:

- `ACTION REQUIRED`
  `SUBMITTED` records owned by CO
- `NEEDS ATTENTION`
  delayed command decisions, recent rejections, older escalations
- `FOR AWARENESS`
  records still below CO or already advanced to FSG

#### FSG Dashboard

Primary focus:

- technical review workload
- intermediate maintenance and report scrutiny

Tone of awareness:

- engineering support backlog
- readiness review

Likely section emphasis:

- `ACTION REQUIRED`
  FSG-owned submitted reviews
- `NEEDS ATTENTION`
  stale technical reports, recent rejections from Log Comd
- `FOR AWARENESS`
  records still with CO or already at Log Comd

#### LOG_COMD Dashboard

Primary focus:

- final high-level review
- oversight of major maintenance and planning backlog

Tone of awareness:

- strategic workload visibility
- cross-ship oversight

Likely section emphasis:

- `ACTION REQUIRED`
  final approvals awaiting command action
- `NEEDS ATTENTION`
  long-pending major items, rejected final reviews, ship clusters with aging backlog
- `FOR AWARENESS`
  lower-stage records still visible for oversight

### Cognitive Load Guardrails

To keep the dashboard low-friction:

- keep only three sections
- avoid nested workflows or secondary action menus
- show one primary age metric
- prefer short textual badges over icon-heavy status systems
- hide null or empty fields instead of rendering placeholders
- do not duplicate the same record in more than one section
- keep counts and section titles stable across roles

### No-Control Constraint

This command dashboard must not include:

- approve/reject buttons
- escalation controls
- workflow mutation actions
- reassignment controls

It is a situational-awareness surface, not a workflow editor.

### Suggested UI Output Shape

```ts
interface CommandDashboardView {
  role: AssignedRoleId;
  generatedAt: string;
  summaryBar: {
    pending: number;
    stale: number;
    rejected: number;
    total: number;
  };
  sections: Array<{
    id: "ACTION_REQUIRED" | "NEEDS_ATTENTION" | "FOR_AWARENESS";
    title: string;
    description: string;
    records: DashboardRecordCard[];
  }>;
  aggregates: {
    countsByStatus: Record<ApprovalStatus, number>;
    countsByRole: Record<AssignedRoleId, number>;
    countsByShip: Record<string, number>;
  };
}
```

This output is directly consumable by a UI or command display without introducing new workflow behavior.
