import { test, expect } from "bun:test";
import { parseQuery, stringifyQuery } from "./query";

// parseQuery tests
test("parse basic query", () => {
  expect(parseQuery("a=1&b=2")).toEqual({ a: "1", b: "2" });
});

test("parse with leading ?", () => {
  expect(parseQuery("?a=1&b=2")).toEqual({ a: "1", b: "2" });
});

test("parse URI-encoded values", () => {
  expect(parseQuery("name=hello%20world&path=%2Ffoo%2Fbar")).toEqual({
    name: "hello world",
    path: "/foo/bar",
  });
});

test("parse array values", () => {
  expect(parseQuery("a=1&a=2&a=3")).toEqual({ a: ["1", "2", "3"] });
});

test("parse empty value", () => {
  expect(parseQuery("key=")).toEqual({ key: "" });
});

test("parse no-value key", () => {
  expect(parseQuery("key")).toEqual({ key: null });
});

test("parse ignores empty segments", () => {
  expect(parseQuery("a=1&&b=2")).toEqual({ a: "1", b: "2" });
});

test("parse empty input", () => {
  expect(parseQuery("")).toEqual({});
  expect(parseQuery(null)).toEqual({});
  expect(parseQuery(undefined)).toEqual({});
});

// stringifyQuery tests
test("stringify basic", () => {
  expect(stringifyQuery({ a: "1", b: "2" })).toBe("a=1&b=2");
});

test("stringify encodes special chars", () => {
  const result = stringifyQuery({ name: "hello world" });
  expect(result).toBe("name=hello%20world");
});

test("stringify array values", () => {
  expect(stringifyQuery({ a: ["1", "2"] })).toBe("a=1&a=2");
});

test("stringify null value", () => {
  expect(stringifyQuery({ key: null })).toBe("key");
});

test("stringify empty value", () => {
  expect(stringifyQuery({ key: "" })).toBe("key=");
});

test("stringify skips undefined", () => {
  expect(stringifyQuery({ a: "1", b: undefined, c: "3" })).toBe("a=1&c=3");
});