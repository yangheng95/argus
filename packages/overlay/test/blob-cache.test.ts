import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test";

// Guards Phase 3: blob object URL lifetime is owned by the module-level
// cache in services/api, not by the rendering component. These tests pin
// the contract:
//   1. Repeated `fetchResourceAsObjectUrl` calls for the same raw URL hit
//      the cache and return the same blob URL without re-fetching — so
//      remounting the FilePart subtree never triggers a network roundtrip
//      nor a momentarily-empty <img>.
//   2. Concurrent callers for the same URL share a single in-flight fetch
//      so a burst of mounts does not amplify network traffic.
//   3. `peekResourceObjectUrl` returns the cached URL synchronously once
//      the resource has been materialised — that's what keeps Solid's
//      createResource signal non-pending on the first read after remount.

const originalFetch = globalThis.fetch;
const originalCreateObjectURL = (globalThis.URL as any).createObjectURL;
const originalRevokeObjectURL = (globalThis.URL as any).revokeObjectURL;

describe("blob URL cache", () => {
  let blobCounter = 0;
  let fetchCalls: string[];

  beforeEach(() => {
    blobCounter = 0;
    fetchCalls = [];
    (globalThis.URL as any).createObjectURL = (_blob: any) => `blob:fake-${++blobCounter}`;
    (globalThis.URL as any).revokeObjectURL = (_url: string) => {};
    globalThis.fetch = mock(async (url: string) => {
      fetchCalls.push(String(url));
      return {
        ok: true,
        status: 200,
        blob: async () => ({}),
      } as any;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis.URL as any).createObjectURL = originalCreateObjectURL;
    (globalThis.URL as any).revokeObjectURL = originalRevokeObjectURL;
  });

  test("second call with same raw URL returns the cached blob and does not refetch", async () => {
    // Deferred import so the fetch/URL stubs above are in place before the
    // module-level cache gets any live values.
    const { fetchResourceAsObjectUrl } = await import("../src/services/api");
    const url1 = await fetchResourceAsObjectUrl("/attachment/proj/cache-a.png");
    const url2 = await fetchResourceAsObjectUrl("/attachment/proj/cache-a.png");
    expect(url1).toBe(url2);
    expect(fetchCalls.length).toBe(1);
  });

  test("peekResourceObjectUrl returns the cached URL synchronously after first fetch", async () => {
    const { fetchResourceAsObjectUrl, peekResourceObjectUrl } = await import(
      "../src/services/api"
    );
    expect(peekResourceObjectUrl("/attachment/proj/cache-b.png")).toBeUndefined();
    const materialised = await fetchResourceAsObjectUrl("/attachment/proj/cache-b.png");
    expect(peekResourceObjectUrl("/attachment/proj/cache-b.png")).toBe(materialised);
  });

  test("concurrent callers for the same URL share a single in-flight fetch", async () => {
    const { fetchResourceAsObjectUrl } = await import("../src/services/api");
    const [u1, u2, u3] = await Promise.all([
      fetchResourceAsObjectUrl("/attachment/proj/cache-c.png"),
      fetchResourceAsObjectUrl("/attachment/proj/cache-c.png"),
      fetchResourceAsObjectUrl("/attachment/proj/cache-c.png"),
    ]);
    expect(u1).toBe(u2);
    expect(u2).toBe(u3);
    expect(fetchCalls.length).toBe(1);
  });
});
