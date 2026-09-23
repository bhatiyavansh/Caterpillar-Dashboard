import {
  Boxes,
  GraduationCap,
  LayoutDashboard,
  type LucideIcon,
  MonitorCog,
  ScanLine,
  Truck,
  Wallet,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  /** Who this surface is for — shown in the sidebar so the IA explains itself. */
  audience: string;
  icon: LucideIcon;
  /** Marks the internal demo-control route. */
  demoOnly?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    id: "operate",
    label: "Operate",
    items: [
      {
        href: "/command",
        label: "Command centre",
        audience: "Site manager",
        icon: LayoutDashboard,
      },
      { href: "/cab", label: "Operator cab", audience: "Machine operator", icon: Truck },
    ],
  },
  {
    id: "manage",
    label: "Manage",
    items: [
      { href: "/owner", label: "Fleet and cost", audience: "Owner and dealer", icon: Wallet },
      { href: "/training", label: "Training hub", audience: "Trainee and instructor", icon: GraduationCap },
      { href: "/ar", label: "AR maintenance", audience: "Technician, on a phone", icon: ScanLine },
    ],
  },
  {
    id: "depth",
    label: "Fleet operations",
    items: [{ href: "/dashboard", label: "Machine records", audience: "Maintenance and diagnostics", icon: Boxes }],
  },
];

export const DIRECTOR_NAV: NavItem = {
  href: "/director",
  label: "Demo control",
  audience: "Internal",
  icon: MonitorCog,
  demoOnly: true,
};

/** Flat list, used by the command palette and the active-route match. */
export const ALL_NAV: NavItem[] = [...NAV.flatMap((g) => g.items), DIRECTOR_NAV];
