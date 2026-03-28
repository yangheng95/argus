import { describe, expect, test } from "bun:test";
import { TypedEventEmitter } from "./emitter";

// Define event types for testing
interface TestEvents {
  greeting: [string];
  add: [number, number];
  click: [];
}

describe("TypedEventEmitter", () => {
  test("basic registration and trigger", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    let received: string | undefined;

    emitter.on("greeting", (msg) => {
      received = msg;
    });

    const result = emitter.emit("greeting", "hello");

    expect(received).toBe("hello");
    expect(result).toBe(true);
  });

  test("multiple listeners fire in registration order", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const order: string[] = [];

    emitter
      .on("greeting", () => order.push("first"))
      .on("greeting", () => order.push("second"))
      .on("greeting", () => order.push("third"));

    emitter.emit("greeting", "test");

    expect(order).toEqual(["first", "second", "third"]);
  });

  test("once handler auto-removes after first trigger", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    let callCount = 0;

    emitter.once("greeting", () => {
      callCount++;
    });

    expect(emitter.listenerCount("greeting")).toBe(1);

    emitter.emit("greeting", "first");
    expect(callCount).toBe(1);
    expect(emitter.listenerCount("greeting")).toBe(0);

    emitter.emit("greeting", "second");
    expect(callCount).toBe(1); // Should not increment again
  });

  test("off removes only the specified handler", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const calls: string[] = [];

    const handler1 = () => calls.push("handler1");
    const handler2 = () => calls.push("handler2");
    const handler3 = () => calls.push("handler3");

    emitter
      .on("greeting", handler1)
      .on("greeting", handler2)
      .on("greeting", handler3);

    expect(emitter.listenerCount("greeting")).toBe(3);

    emitter.off("greeting", handler2);
    expect(emitter.listenerCount("greeting")).toBe(2);

    emitter.emit("greeting", "test");
    expect(calls).toEqual(["handler1", "handler3"]);
  });

  test("listenerCount returns accurate count", () => {
    const emitter = new TypedEventEmitter<TestEvents>();

    expect(emitter.listenerCount("greeting")).toBe(0);

    const handler1 = () => {};
    const handler2 = () => {};

    emitter.on("greeting", handler1);
    expect(emitter.listenerCount("greeting")).toBe(1);

    emitter.on("greeting", handler2);
    expect(emitter.listenerCount("greeting")).toBe(2);

    emitter.off("greeting", handler1);
    expect(emitter.listenerCount("greeting")).toBe(1);

    emitter.off("greeting", handler2);
    expect(emitter.listenerCount("greeting")).toBe(0);
  });

  test("emit returns false when no listeners and does not error", () => {
    const emitter = new TypedEventEmitter<TestEvents>();

    const result = emitter.emit("greeting", "test");
    expect(result).toBe(false);

    // Should not throw
    expect(() => emitter.emit("click")).not.toThrow();
  });

  test("method chaining works (on/off/once return this)", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = () => {};

    // Test chaining on
    const result1 = emitter.on("greeting", handler);
    expect(result1).toBe(emitter);

    // Test chaining off
    const result2 = emitter.off("greeting", handler);
    expect(result2).toBe(emitter);

    // Test chaining once
    const result3 = emitter.once("greeting", handler);
    expect(result3).toBe(emitter);

    // Test full chain
    const result4 = emitter
      .on("greeting", handler)
      .on("add", (a, b) => {})
      .once("click", () => {})
      .off("greeting", handler);
    expect(result4).toBe(emitter);
  });

  test("emit with multiple arguments", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    let sum = 0;

    emitter.on("add", (a, b) => {
      sum = a + b;
    });

    emitter.emit("add", 5, 3);
    expect(sum).toBe(8);
  });

  test("emit with no arguments", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    let clicked = false;

    emitter.on("click", () => {
      clicked = true;
    });

    emitter.emit("click");
    expect(clicked).toBe(true);
  });

  test("removing non-existent handler does not error", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = () => {};

    // Should not throw when removing handler that was never added
    expect(() => emitter.off("greeting", handler)).not.toThrow();
    expect(emitter.listenerCount("greeting")).toBe(0);
  });

  test("multiple once handlers", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    let count1 = 0;
    let count2 = 0;

    emitter
      .once("greeting", () => count1++)
      .once("greeting", () => count2++);

    expect(emitter.listenerCount("greeting")).toBe(2);

    emitter.emit("greeting", "test");
    expect(count1).toBe(1);
    expect(count2).toBe(1);
    expect(emitter.listenerCount("greeting")).toBe(0);

    emitter.emit("greeting", "test2");
    expect(count1).toBe(1); // Should not increment
    expect(count2).toBe(1); // Should not increment
  });
});
