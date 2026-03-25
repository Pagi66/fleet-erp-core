"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInitialDashboardState = getInitialDashboardState;
exports.getActionQueue = getActionQueue;
exports.computeAttentionPriority = computeAttentionPriority;
exports.getRejectionFocus = getRejectionFocus;
exports.restoreDashboardState = restoreDashboardState;
exports.toCommandDashboardCardView = toCommandDashboardCardView;
exports.compareRecordsByInteractionPriority = compareRecordsByInteractionPriority;
const SECTION_KEY_ACTION_REQUIRED = "ACTION_REQUIRED";
const SECTION_KEY_NEEDS_ATTENTION = "NEEDS_ATTENTION";
const SECTION_KEY_FOR_AWARENESS = "FOR_AWARENESS";
const DASHBOARD_SECTION_ORDER = Object.freeze([
    SECTION_KEY_ACTION_REQUIRED,
    SECTION_KEY_NEEDS_ATTENTION,
    SECTION_KEY_FOR_AWARENESS,
]);
const ENABLE_VISIBILITY_GUARD = process.env.NODE_ENV !== "production";
function getInitialDashboardState(view) {
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
function getActionQueue(role, view) {
    assertRoleMatchesView(role, view);
    assertSectionExclusivity(view);
    assertRecordsVisibleToRole(role, view.sections.actionRequired);
    return Object.freeze([...view.sections.actionRequired].sort(compareRecordsByInteractionPriority));
}
function computeAttentionPriority(record) {
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
function getRejectionFocus(record) {
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
function restoreDashboardState(previousState, view) {
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
function toCommandDashboardCardView(record) {
    const card = {
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
function compareRecordsByInteractionPriority(left, right) {
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
function resolveInitialSection(view) {
    if (view.sections.actionRequired.length > 0) {
        return SECTION_KEY_ACTION_REQUIRED;
    }
    if (view.sections.needsAttention.length > 0) {
        return SECTION_KEY_NEEDS_ATTENTION;
    }
    return SECTION_KEY_FOR_AWARENESS;
}
function buildSectionStates(view) {
    return {
        ACTION_REQUIRED: createSectionState(SECTION_KEY_ACTION_REQUIRED, sortSectionRecords(view.sections.actionRequired), true),
        NEEDS_ATTENTION: createSectionState(SECTION_KEY_NEEDS_ATTENTION, sortSectionRecords(view.sections.needsAttention), view.sections.needsAttention.some((record) => record.attentionSignals.length > 0)),
        FOR_AWARENESS: createSectionState(SECTION_KEY_FOR_AWARENESS, sortSectionRecords(view.sections.forAwareness), false),
    };
}
function createSectionState(id, records, expanded) {
    return Object.freeze({
        id,
        expanded: records.length === 0 ? false : expanded,
        minimized: records.length === 0,
        recordIds: Object.freeze(records.map((record) => record.recordId)),
    });
}
function resolveRestoredSelection(previousState, view, activeSection) {
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
function getPreviousSelectionIndex(previousState, view, section) {
    const previousSectionRecordIds = previousState.sectionRecordIds?.[section];
    if (previousSectionRecordIds && previousState.selectedRecordId !== null) {
        const previousIndex = previousSectionRecordIds.findIndex((recordId) => recordId === previousState.selectedRecordId);
        if (previousIndex >= 0) {
            return previousIndex;
        }
    }
    const currentSectionRecords = sortSectionRecords(getSectionRecords(view, section));
    const currentIndex = currentSectionRecords.findIndex((record) => record.recordId === previousState.selectedRecordId);
    return currentIndex >= 0 ? currentIndex : 0;
}
function freezeInteractionState(state) {
    Object.freeze(state.sections);
    return Object.freeze({
        sectionOrder: Object.freeze([...state.sectionOrder]),
        activeSection: state.activeSection,
        selectedRecordId: state.selectedRecordId,
        scrollPosition: state.scrollPosition,
        sections: state.sections,
    });
}
function assertSectionExclusivity(view) {
    const sectionRecords = [
        view.sections.actionRequired,
        view.sections.needsAttention,
        view.sections.forAwareness,
    ];
    const seenRecordIds = new Set();
    for (const records of sectionRecords) {
        for (const record of records) {
            if (seenRecordIds.has(record.recordId)) {
                throw new Error(`Command dashboard section duplication detected: ${record.recordId}`);
            }
            seenRecordIds.add(record.recordId);
        }
    }
}
function assertRoleMatchesView(role, view) {
    if (view.role !== role) {
        throw new Error(`Command dashboard role mismatch: requested ${role}, view provided ${view.role}`);
    }
}
function assertViewVisibility(view) {
    assertRecordsVisibleToRole(view.role, view.sections.actionRequired);
    assertRecordsVisibleToRole(view.role, view.sections.needsAttention);
    assertRecordsVisibleToRole(view.role, view.sections.forAwareness);
}
function assertRecordsVisibleToRole(role, records) {
    if (!ENABLE_VISIBILITY_GUARD) {
        return;
    }
    for (const record of records) {
        if (!record.visibleTo.includes(role)) {
            throw new Error(`Command dashboard visibility violation for role ${role}: ${record.recordId}`);
        }
    }
}
function hasRecordsInSection(view, section) {
    return getSectionRecords(view, section).length > 0;
}
function getFirstRecordId(view, section) {
    return sortSectionRecords(getSectionRecords(view, section))[0]?.recordId ?? null;
}
function getSectionRecords(view, section) {
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
function compareAgeDescending(left, right) {
    const leftAge = left.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
    const rightAge = right.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
    return rightAge - leftAge;
}
function sortSectionRecords(records) {
    return Object.freeze([...records].sort(compareRecordsByInteractionPriority));
}
function normalizeScrollPosition(value) {
    return Number.isFinite(value) && value >= 0 ? value : 0;
}
function assertNever(value) {
    throw new Error(`Unhandled section key: ${String(value)}`);
}
//# sourceMappingURL=command-dashboard.interaction.js.map