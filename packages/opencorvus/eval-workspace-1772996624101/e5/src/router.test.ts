import { test, expect } from "bun:test";
import { Router } from "./router";

test("basic GET route", async () => {
  const router = new Router();
  router.get("/hello", () => new Response("Hello"));
  const res = await router.handle(new Request("http://localhost/hello"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

test("404 for unknown route", async () => {
  const router = new Router();
  const res = await router.handle(new Request("http://localhost/missing"));
  expect(res.status).toBe(404);
});

test("POST route", async () => {
  const router = new Router();
  router.post("/data", () => new Response("OK"));
  const res = await router.handle(new Request("http://localhost/data", { method: "POST" }));
  expect(await res.text()).toBe("OK");
});