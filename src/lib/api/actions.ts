/**
 * Confirm-gated agent actions, called directly from a UI surface.
 *
 * The X-ray component popover raises work orders and incidents through the
 * backend's own tools (`create_work_order` / `create_incident`): `prepare`
 * runs the tool's prepare step and returns a pending action with its preview,
 * `confirm` executes it — the same prepare -> confirm -> execute path the
 * assistant uses, and the same drafting pipeline (facts -> structured LLM
 * draft -> grounding check -> template fallback) behind it.
 *
 * There is deliberately no offline fallback: with no backend, the call fails
 * and the UI says so. A report that was never filed must not look filed.
 */

import { apiBase } from "@web/lib/stream";

export type ActionTool = "create_work_order" | "create_incident";

export interface SourceView {
  kind: "xray";
  machine_id: string;
  shown_on: string | null;
  component: string | null;
}

export interface PendingAction {
  action_id: string;
  tool: ActionTool;
  summary: string;
  status: string;
  expires_at: string;
  preview: Record<string, unknown>;
  args: Record<string, unknown>;
}

export interface DraftedRecord {
  id: string;
  kind: "work_order" | "incident";
  status: string;
  machine_id: string;
  component?: string | null;
  source_view?: SourceView | null;
  draft?: Record<string, unknown>;
  draft_source?: string;
  [key: string]: unknown;
}

export class ActionUnavailable extends Error {}

async function post<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ActionUnavailable(`Copilot backend unreachable at ${apiBase()}`);
  }
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const detail = (json as { detail?: unknown } | null)?.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : (detail as { error?: string } | undefined)?.error ?? `request failed (${res.status})`;
    throw new Error(msg);
  }
  return json as T;
}

/** Runs the tool's prepare step. Nothing is filed until `confirmAction`. */
export function prepareAction(tool: ActionTool, args: Record<string, unknown>): Promise<PendingAction> {
  return post<PendingAction>("/api/actions/prepare", { tool, args, surface: "command" });
}

/** Executes a prepared action and returns the drafted record it produced. */
export async function confirmAction(actionId: string): Promise<DraftedRecord> {
  const done = await post<{ status: string; result?: { ok: boolean; data?: { record?: DraftedRecord } } }>(
    `/api/actions/${encodeURIComponent(actionId)}/confirm`,
  );
  const record = done.result?.data?.record;
  if (done.status !== "confirmed" || !record) throw new Error(`action ${done.status}`);
  return record;
}

export function cancelAction(actionId: string): Promise<unknown> {
  return post(`/api/actions/${encodeURIComponent(actionId)}/cancel`);
}
