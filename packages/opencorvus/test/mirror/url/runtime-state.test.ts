import { describe, expect, test } from "bun:test"

import { deriveRuntimeStateObservations, type RuntimeStateSnapshot } from "../../../src/mirror/url/runtime-state"

describe("runtime webpage state evidence", () => {
  test("identifies viewport-persistent tab evidence across scroll snapshots", () => {
    const snapshots: RuntimeStateSnapshot[] = [
      snapshot("initial", 0, 148, 148),
      snapshot("scroll-50", 640, 148, 788),
    ]

    const observations = deriveRuntimeStateObservations(snapshots)

    expect(observations).toContainEqual(expect.objectContaining({
      kind: "persistent-viewport-position",
      elementKey: "tab:overview countries ideas",
      viewportYRange: { min: 148, max: 148 },
      documentYRange: { min: 148, max: 788 },
    }))
  })
})

function snapshot(id: string, scrollY: number, viewportY: number, documentY: number): RuntimeStateSnapshot {
  return {
    id,
    label: id,
    scrollY,
    viewport: { width: 1440, height: 900 },
    documentHeight: 2000,
    screenshot: `interaction-states/${id}.png`,
    interactiveElements: [{
      index: 0,
      selector: "nav.tabs",
      tag: "nav",
      role: "tab",
      text: "Overview Countries Ideas",
      bounds: { x: 40, y: viewportY, w: 900, h: 40 },
      documentBounds: { x: 40, y: documentY, w: 900, h: 40 },
      styles: {
        display: "flex",
        position: "sticky",
        top: "64px",
        zIndex: "10",
        backgroundColor: "rgb(255, 255, 255)",
        border: "0px none rgb(0, 0, 0)",
        boxShadow: "none",
        color: "rgb(19, 23, 34)",
        fontSize: "14px",
        fontWeight: "600",
      },
      classes: ["tabs"],
    }],
    persistentElements: [],
    navigationClusters: [],
  }
}
