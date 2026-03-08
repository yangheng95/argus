import { test, expect } from "bun:test";
import { Router } from "./router";
import type { Middleware } from "./router";

test("middleware runs before handler", async () => {
  const log: string[] = [];
  const router = new Router();
  router.use(async (req, next) => {
    log.push("before");
    const res = await next(req);
    log.push("after");
    return res;
  });
  router.get("/test", () => {
    log.push("handler");
    return new Response("OK");
  });
  await router.handle(new Request("http://localhost/test"));
  expect(log).toEqual(["before", "handler", "after"]);
});

test("middleware can modify response", async () => {
  const router = new Router();
  router.use(async (req, next) => {
    const res = await next(req);
    return new Response(await res.text(), {
      status: res.status,
      headers: { ...Object.fromEntries(res.headers), "X-Custom": "injected" },
    });
  });
  router.get("/test", () => new Response("Hello"));
  const res = await router.handle(new Request("http://localhost/test"));
  expect(res.headers.get("X-Custom")).toBe("injected");
});

test("multiple middleware chain", async () => {
  const order: number[] = [];
  const router = new Router();
  router.use(async (req, next) => {
    order.push(1);
    const res = await next(req);
    order.push(4);
    return res;
  });
  router.use(async (req, next) => {
    order.push(2);
    const res = await next(req);
    order.push(3);
    return res;
  });
  router.get("/test", () => {
    order.push(99);
    return new Response("OK");
  });
  await router.handle(new Request("http://localhost/test"));
  expect(order).toEqual([1, 2, 99, 3, 4]);
});

test("middleware can short-circuit", async () => {
  const router = new Router();
  router.use(async (_req, _next) => {
    return new Response("Blocked", { status: 403 });
  });
  router.get("/test", () => new Response("Should not reach"));
  const res = await router.handle(new Request("http://localhost/test"));
  expect(res.status).toBe(403);
  expect(await res.text()).toBe("Blocked");
});

test("existing routes still work without middleware", async () => {
  const router = new Router();
  router.get("/hello", () => new Response("Hello"));
  const res = await router.handle(new Request("http://localhost/hello"));
  expect(res.status).toBe(200);
});