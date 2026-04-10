import { useEffect, useState } from "react";
import {
  loadMeoDashboardData,
  type MeoDashboardData,
} from "../services/meo-dashboard.service";

type ResourceStatus = "loading" | "success" | "error";

export interface MeoDashboardState {
  status: ResourceStatus;
  data: MeoDashboardData | null;
  error: string | null;
}

export function useMeoDashboardState(shipId: string | null): MeoDashboardState {
  const [state, setState] = useState<MeoDashboardState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await loadMeoDashboardData(shipId);
        if (active) {
          setState({ status: "success", data, error: null });
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Failed to load MEO dashboard",
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
