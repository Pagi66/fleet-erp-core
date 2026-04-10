import { useEffect, useState } from "react";
import {
  loadRecordDetailData,
  type RecordDetailData,
} from "../services/record-detail.service";
import type { DashboardRole } from "../types/roles";

type ResourceStatus = "loading" | "success" | "error";

export interface RecordDetailState {
  status: ResourceStatus;
  data: RecordDetailData | null;
  error: string | null;
}

export function useRecordDetailState(
  recordId: string,
  role: DashboardRole | null,
): RecordDetailState {
  const [state, setState] = useState<RecordDetailState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      if (!role) {
        setState({
          status: "error",
          data: null,
          error: "Valid role query parameter is required",
        });
        return;
      }

      try {
        const data = await loadRecordDetailData(recordId, role);
        if (active) {
          setState({ status: "success", data, error: null });
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Failed to load record detail",
          });
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [recordId, role]);

  return state;
}
