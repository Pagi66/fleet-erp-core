import { useEffect, useState } from "react";
import {
  loadFsgDashboardData,
  type FsgDashboardData,
} from "../services/fsg-dashboard.service";

type ResourceStatus = "loading" | "success" | "error";

export interface FsgDashboardState {
  status: ResourceStatus;
  data: FsgDashboardData | null;
  error: string | null;
}

export function useFsgDashboardState(): FsgDashboardState {
  const [state, setState] = useState<FsgDashboardState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await loadFsgDashboardData();
        if (active) {
          setState({ status: "success", data, error: null });
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Failed to load FSG dashboard",
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
