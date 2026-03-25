import {
  ApprovalAwarenessRecord,
  AttentionSignal,
  AssignedRoleId,
} from "../core/types";
import { CommandDashboardView } from "./command-dashboard.projection";

export type SectionKey =
  | "ACTION_REQUIRED"
  | "NEEDS_ATTENTION"
  | "FOR_AWARENESS";

export interface CommandDashboardCardView {
  recordId: string;
  title: string;
  ship: {
    id: string;
    name: string;
    classType: string;
  };
  status: ApprovalAwarenessRecord["status"];
  currentOwner: AssignedRoleId;
  ageHoursSinceLastAction: number | null;
  reason: string | null;
  note: string | null;
  attentionSignals: readonly AttentionSignal[];
}

export interface CommandDashboardSectionState {
  id: SectionKey;
  expanded: boolean;
  minimized: boolean;
  recordIds: readonly string[];
}

export interface CommandDashboardInteractionState {
  readonly sectionOrder: readonly SectionKey[];
  readonly activeSection: SectionKey;
  readonly selectedRecordId: string | null;
  readonly scrollPosition: number;
  readonly sections: Readonly<Record<SectionKey, CommandDashboardSectionState>>;
}

export interface CommandDashboardPreviousState {
  activeSection: SectionKey;
  selectedRecordId: string | null;
  scrollPosition: number;
  sectionRecordIds?: Readonly<Record<SectionKey, readonly string[]>>;
}

export interface RejectionFocus {
  recordId: string;
  status: ApprovalAwarenessRecord["status"];
  reason: string;
  note: string | null;
}

const SECTION_KEY_ACTION_REQUIRED: SectionKey = "ACTION_REQUIRED";
const SECTION_KEY_NEEDS_ATTENTION: SectionKey = "NEEDS_ATTENTION";
const SECTION_KEY_FOR_AWARENESS: SectionKey = "FOR_AWARENESS";

const DASHBOARD_SECTION_ORDER: readonly SectionKey[] = Object.freeze([
  SECTION_KEY_ACTION_REQUIRED,
  SECTION_KEY_NEEDS_ATTENTION,
  SECTION_KEY_FOR_AWARENESS,
]);

const ENABLE_VISIBILITY_GUARD = process.env.NODE_ENV !== "production";

export function getInitialDashboardState(
  view: CommandDashboardView,
): CommandDashboardInteractionState {
  assertSectionExclusivity(view);
  assertViewVisibility(view);

  const activeSection = resolveInitialSection(view);
  const selectedRecordId = getFirstRecordId(view, activeSection);

  return freezeInteractionState({
    sectionOrder: DASHBOARD_SECTION_ORDER,
    activeSection,
    selectedRecordId,
    scrollPosition: 0,
    sections: buildSectionStates(view),
  });
}

export function getActionQueue(
  role: AssignedRoleId,
  view: CommandDashboardView,
): readonly ApprovalAwarenessRecord[] {
  assertRoleMatchesView(role, view);
  assertSectionExclusivity(view);
  assertRecordsVisibleToRole(role, view.sections.actionRequired);
  return Object.freeze([...view.sections.actionRequired].sort(compareRecordsByInteractionPriority));
}

export function computeAttentionPriority(
  record: ApprovalAwarenessRecord,
): number {
  let score = 0;

  if (record.attentionSignals.includes("STALE")) {
    score += 100;
  }

  if (record.attentionSignals.includes("PENDING_TOO_LONG")) {
    score += 10;
  }

  if (record.attentionSignals.includes("BLOCKED_BY_REJECTION")) {
    score += 1;
  }

  return score;
}

export function getRejectionFocus(
  record: ApprovalAwarenessRecord,
): RejectionFocus {
  if (record.status !== "REJECTED") {
    throw new Error(`Rejection focus requires a rejected record: ${record.recordId}`);
  }

  const reason = record.lastActionReason?.trim() ?? "";
  if (reason === "") {
    throw new Error(`Rejected record is missing rejection reason: ${record.recordId}`);
  }

  return Object.freeze({
    recordId: record.recordId,
    status: record.status,
    reason,
    note: record.lastActionNote,
  });
}

