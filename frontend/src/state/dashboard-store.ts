import { useEffect, useState } from "react";
import { loadDashboardData, type DashboardData } from "../services/dashboard.service";

type DashboardStatus = "loading" | "success" | "error";

export interface DashboardState {
  status: DashboardStatus;
  data: DashboardData;
  error: string | null;
}

const emptyDashboardData: DashboardData = {
  ships: [],
};

export function useDashboardState(): DashboardState {
  const [state, setState] = useState<DashboardState>({
    status: "loading",
    data: emptyDashboardData,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await loadDashboardData();
        if (active) {
          setState({
            status: "success",
            data,
            error: null,
          });
        }
      } catch (loadError) {
        if (active) {
          setState({
            status: "error",
            data: emptyDashboardData,
            error: loadError instanceof Error ? loadError.message : "Failed to load dashboard",
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
