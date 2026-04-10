import { useEffect, useState } from "react";
import {
  loadLogComdDashboardData,
  type LogComdDashboardData,
} from "../services/log-comd-dashboard.service";

type ResourceStatus = "loading" | "success" | "error";

export interface LogComdDashboardState {
  status: ResourceStatus;
  data: LogComdDashboardData | null;
  error: string | null;
}

export function useLogComdDashboardState(): LogComdDashboardState {
  const [state, setState] = useState<LogComdDashboardState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await loadLogComdDashboardData();
        if (active) {
          setState({ status: "success", data, error: null });
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Failed to load Log Comd dashboard",
          });
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
