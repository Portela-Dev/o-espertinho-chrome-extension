import test from "node:test";
import assert from "node:assert/strict";
import { fixture, until, auth, configuration } from "./fixtures.mjs";

test("gera lotes uma vez, persiste progresso e não expõe tokens ao popup", async () => {
  const f = fixture();
  await f.runtime.handle({ type: "START", marketplaceId: "demo" });
  await Promise.all([f.runtime.pump(), f.runtime.pump()]);
  await until(() => f.runtime.state.progress.status === "complete");
  const view = await f.runtime.handle({ type: "STATE" });
  assert.equal(view.progress.success, 3);
  assert.equal(view.progress.failed, 0);
  assert.equal(f.calls.filter((c) => c.conversion).length, 3);
  assert.equal(f.saved().progress.success, 3);
  assert.equal(JSON.stringify(view).includes("refreshToken"), false);
  assert.ok(
    f.calls.filter((c) => c.path).every((c) => c.credentials === "omit"),
  );
});
test("login abre aprovação, aguarda autorização e valida a permissão recebida", async () => {
  const f = fixture({ auth: undefined });
  await f.runtime.handle({ type: "LOGIN" });
  assert.match(f.calls.find((c) => c.tab).tab.url, /approve/);
  const challenge = f.calls.find((c) => c.path === "/auth/start").body
    .challenge;
  assert.match(challenge, /^[a-f0-9]{64}$/);
  f.controls.fetch = (path) =>
    path === "/auth/poll"
      ? new Response('{"pending":true}', { status: 202 })
      : undefined;
  await f.runtime.pump();
  assert.ok(f.runtime.state.pair);
  f.controls.fetch = null;
  f.runtime.state.pair.nextAt = 0;
  await f.runtime.pump();
  assert.equal(f.runtime.state.auth.user.id, "admin");
  await f.runtime.handle({ type: "LOGIN" });
  assert.equal(f.calls.filter((c) => c.path === "/auth/start").length, 1);
});
test("pareamento expirado, recusado e resposta sem permissão não conectam", async () => {
  const expired = fixture({ auth: undefined });
  await expired.runtime.handle({ type: "LOGIN" });
  expired.runtime.state.pair.expiresAt = 0;
  await expired.runtime.pump();
  assert.equal(expired.runtime.state.pair, undefined);
  const denied = fixture({ auth: undefined });
  await denied.runtime.handle({ type: "LOGIN" });
  denied.controls.fetch = (path) =>
    path === "/auth/poll"
      ? Response.json({ error: "negado" }, { status: 403 })
      : undefined;
  await denied.runtime.pump();
  assert.equal(denied.runtime.state.auth, undefined);
  assert.equal(denied.runtime.state.pair, undefined);
  const missing = fixture({ auth: undefined });
  await missing.runtime.handle({ type: "LOGIN" });
  missing.controls.fetch = (path) =>
    path === "/auth/poll"
      ? Response.json({ ...auth, user: { ...auth.user, permissions: [] } })
      : undefined;
  await missing.runtime.pump();
  assert.equal(missing.runtime.state.auth, undefined);
  assert.match(missing.runtime.state.progress.message, /permissão/);
});
test("configuração de backend exige logout e rejeita protocolos inseguros", async () => {
  const f = fixture();
  await assert.rejects(
    f.runtime.handle({ type: "BACKEND", url: "https://api.test" }),
    /Saia/,
  );
  await f.runtime.handle({ type: "LOGOUT" });
  assert.equal(f.runtime.state.auth, undefined);
  const view = await f.runtime.handle({
    type: "BACKEND",
    url: "https://api.test",
  });
  assert.equal(view.backendUrl, "https://api.test");
  await assert.rejects(
    f.runtime.handle({ type: "BACKEND", url: "http://evil.test" }),
  );
  await assert.rejects(f.runtime.handle({ type: "UNKNOWN" }), /desconhecida/);
});
test("token expirado é renovado uma vez e permissão revogada remove o login", async () => {
  const f = fixture();
  let rejected = false;
  f.controls.fetch = (path, body, options) => {
    if (path === "/config" && !rejected) {
      rejected = true;
      return Response.json({ error: "expired" }, { status: 401 });
    }
    return undefined;
  };
  await f.runtime.handle({ type: "REFRESH" });
  assert.equal(f.runtime.state.auth.token, "renewed");
  assert.equal(f.calls.filter((c) => c.path === "/auth/refresh").length, 1);
  f.controls.fetch = () =>
    Response.json({ error: "Sem permissão" }, { status: 403 });
  await assert.rejects(f.runtime.handle({ type: "REFRESH" }), /Sem permissão/);
  assert.equal(f.runtime.state.auth, undefined);
});
test("refresh recusado, falha de JSON e erro de rede não perdem o lote", async () => {
  const f = fixture();
  f.controls.fetch = () => Response.json({ error: "expired" }, { status: 401 });
  await assert.rejects(
    f.runtime.handle({ type: "REFRESH" }),
    /Sessão expirada/,
  );
  assert.equal(f.runtime.state.auth, undefined);
  const malformed = fixture();
  malformed.controls.fetch = () => new Response("<html>");
  await assert.rejects(malformed.runtime.handle({ type: "REFRESH" }), /JSON/);
  const outage = fixture();
  outage.controls.fetch = (path) => {
    if (path === "/batches/results") {
      throw new Error("offline");
    }
  };
  await outage.runtime.handle({ type: "START", marketplaceId: "demo" });
  await until(() => outage.runtime.state.progress.status === "paused");
  assert.equal(outage.runtime.state.batch.results.length, 2);
  outage.controls.fetch = null;
  await outage.runtime.handle({ type: "START", marketplaceId: "demo" });
  await until(() => outage.runtime.state.progress.status === "complete");
  assert.equal(outage.runtime.state.progress.success, 3);
  assert.equal(outage.calls.filter((c) => c.conversion).length, 3);
});
test("sessão do marketplace ausente pausa; retomar reutiliza o lote", async () => {
  const f = fixture();
  f.controls.execute = async () => [
    { result: { needsLogin: true, error: "Login necessário" } },
  ];
  await f.runtime.handle({ type: "START", marketplaceId: "demo" });
  await until(() => f.runtime.state.progress.status === "paused");
  assert.equal(f.runtime.state.batch.results.length, 0);
  assert.ok(f.calls.some((c) => c.activated));
  f.controls.execute = null;
  await f.runtime.handle({ type: "START", marketplaceId: "demo" });
  await until(() => f.runtime.state.progress.status === "complete");
  assert.equal(f.runtime.state.progress.success, 3);
});
test("pausa durante conversão conserva resultado e reinício do worker retoma", async () => {
  const f = fixture();
  let release;
  f.controls.execute = () =>
    new Promise((resolve) => {
      release = () =>
        resolve([{ result: { affiliateUrl: "https://shop.test/a" } }]);
    });
  await f.runtime.handle({ type: "START", marketplaceId: "demo" });
  await until(() => !!release);
  await f.runtime.handle({ type: "PAUSE" });
  release();
  await until(() => f.saved().batch.results.length === 1);
  const restored = fixture(f.saved());
  await restored.runtime.handle({ type: "START", marketplaceId: "demo" });
  await until(() => restored.runtime.state.progress.status === "complete");
  assert.equal(restored.runtime.state.progress.success, 3);
});
test("reservas de outra sessão, falta de permissão de domínio e operações inválidas ficam visíveis", async () => {
  const busy = fixture();
  busy.controls.fetch = (path) =>
    path === "/batches/claim"
      ? Response.json({ items: [], remaining: 2 })
      : undefined;
  await busy.runtime.handle({ type: "START", marketplaceId: "demo" });
  await until(() => busy.runtime.state.progress.status === "paused");
  assert.match(busy.runtime.state.progress.message, /reservados/);
  const denied = fixture();
  denied.controls.permission = false;
  await assert.rejects(
    denied.runtime.handle({ type: "START", marketplaceId: "demo" }),
    /Autorize/,
  );
  await assert.rejects(
    denied.runtime.handle({ type: "OPEN", marketplaceId: "missing" }),
    /marketplace/,
  );
  await denied.runtime.handle({ type: "OPEN", marketplaceId: "demo" });
  assert.ok(denied.calls.some((c) => c.tab?.url === "https://shop.test/login"));
  await denied.runtime.handle({ type: "RESET" });
  assert.equal(denied.runtime.state.progress.status, "idle");
  denied.runtime.state.progress.status = "running";
  await assert.rejects(denied.runtime.handle({ type: "RESET" }), /Pause/);
});
test("falha de conversão é enviada individualmente e reserva expirada é descartada", async () => {
  const f = fixture({
    marketplaceId: "demo",
    batch: { leaseId: "old", leaseExpiresAt: 0, items: [], results: [] },
  });
  f.controls.execute = async () => [{ result: { error: "não convertido" } }];
  await f.runtime.handle({ type: "START", marketplaceId: "demo" });
  await until(() => f.runtime.state.progress.status === "complete");
  assert.equal(f.runtime.state.progress.failed, 3);
  const redirected = fixture();
  redirected.controls.redirect = true;
  await redirected.runtime.handle({ type: "START", marketplaceId: "demo" });
  await until(() => redirected.runtime.state.progress.status === "paused");
  assert.match(redirected.runtime.state.progress.message, /origem/);
});
