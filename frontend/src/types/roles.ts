export type DashboardRole =
  | "COMMANDING_OFFICER"
  | "MARINE_ENGINEERING_OFFICER"
  | "WEAPON_ELECTRICAL_OFFICER"
  | "FLEET_SUPPORT_GROUP"
  | "LOGISTICS_COMMAND";

export interface DashboardRoleDefinition {
  role: DashboardRole;
  label: string;
  shortLabel: string;
  route: string;
  subtitle: string;
  requiresShipSelector: boolean;
}

export const DASHBOARD_ROLE_DEFINITIONS: DashboardRoleDefinition[] = [
  {
    role: "COMMANDING_OFFICER",
    label: "CO Dashboard",
    shortLabel: "CO",
    route: "/dashboards/co",
    subtitle: "Fleet-wide command overview and exception scanning.",
    requiresShipSelector: false,
  },
  {
    role: "MARINE_ENGINEERING_OFFICER",
    label: "MEO Dashboard",
    shortLabel: "MEO",
    route: "/dashboards/meo",
    subtitle: "Engineering readiness and compliance control by ship.",
    requiresShipSelector: true,
  },
  {
    role: "WEAPON_ELECTRICAL_OFFICER",
    label: "WEO Dashboard",
    shortLabel: "WEO",
    route: "/dashboards/weo",
    subtitle: "Weapon and electrical readiness by ship.",
    requiresShipSelector: true,
  },
  {
    role: "FLEET_SUPPORT_GROUP",
    label: "FSG Dashboard",
    shortLabel: "FSG",
    route: "/dashboards/fsg",
    subtitle: "Intermediate maintenance awareness and actionable records.",
    requiresShipSelector: false,
  },
  {
    role: "LOGISTICS_COMMAND",
    label: "Log Comd Dashboard",
    shortLabel: "Log Comd",
    route: "/dashboards/log-comd",
    subtitle: "Command-level maintenance and approval bottlenecks.",
    requiresShipSelector: false,
  },
];

export function getDashboardRoleDefinition(
  role: DashboardRole,
): DashboardRoleDefinition {
  const definition = DASHBOARD_ROLE_DEFINITIONS.find((entry) => entry.role === role);
  if (!definition) {
    throw new Error(`Unknown dashboard role: ${role}`);
  }

  return definition;
}
