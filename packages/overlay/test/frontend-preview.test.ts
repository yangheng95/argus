import { expect, test } from "bun:test";
import {
  isLoopbackHttpUrl,
  nextTabForPreviewResolution,
  structuredPreviewUrlFromBoard,
} from "../src/services/frontend-preview";

test("structured preview URL is read from delivery runtime flow only", () => {
  const result = structuredPreviewUrlFromBoard({
    candidateDelivery: {
      evidenceManifest: {
        runtimeFlows: [
          {
            id: "runtime:web:.",
            evidence: ["Rendered http://127.0.0.1:9999 but this text is not a source"],
          },
          {
            id: "runtime:web:app",
            previewUrl: "http://127.0.0.1:5173/",
          },
        ],
      },
    },
  });
  expect(result?.url).toBe("http://127.0.0.1:5173/");
  expect(result?.source).toBe("delivery");
});

test("structured preview URL rejects non-loopback URLs", () => {
  expect(isLoopbackHttpUrl("https://example.com")).toBe(false);
  expect(isLoopbackHttpUrl("http://localhost:3000")).toBe(true);
  expect(structuredPreviewUrlFromBoard({
    candidateDelivery: {
      evidenceManifest: {
        runtimeFlows: [{ previewUrl: "https://example.com" }],
      },
    },
  })).toBeNull();
});

test("auto activation only moves evaluation to preview for the current unmodified key", () => {
  expect(nextTabForPreviewResolution({
    activeTab: "evaluation",
    manualKey: "",
    requestKey: "task:1",
    resolution: { url: "http://127.0.0.1:5173/", source: "port_probe", port: 5173 },
  })).toBe("preview");
  expect(nextTabForPreviewResolution({
    activeTab: "evaluation",
    manualKey: "task:1",
    requestKey: "task:1",
    resolution: { url: "http://127.0.0.1:5173/", source: "port_probe", port: 5173 },
  })).toBe("evaluation");
  expect(nextTabForPreviewResolution({
    activeTab: "preview",
    manualKey: "",
    requestKey: "task:1",
    resolution: null,
  })).toBe("preview");
});

test("static html preview path is absent", async () => {
  const service = await Bun.file(new URL("../src/services/frontend-preview.ts", import.meta.url)).text();
  const component = await Bun.file(new URL("../src/components/FrontendPreviewPanel.tsx", import.meta.url)).text();
  expect(service).not.toContain("DOMParser");
  expect(service).not.toContain("/file/content");
  expect(component).not.toContain("srcdoc");
});
