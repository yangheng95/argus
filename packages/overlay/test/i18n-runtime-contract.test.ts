import { afterEach, beforeEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  MissingI18nKeyError,
  UnsupportedLocaleError,
  sanitizeLocale,
  setLocale,
  setLocaleData,
  t,
  tArray,
  tc,
} from "../src/utils/i18n"

const ROOT = path.resolve(import.meta.dir, "..")
const REAL_EN_US = JSON.parse(readFileSync(path.join(ROOT, "src/i18n/en-US.json"), "utf8")) as Record<string, unknown>
const REAL_ZH_CN = JSON.parse(readFileSync(path.join(ROOT, "src/i18n/zh-CN.json"), "utf8")) as Record<string, unknown>

const EN_US_FIXTURE = {
  "strict.only_en": "English only",
  "strict.title": "Title {{name}}",
  "strict.items": ["one", "two"],
  "strict.count": { one: "{{count}} item", other: "{{count}} items" },
  "strict.not_array": "not an array",
  "strict.not_plural": "not plural",
}

const ZH_CN_FIXTURE = {
  "strict.title": "标题 {{name}}",
  "strict.items": ["一", "二"],
  "strict.count": { one: "{{count}} 项", other: "{{count}} 项" },
  "strict.not_array": "不是数组",
  "strict.not_plural": "不是复数",
}

beforeEach(async () => {
  setLocaleData("en-US", EN_US_FIXTURE)
  setLocaleData("zh-CN", ZH_CN_FIXTURE)
  await setLocale("zh-CN")
})

afterEach(async () => {
  setLocaleData("en-US", REAL_EN_US)
  setLocaleData("zh-CN", REAL_ZH_CN)
  await setLocale("en-US")
})

test("t reads only the active locale and never falls back to en-US or the key", () => {
  expect(t("strict.title", { name: "OpenCorvus" })).toBe("标题 OpenCorvus")
  expect(() => t("strict.only_en")).toThrow(MissingI18nKeyError)
  expect(() => t("strict.missing")).toThrow("Missing i18n string for locale zh-CN: strict.missing")
})

test("tArray and tc reject wrong locale value shapes instead of returning empty or string fallbacks", () => {
  expect(tArray("strict.items")).toEqual(["一", "二"])
  expect(tc("strict.count", 2)).toBe("2 项")
  expect(() => tArray("strict.not_array")).toThrow(MissingI18nKeyError)
  expect(() => tc("strict.not_plural", 2)).toThrow(MissingI18nKeyError)
})

test("unsupported locale input is rejected instead of silently becoming en-US", async () => {
  expect(sanitizeLocale("zh-Hans-CN")).toBe("zh-CN")
  expect(sanitizeLocale("en-GB")).toBe("en-US")
  expect(() => sanitizeLocale("fr-FR")).toThrow(UnsupportedLocaleError)
  await expect(setLocale("fr-FR")).rejects.toThrow(UnsupportedLocaleError)
  expect(() => setLocaleData("fr-FR", {})).toThrow(UnsupportedLocaleError)
})
