import { apiJson, getServerUrl } from "./api";

export type RightPanelTab = "workflow" | "inspector" | "preview";

export type FrontendPreviewSource = "delivery" | "port_probe";

export type FrontendPreviewResolution = {
  url: string | null;
  source: FrontendPreviewSource | null;
  port: number | null;
  checkedPorts?: number[];
  reason?: string;
};

export type PreviewAutoActivationInput = {
  activeTab: RightPanelTab;
  manualKey: string;
  requestKey: string;
  resolution: FrontendPreviewResolution | null;
};

export function previewRequestKey(taskID: string | undefined, snapshotVersion: string | undefined): string {
  return `${taskID || "no-task"}:${snapshotVersion || "no-snapshot"}`;
}

export function nextTabForPreviewResolution(input: PreviewAutoActivationInput): RightPanelTab {
  if (input.manualKey === input.requestKey) return input.activeTab;
  if (input.activeTab === "inspector" && input.resolution?.url) return "preview";
  return input.activeTab;
}

export async function resolveFrontendPreviewFromBoard(board: unknown): Promise<FrontendPreviewResolution> {
  const structured = structuredPreviewUrlFromBoard(board);
  if (structured) return structured;
  const response = await apiJson("preview/frontend") as FrontendPreviewResolution;
  if (!response?.url) return {
    url: null,
    source: null,
    port: null,
    checkedPorts: Array.isArray(response?.checkedPorts) ? response.checkedPorts : [],
    reason: typeof response?.reason === "string" ? response.reason : "not_detected",
  };
  return {
    url: response.url,
    source: response.source === "port_probe" ? "port_probe" : null,
    port: typeof response.port === "number" ? response.port : null,
    checkedPorts: Array.isArray(response.checkedPorts) ? response.checkedPorts : [],
    reason: typeof response.reason === "string" ? response.reason : undefined,
  };
}

export function structuredPreviewUrlFromBoard(board: unknown): FrontendPreviewResolution | null {
  const delivery = deliveryFromBoard(board);
  const flows = delivery?.evidenceManifest?.runtimeFlows;
  if (!Array.isArray(flows)) return null;
  for (const flow of flows) {
    const url = typeof flow?.previewUrl === "string" ? flow.previewUrl : "";
    if (!isLoopbackHttpUrl(url) || sameOriginAsOverlay(url)) continue;
    return {
      url,
      source: "delivery",
      port: portFromUrl(url),
    };
  }
  return null;
}

export function isLoopbackHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  } catch {
    return false;
  }
}

export function sameOriginAsOverlay(raw: string): boolean {
  try {
    const target = new URL(raw);
    const server = new URL(getServerUrl());
    const page = typeof window !== "undefined" ? window.location.origin : "";
    return target.origin === server.origin || (!!page && target.origin === page);
  } catch {
    return true;
  }
}

function deliveryFromBoard(board: unknown): any {
  const item = board as any;
  return item?.acceptedDelivery || item?.delivery || item?.candidateDelivery || null;
}

function portFromUrl(raw: string): number | null {
  try {
    const port = Number(new URL(raw).port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}
