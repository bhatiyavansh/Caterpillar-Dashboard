"use client";

/**
 * The one site assistant, shared by every screen.
 *
 * There is exactly one conversation, one `useVoice` (so one microphone
 * handler and one speech queue) and one set of pending confirmations for the
 * whole app. It lives here, above the router, so it survives navigation:
 * a question asked on /command keeps streaming while the user moves to /cab,
 * and the answer is still there when they get back.
 *
 * Screens do not create assistants. They *describe themselves* to this one
 * with `useAssistantScope` (which surface they are, which machine, what the
 * trainee is doing right now), and the next question goes out with that
 * context. Where a screen has room, it renders the conversation inline
 * (`AssistantPanel variant="inline"`); everywhere else the dock opens the same
 * conversation in a drawer.
 */
import * as React from "react";
import { usePathname } from "next/navigation";
import type { AssistantContext } from "@web/lib/stream";
import type { AssistantSurface } from "@web/lib/assistant";
import { useVoice, type VoiceLang } from "@web/lib/voice";

/** What a screen tells the assistant about itself. Later registrations win, field by field. */
export interface AssistantScope {
  surface?: AssistantSurface;
  machineId?: string;
  operatorId?: string;
  /** A safety alert is open for this screen's machine: drives the avatar's alert state. */
  alert?: boolean;
  /** Starter questions for this screen. */
  suggestions?: string[];
  /** Short name shown in the assistant header, e.g. "Cab · EXC001". */
  label?: string;
  /** Extra screen context, read at the moment a question is sent (never on every render). */
  getContext?: () => Omit<AssistantContext, "route"> | null | undefined;
}

type Voice = ReturnType<typeof useVoice>;

interface AssistantController {
  voice: Voice;
  scope: Required<Pick<AssistantScope, "surface" | "suggestions" | "label">> & AssistantScope;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Open the conversation where it lives on this screen: focus the inline panel, else the drawer. */
  reveal: () => void;
  /** True while a screen renders the conversation inline, so the dock focuses it instead of a drawer. */
  hasInlineView: boolean;
  /** Increments when the inline view should take focus. */
  focusSignal: number;
  lang: VoiceLang;
  setLang: (lang: VoiceLang) => void;
}

interface Registry {
  set: (id: string, scope: StoredScope) => void;
  remove: (id: string) => void;
  addInline: (id: string) => void;
  removeInline: (id: string) => void;
}

type StoredScope = Omit<AssistantScope, "getContext"> & { getContext?: AssistantScope["getContext"] };

const ControllerContext = React.createContext<AssistantController | null>(null);
const RegistryContext = React.createContext<Registry | null>(null);

const SUGGESTIONS: Record<AssistantSurface, string[]> = {
  cab: ["Why can't I move?", "How long will this task take?", "What does the hydraulic warning mean?"],
  command: ["Catch me up on this shift", "Which machine needs attention first?", "What if we add two more trucks?"],
  owner: ["Give me the weekly fuel cost summary", "Which machine has the worst idle cost?", "When is EXC001 due for service?"],
  training: ["What should I check before starting?", "Why do I need to wear the seatbelt?", "What does the next lesson teach?"],
  ar: ["What does fault code HYD-118 mean?", "What daily care does the machine need?", "How do I shut down the machine safely?"],
};

const LABEL: Record<AssistantSurface, string> = {
  cab: "Cab",
  command: "Command centre",
  owner: "Owner",
  training: "Training instructor",
  ar: "Maintenance",
};

