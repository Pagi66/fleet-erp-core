import { useEffect, useState } from "react";
import {
  loadWeoDashboardData,
  type WeoDashboardData,
} from "../services/weo-dashboard.service";

type ResourceStatus = "loading" | "success" | "error";

export interface WeoDashboardState {
  status: ResourceStatus;
  data: WeoDashboardData | null;
  error: string | null;
}

export function useWeoDashboardState(shipId: string | null): WeoDashboardState {
  const [state, setState] = useState<WeoDashboardState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await loadWeoDashboardData(shipId);
        if (active) {
          setState({ status: "success", data, error: null });
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Failed to load WEO dashboard",
          });
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [shipId]);

  return state;
}