export function restoreDashboardState(
  previousState: CommandDashboardPreviousState,
  view: CommandDashboardView,
): CommandDashboardInteractionState {
  assertSectionExclusivity(view);
  assertViewVisibility(view);
  const initialState = getInitialDashboardState(view);
  const nextActiveSection = hasRecordsInSection(view, previousState.activeSection)
    ? previousState.activeSection
    : initialState.activeSection;
  const nextSelectedRecordId = resolveRestoredSelection(previousState, view, nextActiveSection);

  return freezeInteractionState({
    sectionOrder: initialState.sectionOrder,
    activeSection: nextActiveSection,
    selectedRecordId: nextSelectedRecordId,
    scrollPosition: normalizeScrollPosition(previousState.scrollPosition),
    sections: initialState.sections,
  });
}

export function toCommandDashboardCardView(
  record: ApprovalAwarenessRecord,
): CommandDashboardCardView {
  const card: CommandDashboardCardView = {
    recordId: record.recordId,
    title: record.title,
    ship: Object.freeze({
      id: record.shipId,
      name: record.shipName,
      classType: record.shipClass,
    }),
    status: record.status,
    currentOwner: record.currentOwner,
    ageHoursSinceLastAction: record.ageHoursSinceLastAction,
    reason: record.lastActionReason,
    note: record.lastActionNote,
    attentionSignals: Object.freeze([...record.attentionSignals]),
  };

  return Object.freeze(card);
}

