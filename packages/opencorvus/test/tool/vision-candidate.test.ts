import { describe, expect, test } from "bun:test"
import { applyVisionCandidates, visionCandidatePrompt } from "../../src/tool/vision-candidate"

describe("vision candidate helpers", () => {
  test("snaps coordinates and bbox when candidate_id matches", () => {
    const result = applyVisionCandidates(
      [
        {
          id: "send_button",
          description: "Send",
          type: "button",
          coordinates: { x: 214, y: 233 },
          bbox: null,
          confidence: null,
          candidate_id: "cv_002",
        },
      ],
      [
        {
          id: "cv_001",
          x: 100,
          y: 120,
          bbox: { x: 80, y: 100, width: 40, height: 30 },
          score: 0.55,
        },
        {
          id: "cv_002",
          x: 220,
          y: 240,
          bbox: { x: 180, y: 210, width: 80, height: 60 },
          score: 0.88,
        },
      ],
    )

    expect(result.used).toEqual(["cv_002"])
    expect(result.items[0]?.coordinates).toEqual({ x: 220, y: 240 })
    expect(result.items[0]?.bbox).toEqual({ x: 180, y: 210, width: 80, height: 60 })
    expect(result.items[0]?.confidence).toBe(0.88)
    expect(result.items[0]?.candidate_id).toBe("cv_002")
  })

  test("does not snap when candidate center is too far from model coordinate", () => {
    const result = applyVisionCandidates(
      [
        {
          id: "toolbar_button",
          description: "Toolbar action",
          type: "button",
          coordinates: { x: 40, y: 30 },
          bbox: { x: 20, y: 12, width: 40, height: 26 },
          confidence: 0.77,
          candidate_id: "cv_001",
        },
      ],
      [
        {
          id: "cv_001",
          x: 520,
          y: 480,
          bbox: { x: 490, y: 460, width: 60, height: 40 },
          score: 0.81,
        },
      ],
    )

    expect(result.used).toHaveLength(0)
    expect(result.items[0]?.coordinates).toEqual({ x: 40, y: 30 })
    expect(result.items[0]?.bbox).toEqual({ x: 20, y: 12, width: 40, height: 26 })
    expect(result.items[0]?.confidence).toBe(0.77)
    expect(result.items[0]?.candidate_id).toBeNull()
  })

  test("snaps to nearest candidate when candidate_id is not provided", () => {
    const result = applyVisionCandidates(
      [
        {
          id: "send_button",
          description: "Send",
          type: "button",
          coordinates: { x: 410, y: 612 },
          bbox: { x: 360, y: 590, width: 92, height: 44 },
          confidence: 0.72,
        },
      ],
      [
        {
          id: "cv_001",
          x: 414,
          y: 610,
          bbox: { x: 364, y: 588, width: 96, height: 46 },
          score: 0.84,
        },
      ],
    )

    expect(result.used).toEqual(["cv_001"])
    expect(result.items[0]?.coordinates).toEqual({ x: 414, y: 610 })
    expect(result.items[0]?.bbox).toEqual({ x: 364, y: 588, width: 96, height: 46 })
    expect(result.items[0]?.candidate_id).toBe("cv_001")
  })

  test("keeps original coordinates when candidate_id is missing or unknown", () => {
    const result = applyVisionCandidates(
      [
        {
          id: "menu_file",
          description: "File",
          type: "menu",
          coordinates: { x: 66, y: 18 },
          bbox: { x: 44, y: 8, width: 42, height: 22 },
          confidence: 0.61,
          candidate_id: "cv_777",
        },
      ],
      [],
    )

    expect(result.used).toHaveLength(0)
    expect(result.items[0]?.coordinates).toEqual({ x: 66, y: 18 })
    expect(result.items[0]?.bbox).toEqual({ x: 44, y: 8, width: 42, height: 22 })
    expect(result.items[0]?.confidence).toBe(0.61)
    expect(result.items[0]?.candidate_id).toBeNull()
  })

  test("renders candidate prompt with bounded rows", () => {
    const text = visionCandidatePrompt(
      [
        {
          id: "cv_001",
          x: 40,
          y: 50,
          bbox: { x: 20, y: 30, width: 40, height: 40 },
          score: 0.9,
        },
        {
          id: "cv_002",
          x: 90,
          y: 100,
          bbox: { x: 70, y: 80, width: 40, height: 40 },
          score: 0.8,
        },
      ],
      1,
    )

    expect(text).toContain("Tool Candidate Anchors")
    expect(text).toContain("cv_001")
    expect(text).not.toContain("cv_002")
  })
})
