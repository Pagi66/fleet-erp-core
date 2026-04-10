import { useEffect, useState } from "react";
import {
  loadFailedEventsData,
  type FailedEventsData,
} from "../services/failed-events.service";

type FailedEventsStatus = "loading" | "success" | "error";

export interface FailedEventsState {
  status: FailedEventsStatus;
  data: FailedEventsData;
  error: string | null;
}

const emptyFailedEventsData: FailedEventsData = {
  events: [],
};

export function useFailedEventsState(): FailedEventsState {
  const [state, setState] = useState<FailedEventsState>({
    status: "loading",
    data: emptyFailedEventsData,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await loadFailedEventsData();
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
            data: emptyFailedEventsData,
            error: loadError instanceof Error ? loadError.message : "Failed to load failed events",
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
