// Defects domain types: defect reports and related models

import type { SystemGroupId } from "../shared/types";

export interface Defect {
  id: string;
  shipId: string;
  systemGroup: SystemGroupId;
  iss: string;
  equipment: string;
  description: string;
  classification: "IMMEDIATE" | "UNSCHEDULED" | "DELAYED";
  operationalImpact: string;
  reportedBy: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  ettr?: number;
  repairLevel?: "OLM" | "ILM" | "DLM";
}
