import { describe, expect, test } from "bun:test"
import {
  buildPriorManifestIndex,
  canonicalIntegritySymptom,
  defaultIntegrityVerify,
  integrityFindingFingerprint,
} from "../../src/integrity/finding-manifest"

describe("integrity finding manifest", () => {
  test("computes a deterministic fingerprint from canonical symptom and trace anchors", () => {
    const left = {
      canonicalSymptom: "Settings values from localStorage bypass validation",
      filePaths: ["src/settings.ts"],
      requirementIDs: ["REQ-settings"],
      specIDs: ["settings-validation"],
    }
    const right = {
      canonicalSymptom: "  Settings values from localStorage bypass validation  ",
      filePaths: ["src/settings.ts"],
      requirementIDs: ["REQ-settings"],
      specIDs: ["settings-validation"],
      title: "Different round wording",
      description: "A reviewer phrased the same defect differently.",
    }

    expect(integrityFindingFingerprint(left)).toBe(integrityFindingFingerprint(right))
  })

  test("changes fingerprint when the repair surface changes", () => {
    const base = {
      canonicalSymptom: "Settings values from localStorage bypass validation",
      filePaths: ["src/settings.ts"],
    }
    expect(integrityFindingFingerprint(base)).not.toBe(
      integrityFindingFingerprint({ ...base, filePaths: ["src/profile.ts"] }),
    )
  })

  test("keeps non-ASCII symptoms distinct", () => {
    const first = integrityFindingFingerprint({ canonicalSymptom: "设置未校验", filePaths: [] })
    const second = integrityFindingFingerprint({ canonicalSymptom: "主题未持久化", filePaths: [] })
    expect(first).not.toBe(second)
  })

  test("builds prior manifest index and default verify checks", () => {
    const finding = {
      id: "F-settings",
      title: "Settings are trusted",
      description: "localStorage values are trusted.",
      repair: "Validate settings on load.",
      filePaths: ["src/settings.ts"],
      evidence: ["getSettings returns unchecked values"],
    }
    const index = buildPriorManifestIndex([{ attemptNumber: 2, findings: [finding], requiredRepairs: [] }])
    const fingerprint = integrityFindingFingerprint({
      ...finding,
      canonicalSymptom: canonicalIntegritySymptom(finding),
    })

    expect(index.get(fingerprint)).toEqual({ id: "F-settings", fingerprint, attemptNumber: 2 })
    expect(defaultIntegrityVerify(finding)).toContain("Verify required repair: Validate settings on load.")
  })

  test("prior manifest index prefers persisted fingerprints", () => {
    const index = buildPriorManifestIndex([
      {
        attemptNumber: 3,
        findings: [
          {
            id: "F-old",
            fingerprint: "if_deadbeefdeadbeef",
            title: "Old wording",
            description: "Old wording can be incomplete.",
          },
        ],
      },
    ])
    expect(index.get("if_deadbeefdeadbeef")).toEqual({
      id: "F-old",
      fingerprint: "if_deadbeefdeadbeef",
      attemptNumber: 3,
    })
  })
})
