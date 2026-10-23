import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { executeRecipe } from "../dist/executor.js";
import { recipe as baseRecipe } from "./fixtures.mjs";
const item = {
  id: "1",
  title: "Teste",
  originalUrl: "https://shop.test/product/1",
};

test('JSON GraphQL mantém objetos, listas e tipos; resposta exige sucesso configurado antes de aceitar URL',async()=>{
 const {recipe,sent}=setup();const request=recipe.steps[1];
 request.body={query:'query ($links: [Link!]) { links { shortLink failCode } }',variables:{links:[{url:'{{originalUrl}}',params:{campaign:'test'}}],enabled:true,count:1,optional:null}};
 request.responsePath='data.links.0.shortLink';request.responseChecks=[{path:'data.links.0.failCode',equals:0}];
 globalThis.fetch=async(url,options)=>{sent.push({url,options});return Response.json({data:{links:[{shortLink:'https://shop.test/affiliate/1',failCode:0}]}});};
 assert.equal((await executeRecipe(recipe,item)).affiliateUrl,'https://shop.test/affiliate/1');
 assert.deepEqual(JSON.parse(sent[0].options.body).variables,{links:[{url:item.originalUrl,params:{campaign:'test'}}],enabled:true,count:1,optional:null});
 for(const data of [{data:{links:[{shortLink:'https://shop.test/affiliate/1',failCode:9}]}},{errors:[{message:'PRIVATE_ERROR'}]},{data:{links:[]}}]){globalThis.fetch=async()=>Response.json(data);const result=await executeRecipe(recipe,item);assert.equal(result.affiliateUrl,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ERROR/);}
 request.bodyEncoding='form';assert.equal((await executeRecipe(recipe,item)).affiliateUrl,undefined);
});
function setup() {
  const window = new Window({ url: "https://shop.test/login" });
  for (const key of [
    "document",
    "location",
    "localStorage",
    "sessionStorage",
    "Event",
  ]) {
    globalThis[key] = window[key];
  }
  document.body.innerHTML =
    '<meta name="csrf" content="private-session-value"><input id="url"><button id="convert">Converter</button><span id="token">text-token</span>';
  const sent = [];
  globalThis.fetch = async (url, options) => {
    sent.push({ url, options });
    return Response.json({ data: { link: "https://shop.test/affiliate/1" } });
  };
  const recipe = structuredClone(baseRecipe);
  recipe.steps = [
    {
      type: "extract",
      source: "dom",
      name: "csrf",
      selector: "meta",
      attribute: "content",
    },
    {
      type: "request",
      url: "https://shop.test/convert",
      method: "POST",
      headers: { "X-CSRF": "{{csrf}}" },
      body: { url: "{{originalUrl}}" },
      responsePath: "data.link",
    },
  ];
  return { recipe, sent, window };
}
test("receita usa sessão somente na origem e devolve apenas o link", async () => {
  const { recipe, sent } = setup();
  const result = await executeRecipe(recipe, item);
  assert.equal(result.affiliateUrl, "https://shop.test/affiliate/1");
  assert.equal(sent[0].options.headers["X-CSRF"], "private-session-value");
  assert.equal(sent[0].options.credentials, "include");
  assert.equal(sent[0].options.redirect, "error");
  assert.equal(JSON.stringify(result).includes("private-session-value"), false);
});

test('token configurado no DOM é relido a cada conversão e ausência impede a chamada', async () => {
  const {recipe,sent}=setup();
  recipe.steps[0].selector='meta[name="csrf-token"]';
  const meta=document.querySelector('meta');meta.name='csrf-token';
  assert.ok((await executeRecipe(recipe,item)).affiliateUrl);
  meta.content='renewed-session-value';
  assert.ok((await executeRecipe(recipe,item)).affiliateUrl);
  assert.equal(sent[1].options.headers['X-CSRF'],'renewed-session-value');
  meta.remove();
  const result=await executeRecipe(recipe,item);
  assert.equal(result.needsLogin,true);assert.equal(sent.length,2);
  assert.doesNotMatch(JSON.stringify(result),/private-session-value|renewed-session-value/);
});

