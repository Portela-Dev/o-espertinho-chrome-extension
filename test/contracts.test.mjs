import test from "node:test";
import assert from "node:assert/strict";
import { backendOrigin, validateConfiguration } from "../dist/contracts.js";
import { configuration } from "./fixtures.mjs";
import {isRequestBody} from '../dist/recipe-json.js';

test('JSON aninhado tem limites e condição de resposta não aceita caminhos perigosos',()=>{
 const c=structuredClone(configuration),step=c.marketplaces[0].steps[0];step.body={variables:{links:[{url:'{{originalUrl}}'}],flag:true,optional:null}};step.responseChecks=[{path:'data.links.0.failCode',equals:0}];assert.ok(validateConfiguration(c));
 step.bodyEncoding='form';assert.throws(()=>validateConfiguration(c));delete step.bodyEncoding;
 step.responseChecks[0].path='data.__proto__.url';assert.throws(()=>validateConfiguration(c));
 assert.equal(isRequestBody(JSON.parse('{"constructor":1}')),false);let deep={};for(let i=0;i<9;i++)deep={value:deep};assert.equal(isRequestBody(deep),false);
});

test('contexto da receita é declarativo e limitado a ISOLATED ou MAIN',()=>{for(const executionWorld of ['MAIN','ISOLATED']){const c=structuredClone(configuration);c.marketplaces[0].executionWorld=executionWorld;assert.ok(validateConfiguration(c));}const c=structuredClone(configuration);c.marketplaces[0].executionWorld='eval';assert.throws(()=>validateConfiguration(c));});

test("configurações aceitam HTTPS e loopback e recusam caminhos/segredos/protocolos inseguros", () => {
  assert.equal(backendOrigin("https://api.test/"), "https://api.test");
  assert.equal(backendOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  for (const url of [
    "http://remote.test",
    "file:///etc/test",
    "https://user:pass@api.test",
    "https://api.test/path",
    "https://api.test/?secret=1",
    "https://api.test/#token",
  ]) {
    assert.throws(() => backendOrigin(url));
  }
  assert.equal(validateConfiguration(configuration), configuration);
});
test("valida limites, origens e operações antes de executar a configuração", () => {
  const changes = [
    (c) => {
      c.version = 2;
    },
    (c) => {
      c.marketplaces = null;
    },
    (c) => {
      c.marketplaces[0].allowedOrigins = [];
    },
    (c) => {
      c.marketplaces[0].allowedOrigins = ["https://shop.test/path"];
    },
    (c) => {
      c.marketplaces[0].loginUrl = "https://other.test";
    },
    (c) => {
      c.marketplaces[0].steps = [];
    },
    (c) => {
      c.marketplaces[0].batchSize = 11;
    },
    (c) => {
      c.marketplaces[0].intervalMs = 99;
    },
    (c) => {
      c.marketplaces[0].steps = [{ type: "eval" }];
    },
    (c) => {
      c.marketplaces[0].steps[0].method = "DELETE";
    },
    (c) => {
      c.marketplaces[0].steps[0].bodyEncoding = "binary";
    },
    (c) => {
      c.marketplaces[0].steps[0].headers = { Cookie: 123 };
    },
  ];
  for (const change of changes) {
    const c = structuredClone(configuration);
    change(c);
    assert.throws(() => validateConfiguration(c));
  }
});
test("valida variáveis locais, seletores e valores de preenchimento", () => {
  const valid = [
    {
      type: "extract",
      name: "csrf",
      source: "dom",
      selector: "meta",
      attribute: "content",
    },
    { type: "extract", name: "csrf", source: "cookie", key: "csrf" },
    { type: "fill", selector: "input", value: "{{originalUrl}}" },
    { type: "click", selector: "button" },
  ];
  for (const step of valid) {
    const c = structuredClone(configuration);
    c.marketplaces[0].steps.unshift(step);
    assert.ok(validateConfiguration(c));
  }
  const invalid = [
    { type: "extract", name: "originalUrl", source: "dom", selector: "meta" },
    { type: "extract", name: "csrf", source: "eval", key: "x" },
    { type: "extract", name: "csrf", source: "dom", selector: "" },
    { type: "extract", name: "csrf", source: "cookie" },
    { type: "fill", selector: "input", value: 12 },
    { type: "click", selector: "" },
  ];
  for (const step of invalid) {
    const c = structuredClone(configuration);
    c.marketplaces[0].steps.unshift(step);
    assert.throws(() => validateConfiguration(c));
  }
});
