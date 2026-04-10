import { getRecordDetail } from "../api/records";
import type { DashboardRole } from "../types/roles";

export interface RecordDetailData {
  role: DashboardRole;
  detail: Awaited<ReturnType<typeof getRecordDetail>>;
}

export async function loadRecordDetailData(
  recordId: string,
  role: DashboardRole,
): Promise<RecordDetailData> {
  const detail = await getRecordDetail(recordId, role);
  return {
    role,
    detail,
  };
}
