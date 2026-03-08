import { test, expect } from "bun:test";
import { createUser, updateUser } from "./user";

test("createUser valid", () => {
  const user = createUser({ name: "Alice", email: "alice@test.com", age: 30 });
  expect(user).toEqual({ name: "Alice", email: "alice@test.com", age: 30 });
});

test("createUser invalid name", () => {
  expect(() => createUser({ name: "", email: "a@b.com", age: 1 })).toThrow("Name");
});

test("createUser invalid email", () => {
  expect(() => createUser({ name: "X", email: "bad", age: 1 })).toThrow("Email");
});

test("createUser invalid age", () => {
  expect(() => createUser({ name: "X", email: "a@b.com", age: -1 })).toThrow("Age");
});

test("updateUser partial", () => {
  const existing = { name: "Alice", email: "alice@test.com", age: 30 };
  const updated = updateUser(existing, { age: 31 });
  expect(updated).toEqual({ name: "Alice", email: "alice@test.com", age: 31 });
});

test("updateUser invalid", () => {
  const existing = { name: "Alice", email: "alice@test.com", age: 30 };
  expect(() => updateUser(existing, { email: "bad" })).toThrow("Email");
});