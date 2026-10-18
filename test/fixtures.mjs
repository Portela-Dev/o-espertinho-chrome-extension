import assert from "node:assert/strict";
import { ExtensionRuntime } from "../dist/runtime.js";
export const account = {
  id: "admin",
  email: "admin@example.test",
  name: "Admin",
  permissions: ["affiliate_links"],
};
export const auth = {
  token: "access",
  refreshToken: "refresh",
  expiresAt: Date.now() + 900000,
  user: account,
};
export const recipe = {
  id: "demo",
  name: "Demo",
  loginUrl: "https://shop.test/login",
  allowedOrigins: ["https://shop.test"],
  affiliateOrigins: ["https://shop.test"],
  batchSize: 2,
  intervalMs: 100,
  steps: [
    {
      type: "request",
      url: "https://shop.test/convert",
      method: "POST",
      responsePath: "link",
    },
  ],
};
export const configuration = { version: 1, mock: true, marketplaces: [recipe] };
export function fixture(initial = {}) {
  let saved = {
    backendUrl: "http://localhost:3000",
    auth: structuredClone(auth),
    progress: { status: "idle", success: 0, failed: 0, total: 0, message: "" },
    ...structuredClone(initial),
  };
  const calls = [],
    listeners = {},
    items = Array.from({ length: 3 }, (_, i) => ({
      id: String(i + 1),
      title: "Product " + (i + 1),
      originalUrl: "https://shop.test/product/" + (i + 1),
      state: "pending",
    }));
  const controls = {
    fetch: null,
    execute: null,
    permission: true,
    tabClosed: false,
    redirect: false,
  };
  const browser = {
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async () => ({ state: structuredClone(saved) }),
        set: async ({ state }) => {
          saved = structuredClone(state);
        },
      },
    },
    alarms: {
      create: async () => {},
      onAlarm: {
        addListener: (fn) => {
          listeners.alarm = fn;
        },
      },
    },
    runtime: {
      id: "a".repeat(32),
      getManifest: () => ({ version: "0.2.0" }),
      onMessage: {
        addListener: (fn) => {
          listeners.message = fn;
        },
      },
      onStartup: {
        addListener: (fn) => {
          listeners.startup = fn;
        },
      },
      onInstalled: {
        addListener: (fn) => {
          listeners.installed = fn;
        },
      },
    },
    permissions: { contains: async () => controls.permission },
    tabs: {
      get: async () => {
        if (controls.tabClosed) {
          throw Error("closed");
        }
        return {
          id: 1,
          status: "complete",
          url: controls.redirect
            ? "https://foreign.test/"
            : "https://shop.test/login",
        };
      },
      query: async () => [],
      create: async (value) => {
        calls.push({ tab: value });
        return { id: 1, ...value };
      },
      update: async (id, value) => {
        calls.push({ activated: id, ...value });
      },
    },
    scripting: {
      executeScript: async (options) => {
        calls.push({ conversion: options.args[1].id });
        if (controls.execute) {
          return controls.execute(options);
        }
        return [
          {
            result: {
              affiliateUrl: options.args[1].originalUrl + "?affiliate=demo",
            },
          },
        ];
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname.replace("/api/extension", "");
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({
      path,
      body,
      headers: options.headers,
      credentials: options.credentials,
    });
    if (controls.fetch) {
      const response = await controls.fetch(path, body, options);
      if (response) {
        return response;
      }
    }
    switch (path) {
      case "/config":
        return Response.json(configuration);
      case "/queue":
        return Response.json({ items });
      case "/batches/claim": {
        const batch = items
          .filter((item) => item.state === "pending")
          .slice(0, 2);
        for (const item of batch) {
          item.state = "leased";
        }
        return Response.json({
          leaseId: "lease",
          leaseExpiresAt: Date.now() + 120000,
          items: batch,
          remaining: batch.length,
        });
      }
      case "/batches/results":
        for (const result of body.results) {
          Object.assign(
            items.find((item) => item.id === result.id),
            result,
            { state: result.error ? "failed" : "done" },
          );
        }
        return Response.json({ accepted: body.results.length });
      case "/auth/refresh":
        return Response.json({
          ...auth,
          token: "renewed",
          refreshToken: "rotated",
        });
      case "/auth/start":
        return Response.json({
          deviceCode: "device",
          verificationUrl: "http://localhost:3000/approve",
          expiresAt: Date.now() + 300000,
        });
      case "/auth/poll":
        return Response.json(auth);
      case "/auth/logout":
        return Response.json({ ok: true });
      case "/queue/reset":
        for (const item of items) {
          item.state = "pending";
        }
        return Response.json({ ok: true });
      default:
        throw new Error("Unexpected endpoint " + path);
    }
  };
  const runtime = new ExtensionRuntime(browser);
  return {
    runtime,
    browser,
    calls,
    items,
    controls,
    listeners,
    saved: () => saved,
  };
}
export async function until(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Estado esperado não foi atingido.");
}
