import type { ExceptionListItem } from "../components/dashboard/ExceptionList";
import type { RecordDetailData } from "../services/record-detail.service";

export interface RecordDetailViewModel {
  title: string;
  subtitle: string;
  metadata: Array<{ label: string; value: string }>;
  historyItems: ExceptionListItem[];
}

export function createRecordDetailViewModel(
  data: RecordDetailData,
): RecordDetailViewModel | null {
  const record = data.detail.record;
  if (!record) {
    return null;
  }

  return {
    title: record.title,
    subtitle: `${record.kind} · Ship ${record.shipId}`,
    metadata: [
      { label: "Status", value: record.approval.status },
      { label: "Current Owner", value: record.approval.currentOwner },
      { label: "Origin Role", value: record.originRole },
      { label: "Business Date", value: record.businessDate },
    ],
    historyItems: data.detail.history.map((entry, index) => ({
      key: `${entry.actionType}-${entry.timestamp}-${index}`,
      primary: entry.actionType,
      secondary: `${entry.actor} · ${entry.note ?? "No note"}`,
      meta: `${entry.timestamp}${entry.reason ? ` · ${entry.reason}` : ""}`,
    })),
  };
}
