import { useEffect, useState } from "react";
import {
  loadCoDashboardData,
  type CoDashboardData,
} from "../services/co-dashboard.service";

type ResourceStatus = "loading" | "success" | "error";

export interface CoDashboardState {
  status: ResourceStatus;
  data: CoDashboardData | null;
  error: string | null;
}

export function useCoDashboardState(): CoDashboardState {
  const [state, setState] = useState<CoDashboardState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await loadCoDashboardData();
        if (active) {
          setState({ status: "success", data, error: null });
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Failed to load CO dashboard",
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
