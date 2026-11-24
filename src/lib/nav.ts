import {
  Bot,
  ClipboardList,
  Gift,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Settings,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

// Single source of truth for the app's main navigation. The sidebar renders
// it and the command palette (Cmd/Ctrl+K) searches it, so a page added here
// shows up in both.

export interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational - doesn't affect routing or access.
   */
  beta?: boolean;
}

export const navItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
  { href: "/contacts", labelKey: "contacts", icon: Users },
  { href: "/forms", labelKey: "forms", icon: ClipboardList },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
  { href: "/automations", labelKey: "automations", icon: Zap },
  { href: "/flows", labelKey: "flows", icon: Workflow, beta: true },
  { href: "/agents", labelKey: "aiAgents", icon: Bot },
];

export const bottomNavItems: NavItem[] = [
  { href: "/affiliate", labelKey: "partner", icon: Gift },
  { href: "/settings", labelKey: "settings", icon: Settings },
];

