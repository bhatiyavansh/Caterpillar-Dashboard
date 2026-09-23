import {
  Activity,
  BellRing,
  Boxes,
  ClipboardList,
  Cog,
  FileBarChart,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  type LucideIcon,
  MonitorCog,
  MonitorPlay,
  Radio,
  ScanLine,
  Stethoscope,
  Truck,
  Wallet,
  Wrench,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  /** Who this surface is for — shown in the sidebar so the IA explains itself. */
  audience: string;
  icon: LucideIcon;
  /** Marks an internal, non-customer route. */
  internal?: boolean;
  /** Opens outside the app shell (full-bleed route). */
  fullBleed?: boolean;
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
      { href: "/command", label: "Command centre", audience: "Site manager", icon: LayoutDashboard },
      { href: "/cab", label: "Operator cab", audience: "Machine operator", icon: Truck },
      { href: "/twin", label: "Live 3D twin", audience: "Full-screen site view", icon: Boxes, fullBleed: true },
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
    id: "records",
    label: "Machine records",
    items: [
      { href: "/dashboard", label: "Fleet operations", audience: "Maintenance and diagnostics", icon: Gauge },
    ],
  },
  {
    id: "internal",
    label: "Internal",
    items: [
      { href: "/director", label: "Demo control", audience: "Scenario triggers", icon: MonitorCog, internal: true },
      { href: "/machine", label: "In-cab display", audience: "Hardware simulation", icon: MonitorPlay, internal: true },
      { href: "/dev/stream", label: "Stream inspector", audience: "Live hub diagnostics", icon: Radio, internal: true },
    ],
  },
];

/**
 * Sections inside `/dashboard`. These used to live in a second sidebar of their
 * own, which made the records area look like a different product. They are now
 * a sub-navigation rail inside the one shell.
 */
export const DASHBOARD_SECTIONS: NavItem[] = [
  { href: "/dashboard", label: "Overview", audience: "", icon: LayoutDashboard },
  { href: "/dashboard/fleet", label: "Fleet", audience: "", icon: Truck },
  { href: "/dashboard/machines", label: "Machines", audience: "", icon: Gauge },
  { href: "/dashboard/live", label: "Live monitoring", audience: "", icon: Activity },
  { href: "/dashboard/maintenance", label: "Maintenance", audience: "", icon: Wrench },
  { href: "/dashboard/diagnostics", label: "Diagnostics", audience: "", icon: Stethoscope },
  { href: "/dashboard/tasks", label: "Tasks", audience: "", icon: ClipboardList },
  { href: "/dashboard/alerts", label: "Alerts", audience: "", icon: BellRing },
  { href: "/dashboard/reports", label: "Reports", audience: "", icon: FileBarChart },
  { href: "/dashboard/settings", label: "Settings", audience: "", icon: Cog },
];

/** Flat list, used by the command palette and the active-route match. */
export const ALL_NAV: NavItem[] = [...NAV.flatMap((g) => g.items), ...DASHBOARD_SECTIONS];

/** Longest-prefix match, so `/dashboard/alerts` resolves to the section, not `/dashboard`. */
export function activeNavItem(pathname: string): NavItem | undefined {
  return [...ALL_NAV]
    .filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