/** The surface a route belongs to when the screen has not said otherwise. */
export function surfaceForRoute(pathname: string): AssistantSurface {
  if (pathname.startsWith("/cab") || pathname.startsWith("/machine") || pathname.startsWith("/hmi")) return "cab";
  if (pathname.startsWith("/training")) return "training";
  if (pathname.startsWith("/owner")) return "owner";
  if (pathname.startsWith("/ar")) return "ar";
  return "command";
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [scopes, setScopes] = React.useState<[string, StoredScope][]>([]);
  const [inline, setInline] = React.useState<string[]>([]);
  const [open, setOpen] = React.useState(false);
  const [focusSignal, setFocusSignal] = React.useState(0);
  const [lang, setLang] = React.useState<VoiceLang>("auto");

  const registry = React.useMemo<Registry>(
    () => ({
      set: (id, scope) => setScopes((list) => [...list.filter(([k]) => k !== id), [id, scope]]),
      remove: (id) => setScopes((list) => list.filter(([k]) => k !== id)),
      addInline: (id) => setInline((list) => (list.includes(id) ? list : [...list, id])),
      removeInline: (id) => setInline((list) => list.filter((k) => k !== id)),
    }),
    [],
  );

  const scope = React.useMemo(() => {
    const s: StoredScope = { surface: surfaceForRoute(pathname) };
    for (const [, next] of scopes) {
      s.surface = next.surface ?? s.surface;
      s.machineId = next.machineId ?? s.machineId;
      s.operatorId = next.operatorId ?? s.operatorId;
      s.alert = next.alert ?? s.alert;
      s.suggestions = next.suggestions ?? s.suggestions;
      s.label = next.label ?? s.label;
      s.getContext = next.getContext ?? s.getContext;
    }
    const surface = s.surface ?? "command";
    const merged: AssistantController["scope"] = {
      ...s,
      surface,
      suggestions: s.suggestions ?? SUGGESTIONS[surface],
      label: s.label ?? (s.machineId && surface === "cab" ? `${LABEL.cab} · ${s.machineId}` : LABEL[surface]),
    };
    return merged;
  }, [pathname, scopes]);

  // Read at send time: the route and whatever the screen knows at that instant.
  const live = React.useRef({ pathname, getContext: scope.getContext });
  React.useLayoutEffect(() => {
    live.current = { pathname, getContext: scope.getContext };
  });
  const getContext = React.useCallback((): AssistantContext => {
    const extra = live.current.getContext?.() ?? {};
    return { route: live.current.pathname.slice(0, 120), ...extra };
  }, []);

  const voice = useVoice({
    surface: scope.surface,
    machineId: scope.machineId,
    operatorId: scope.operatorId,
    alert: scope.alert,
    lang,
    getContext,
  });

  const hasInlineView = inline.length > 0;
  const reveal = React.useCallback(() => {
    if (hasInlineView) setFocusSignal((n) => n + 1);
    else setOpen(true);
  }, [hasInlineView]);

  // A screen that shows the conversation inline replaces the drawer, never doubles it.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closing an overlay the new layout made redundant
    if (hasInlineView) setOpen(false);
  }, [hasInlineView]);

  const controller = React.useMemo<AssistantController>(
    () => ({ voice, scope, open, setOpen, reveal, hasInlineView, focusSignal, lang, setLang }),
    [voice, scope, open, reveal, hasInlineView, focusSignal, lang],
  );

  return (
    <RegistryContext.Provider value={registry}>
      <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>
    </RegistryContext.Provider>
  );
}

/** The global assistant. Throws outside the provider, so a stray second assistant cannot be created. */
export function useGlobalAssistant(): AssistantController {
  const ctx = React.useContext(ControllerContext);
  if (!ctx) throw new Error("useGlobalAssistant must be used inside <AssistantProvider>");
  return ctx;
}

/**
 * Describe the current screen to the global assistant for as long as the
 * calling component is mounted. `getContext` may change identity every render;
 * only the latest one is ever called, when a question is sent.
 */
export function useAssistantScope(scope: AssistantScope): void {
  const registry = React.useContext(RegistryContext);
  const id = React.useId();
  const getContextRef = React.useRef(scope.getContext);
  React.useLayoutEffect(() => {
    getContextRef.current = scope.getContext;
  });
  const hasContext = Boolean(scope.getContext);
  const { surface, machineId, operatorId, alert, label } = scope;
  const suggestionsKey = scope.suggestions?.join("\u0000");

  React.useEffect(() => {
    if (!registry) return;
    registry.set(id, {
      surface,
      machineId,
      operatorId,
      alert,
      label,
      suggestions: suggestionsKey ? suggestionsKey.split("\u0000") : undefined,
      getContext: hasContext ? () => getContextRef.current?.() : undefined,
    });
  }, [registry, id, surface, machineId, operatorId, alert, label, suggestionsKey, hasContext]);

  React.useEffect(() => {
    if (!registry) return;
    return () => registry.remove(id);
  }, [registry, id]);
}

/** Marks the calling component as the screen's inline view of the conversation while mounted. */
export function useInlineAssistantView(enabled: boolean): void {
  const registry = React.useContext(RegistryContext);
  const id = React.useId();
  React.useEffect(() => {
    if (!registry || !enabled) return;
    registry.addInline(id);
    return () => registry.removeInline(id);
  }, [registry, id, enabled]);
}
