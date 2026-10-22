import type { Item, Recipe, Step } from "./contracts.js";
export interface ExecutionResult {
  affiliateUrl?: string;
  error?: string;
  needsLogin?: boolean;
}

// A função inteira é serializada pelo Chrome. Os helpers e valores de sessão
// permanecem no mundo isolado da aba; apenas o resultado final sai desse contexto.
export async function executeRecipe(
  recipe: Recipe,
  item: Item,
  localVariables:Record<string,string>={},
): Promise<ExecutionResult> {
  // Capture the page document inside the function serialized into the isolated tab.
  const pageDocument = document;
  const variables: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  variables.originalUrl = item.originalUrl;
  class LoginRequired extends Error {}

  function validateOrigin() {
    const original = new URL(item.originalUrl);
    if (
      !recipe.allowedOrigins.includes(location.origin) ||
      !recipe.allowedOrigins.includes(original.origin) ||
      original.username ||
      original.password
    ) {
      throw new Error("Origem não autorizada.");
    }
  }
  function render(value: string): string {
    return value.replace(
      /\{\{([a-zA-Z]\w*)(\|urlencode)?\}\}/g,
      (_all, key: string, encoded: string) => {
        if (!Object.hasOwn(variables, key)) {
          throw new Error("Variável não encontrada.");
        }
        return encoded ? encodeURIComponent(variables[key]) : variables[key];
      },
    );
  }
  function readValue(step: Extract<Step, { type: "extract" }>) {
    switch (step.source) {
      case 'requestHeader':return localVariables[step.name];
      case "localStorage":
        return localStorage.getItem(step.key ?? "");
      case "sessionStorage":
        return sessionStorage.getItem(step.key ?? "");
      case "cookie":
        return pageDocument.cookie
          .split("; ")
          .find((value) => value.startsWith(`${step.key}=`))
          ?.split("=")
          .slice(1)
          .join("=");
      case "dom": {
        const element = pageDocument.querySelector(step.selector ?? "");
        return step.attribute
          ? element?.getAttribute(step.attribute)
          : element?.textContent;
      }
    }
  }
  function extract(step: Extract<Step, { type: "extract" }>) {
    const value = readValue(step);
    if (!value) {
      throw new LoginRequired();
    }
    variables[step.name] = value.trim();
  }
  function fill(step: Extract<Step, { type: "fill" }>) {
    const input = pageDocument.querySelector<HTMLInputElement>(step.selector);
    if (!input) {
      throw new Error("Campo não encontrado.");
    }
    input.value = render(step.value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function click(step: Extract<Step, { type: "click" }>) {
    const element = pageDocument.querySelector<HTMLElement>(step.selector);
    if (!element) {
      throw new Error("Botão não encontrado.");
    }
    element.click();
  }
  function requestHeaders(step: Extract<Step, { type: "request" }>) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(step.headers ?? {})) {
      if (/^(cookie|authorization|host|origin|referer|proxy-|sec-)/i.test(key)) {
        throw new Error("Header reservado.");
      }
      headers[key] = render(value);
    }
    return headers;
  }
  function requestBody(step: Extract<Step, { type: "request" }>) {
    if (step.method === "GET") {
      return undefined;
    }
    let nodes = 0;
    function renderJson(value: unknown, depth = 0): unknown {
      if (++nodes > 512 || depth > 6) throw new Error('Corpo excedeu os limites.');
      if (typeof value === 'string') return render(value);
      if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
      if (Array.isArray(value)) return value.map(child => renderJson(child, depth + 1));
      if (!value || typeof value !== 'object') throw new Error('Corpo inválido.');
      return Object.fromEntries(Object.entries(value).map(([key, child]) => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Chave reservada.');
        return [key, renderJson(child, depth + 1)];
      }));
    }
    if (step.bodyEncoding === "form") {
      const body: Record<string, string> = {};
      for (const [key, value] of Object.entries(step.body ?? {})) {
        if (typeof value !== 'string') throw new Error('Campo de formulário inválido.');
        body[key] = render(value);
      }
      return new URLSearchParams(body);
    }
    const body = JSON.stringify(renderJson(step.body ?? {}));
    if (body.length > 32768) throw new Error('Corpo excedeu os limites.');
    return body;
  }
  function responseLink(text: string, step: Extract<Step, { type: "request" }>) {
    if (text.length > 262144) {
      throw new Error("Resposta excedeu o limite.");
    }
    const data: unknown = JSON.parse(text);
    function readPath(path: string) {
      let value = data;
      for (const key of path.split(".")) {
      if (
        ["__proto__", "constructor", "prototype"].includes(key) ||
        !value ||
        typeof value !== "object" ||
        !Object.hasOwn(value, key)
      ) {
        throw new Error("Link não encontrado.");
      }
      value = (value as Record<string, unknown>)[key];
      }
      return value;
    }
    for (const check of step.responseChecks ?? []) {
      if (readPath(check.path) !== check.equals) throw new Error('Conversão recusada.');
    }
    const value = readPath(step.responsePath);
    if (typeof value !== "string" || value.length > 2000) {
      throw new Error("Link inválido.");
    }
    return value;
  }
  async function request(step: Extract<Step, { type: "request" }>) {
    const url = new URL(render(step.url));
    if (
      url.origin !== location.origin ||
      !recipe.allowedOrigins.includes(url.origin) ||
      url.username ||
      url.password
    ) {
      throw new Error("Destino não autorizado.");
    }
    const response = await fetch(url.href, {
      method: step.method,
      headers: requestHeaders(step),
      body: requestBody(step),
      credentials: "include",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 401 || response.status === 403) {
      throw new LoginRequired();
    }
    if (!response.ok) {
      throw new Error("Conversão recusada.");
    }
    return responseLink(await response.text(), step);
  }
  async function runSteps() {
    let link = "";
    for (const step of recipe.steps) {
      switch (step.type) {
        case "extract":
          extract(step);
          break;
        case "fill":
          fill(step);
          break;
        case "click":
          click(step);
          break;
        case "request":
          link = await request(step);
          break;
      }
    }
    return link;
  }
  try {
    validateOrigin();
    const link = new URL(await runSteps());
    if (
      !recipe.affiliateOrigins.includes(link.origin) ||
      link.username ||
      link.password
    ) {
      throw new Error("Origem do link não autorizada.");
    }
    return { affiliateUrl: link.href };
  } catch (error) {
    if (error instanceof LoginRequired) {
      return {
        error: "Abra o marketplace, confirme o login e tente novamente.",
        needsLogin: true,
      };
    }
    return {
      error:
        "Conversão não concluída. Confira os seletores e a configuração da resposta.",
    };
  }
}
