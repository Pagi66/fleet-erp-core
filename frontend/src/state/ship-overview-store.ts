import { useEffect, useState } from "react";
import {
  loadShipOverviewData,
  type ShipOverviewData,
} from "../services/ship-overview.service";

type ShipOverviewStatus = "loading" | "success" | "error";

export interface ShipOverviewState {
  status: ShipOverviewStatus;
  data: ShipOverviewData | null;
  error: string | null;
}

export function useShipOverviewState(shipId: string): ShipOverviewState {
  const [state, setState] = useState<ShipOverviewState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    setState({
      status: "loading",
      data: null,
      error: null,
    });

    async function load() {
      try {
        const data = await loadShipOverviewData(shipId);
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
            data: null,
            error: loadError instanceof Error ? loadError.message : "Failed to load ship view",
          });
        }
      }
    }

    if (!shipId) {
      setState({
        status: "error",
        data: null,
        error: "Ship id is required",
      });
      return () => {
        active = false;
      };
    }

    void load();
    return () => {
      active = false;
    };
  }, [shipId]);

  return state;
}