export function compareRecordsByInteractionPriority(
  left: ApprovalAwarenessRecord,
  right: ApprovalAwarenessRecord,
): number {
  const attentionDifference = computeAttentionPriority(right) - computeAttentionPriority(left);
  if (attentionDifference !== 0) {
    return attentionDifference;
  }

  const ageDifference = compareAgeDescending(left, right);
  if (ageDifference !== 0) {
    return ageDifference;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return left.recordId.localeCompare(right.recordId);
}

function resolveInitialSection(view: CommandDashboardView): SectionKey {
  if (view.sections.actionRequired.length > 0) {
    return SECTION_KEY_ACTION_REQUIRED;
  }

  if (view.sections.needsAttention.length > 0) {
    return SECTION_KEY_NEEDS_ATTENTION;
  }

  return SECTION_KEY_FOR_AWARENESS;
}

function buildSectionStates(
  view: CommandDashboardView,
): Record<SectionKey, CommandDashboardSectionState> {
  return {
    ACTION_REQUIRED: createSectionState(
      SECTION_KEY_ACTION_REQUIRED,
      sortSectionRecords(view.sections.actionRequired),
      true,
    ),
    NEEDS_ATTENTION: createSectionState(
      SECTION_KEY_NEEDS_ATTENTION,
      sortSectionRecords(view.sections.needsAttention),
      view.sections.needsAttention.some((record) => record.attentionSignals.length > 0),
    ),
    FOR_AWARENESS: createSectionState(
      SECTION_KEY_FOR_AWARENESS,
      sortSectionRecords(view.sections.forAwareness),
      false,
    ),
  };
}

function createSectionState(
  id: SectionKey,
  records: readonly ApprovalAwarenessRecord[],
  expanded: boolean,
): CommandDashboardSectionState {
  return Object.freeze({
    id,
    expanded: records.length === 0 ? false : expanded,
    minimized: records.length === 0,
    recordIds: Object.freeze(records.map((record) => record.recordId)),
  });
}

function resolveRestoredSelection(
  previousState: CommandDashboardPreviousState,
  view: CommandDashboardView,
  activeSection: SectionKey,
): string | null {
  const records = sortSectionRecords(getSectionRecords(view, activeSection));
  if (records.length === 0) {
    return null;
  }

  if (previousState.activeSection !== activeSection) {
    return records[0]?.recordId ?? null;
  }

  if (previousState.selectedRecordId !== null) {
    const sameIndex = records.findIndex((record) => record.recordId === previousState.selectedRecordId);
    if (sameIndex >= 0) {
      return records[sameIndex]?.recordId ?? null;
    }

    const previousIndex = getPreviousSelectionIndex(previousState, view, activeSection);
    const boundedIndex = Math.min(Math.max(previousIndex, 0), records.length - 1);
    return records[boundedIndex]?.recordId ?? records[0]?.recordId ?? null;
  }

  return records[0]?.recordId ?? null;
}

function getPreviousSelectionIndex(
  previousState: CommandDashboardPreviousState,
  view: CommandDashboardView,
  section: SectionKey,
): number {
  const previousSectionRecordIds = previousState.sectionRecordIds?.[section];
  if (previousSectionRecordIds && previousState.selectedRecordId !== null) {
    const previousIndex = previousSectionRecordIds.findIndex(
      (recordId) => recordId === previousState.selectedRecordId,
    );
    if (previousIndex >= 0) {
      return previousIndex;
    }
  }

  const currentSectionRecords = sortSectionRecords(getSectionRecords(view, section));
  const currentIndex = currentSectionRecords.findIndex(
    (record) => record.recordId === previousState.selectedRecordId,
  );
  return currentIndex >= 0 ? currentIndex : 0;
}

function freezeInteractionState(
  state: {
    sectionOrder: readonly SectionKey[];
    activeSection: SectionKey;
    selectedRecordId: string | null;
    scrollPosition: number;
    sections: Record<SectionKey, CommandDashboardSectionState>;
  },
): CommandDashboardInteractionState {
  Object.freeze(state.sections);
  return Object.freeze({
    sectionOrder: Object.freeze([...state.sectionOrder]),
    activeSection: state.activeSection,
    selectedRecordId: state.selectedRecordId,
    scrollPosition: state.scrollPosition,
    sections: state.sections,
  });
}

function assertSectionExclusivity(view: CommandDashboardView): void {
  const sectionRecords: ReadonlyArray<readonly ApprovalAwarenessRecord[]> = [
    view.sections.actionRequired,
    view.sections.needsAttention,
    view.sections.forAwareness,
  ];
  const seenRecordIds = new Set<string>();

  for (const records of sectionRecords) {
    for (const record of records) {
      if (seenRecordIds.has(record.recordId)) {
        throw new Error(`Command dashboard section duplication detected: ${record.recordId}`);
      }
      seenRecordIds.add(record.recordId);
    }
  }
}

function assertRoleMatchesView(
  role: AssignedRoleId,
  view: CommandDashboardView,
): void {
  if (view.role !== role) {
    throw new Error(
      `Command dashboard role mismatch: requested ${role}, view provided ${view.role}`,
    );
  }
}

function assertViewVisibility(view: CommandDashboardView): void {
  assertRecordsVisibleToRole(view.role, view.sections.actionRequired);
  assertRecordsVisibleToRole(view.role, view.sections.needsAttention);
  assertRecordsVisibleToRole(view.role, view.sections.forAwareness);
}

function assertRecordsVisibleToRole(
  role: AssignedRoleId,
  records: readonly ApprovalAwarenessRecord[],
): void {
  if (!ENABLE_VISIBILITY_GUARD) {
    return;
  }

  for (const record of records) {
    if (!record.visibleTo.includes(role)) {
      throw new Error(`Command dashboard visibility violation for role ${role}: ${record.recordId}`);
    }
  }
}

function hasRecordsInSection(
  view: CommandDashboardView,
  section: SectionKey,
): boolean {
  return getSectionRecords(view, section).length > 0;
}

function getFirstRecordId(
  view: CommandDashboardView,
  section: SectionKey,
): string | null {
  return sortSectionRecords(getSectionRecords(view, section))[0]?.recordId ?? null;
}

function getSectionRecords(
  view: CommandDashboardView,
  section: SectionKey,
): readonly ApprovalAwarenessRecord[] {
  switch (section) {
    case "ACTION_REQUIRED":
      return view.sections.actionRequired;
    case "NEEDS_ATTENTION":
      return view.sections.needsAttention;
    case "FOR_AWARENESS":
      return view.sections.forAwareness;
    default:
      return assertNever(section);
  }
}

function compareAgeDescending(
  left: ApprovalAwarenessRecord,
  right: ApprovalAwarenessRecord,
): number {
  const leftAge = left.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
  const rightAge = right.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
  return rightAge - leftAge;
}

function sortSectionRecords(
  records: readonly ApprovalAwarenessRecord[],
): readonly ApprovalAwarenessRecord[] {
  return Object.freeze([...records].sort(compareRecordsByInteractionPriority));
}

function normalizeScrollPosition(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled section key: ${String(value)}`);
}