test('request header variables stay local to the same-origin conversion and only the link is returned',async()=>{const {recipe,sent}=setup();recipe.steps[0]={type:'extract',source:'requestHeader',name:'csrf',key:'x-csrf-token',sourceUrl:'https://shop.test/convert'};const result=await executeRecipe(recipe,item,{csrf:'PRIVATE-HEADER'});assert.equal(sent[0].options.headers['X-CSRF'],'PRIVATE-HEADER');assert.ok(result.affiliateUrl);assert.equal(JSON.stringify(result).includes('PRIVATE-HEADER'),false);});
test("campos e botões usam os valores configurados e cookies/storage permanecem locais", async () => {
  const { recipe, sent } = setup();
  localStorage.setItem("local", "local-token");
  sessionStorage.setItem("session", "session-token");
  document.cookie = "csrf=cookie-token";
  let clicked = false;
  document.querySelector("#convert").addEventListener("click", () => {
    clicked = true;
  });
  recipe.steps.unshift(
    { type: "extract", source: "localStorage", key: "local", name: "local" },
    {
      type: "extract",
      source: "sessionStorage",
      key: "session",
      name: "session",
    },
    { type: "extract", source: "cookie", key: "csrf", name: "cookie" },
    { type: "extract", source: "dom", selector: "#token", name: "text" },
    { type: "fill", selector: "#url", value: "{{originalUrl}}" },
    { type: "click", selector: "#convert" },
  );
  recipe.steps.at(-1).headers = {
    Local: "{{local}}",
    Session: "{{session}}",
    "X-Cookie-Value": "{{cookie}}",
    Text: "{{text}}",
  };
  recipe.steps.at(-1).bodyEncoding = "form";
  const result = await executeRecipe(recipe, item);
  assert.ok(result.affiliateUrl);
  assert.equal(document.querySelector("#url").value, item.originalUrl);
  assert.equal(clicked, true);
  assert.equal(sent[0].options.headers["X-Cookie-Value"], "cookie-token");
  assert.ok(sent[0].options.body instanceof URLSearchParams);
});
test("recusa origem externa, credenciais na URL, headers reservados e saída não autorizada", async () => {
  const cases = [
    (recipe) => {
      recipe.steps[1].url = "https://evil.test/convert";
    },
    (recipe) => {
      recipe.steps[1].url = "https://user:secret@shop.test/convert";
    },
    (recipe) => {
      recipe.steps[1].headers = { Cookie: "secret" };
    },
    (recipe) => {
      recipe.affiliateOrigins = ["https://other.test"];
    },
  ];
  for (const change of cases) {
    const { recipe } = setup();
    change(recipe);
    const result = await executeRecipe(recipe, item);
    assert.ok(result.error);
    assert.equal(result.affiliateUrl, undefined);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
  const { recipe } = setup();
  assert.ok(
    (
      await executeRecipe(recipe, {
        ...item,
        originalUrl: "https://other.test/1",
      })
    ).error,
  );
});
test("sessão ausente e HTTP 401, 403 e 429 têm motivos distintos sem expor a resposta", async () => {
  const { recipe } = setup();
  document.querySelector("meta").remove();
  assert.equal((await executeRecipe(recipe, item)).needsLogin, true);
  for (const status of [401, 403, 429, 500]) {
    const { recipe } = setup();
    globalThis.fetch = async () => new Response("PRIVATE_RESPONSE", { status });
    const result = await executeRecipe(recipe, item);
    assert.equal(!!result.needsLogin, status === 401);
    assert.equal(result.blocked, {401:'login',403:'access_denied',429:'rate_limit'}[status]);
    assert.equal(result.httpStatus, status === 500 ? undefined : status);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_RESPONSE/);
    assert.ok(result.error);
  }
});
test("valida resposta JSON, tamanho, caminho e tipo do link sem expor dados internos", async () => {
  const bodies = [
    "<html>",
    JSON.stringify({ data: { link: 12 } }),
    JSON.stringify({ data: { link: "javascript:private-session-value" } }),
    JSON.stringify({ other: "private-session-value" }),
    "x".repeat(262145),
    JSON.stringify({ data: { link: "x".repeat(2001) } }),
  ];
  for (const body of bodies) {
    const { recipe } = setup();
    globalThis.fetch = async () => new Response(body);
    const result = await executeRecipe(recipe, item);
    assert.ok(result.error);
    assert.equal(
      JSON.stringify(result).includes("private-session-value"),
      false,
    );
  }
  const { recipe } = setup();
  recipe.steps[1].responsePath = "__proto__.link";
  assert.ok((await executeRecipe(recipe, item)).error);
});
test("GET, templates codificados e seletor inválido seguem o contrato", async () => {
  const { recipe, sent } = setup();
  recipe.steps[1].method = "GET";
  recipe.steps[1].url =
    "https://shop.test/convert?url={{originalUrl|urlencode}}";
  assert.ok((await executeRecipe(recipe, item)).affiliateUrl);
  assert.equal(sent[0].options.body, undefined);
  assert.equal(new URL(sent[0].url).searchParams.get("url"), item.originalUrl);
  const missing = setup();
  missing.recipe.steps[1].headers = { Missing: "{{unknown}}" };
  assert.ok((await executeRecipe(missing.recipe, item)).error);
  for (const step of [
    { type: "fill", selector: "#missing", value: "x" },
    { type: "click", selector: "#missing" },
  ]) {
    const { recipe } = setup();
    recipe.steps.unshift(step);
    assert.ok((await executeRecipe(recipe, item)).error);
  }
});
