import { isRequestBody, isResponsePath, type RecipeBody } from './recipe-json.js';
export interface Account {
  id: string;
  email: string;
  name: string;
  permissions: string[];
}
export interface Auth {
  token: string;
  refreshToken: string;
  expiresAt: number;
  user: Account;
}
export type Step =
  | {
      type: "extract";
      name: string;
      source: "dom" | "localStorage" | "sessionStorage" | "cookie" | "requestHeader";
      selector?: string;
      attribute?: string;
      key?: string;
      sourceUrl?:string;
    }
  | {
      type: "request";
      url: string;
      method: "GET" | "POST";
      headers?: Record<string, string>;
      body?: RecipeBody;
      bodyEncoding?: "json" | "form";
      responsePath: string;
      responseChecks?: { path: string; equals: string | number | boolean | null }[];
    }
  | { type: "fill"; selector: string; value: string }
  | { type: "click"; selector: string };
export interface Recipe {
  id: string;
  name: string;
  loginUrl: string;
  allowedOrigins: string[];
  affiliateOrigins: string[];
  batchSize: number;
  intervalMs: number;
  steps: Step[];
  executionWorld?: 'ISOLATED' | 'MAIN';
}
export interface Configuration {
  version: 1;
  marketplaces: Recipe[];
}
export interface Item {
  id: string;
  title: string;
  originalUrl: string;
}
export interface Result {
  id: string;
  affiliateUrl?: string;
  error?: string;
}
export interface Batch {
  leaseId: string;
  leaseExpiresAt: number;
  items: Item[];
  results: Result[];
}
export interface Progress {
  status: "idle" | "running" | "paused" | "complete";
  success: number;
  failed: number;
  total: number;
  message: string;
  currentTitle?: string;
}
export function backendOrigin(value: string): string {
  const u = new URL(value);
  if (
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )) ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw new Error("Use HTTPS ou HTTP em localhost/127.0.0.1, sem caminho.");
  return u.origin;
}

export function validateConfiguration(raw: unknown): Configuration {
  const config = raw as Configuration;
  if (
    config?.version !== 1 ||
    !Array.isArray(config.marketplaces) ||
    config.marketplaces.length > 30
  ) {
    throw new Error("Versão de configuração não suportada.");
  }
  for (const recipe of config.marketplaces) {
    validateRecipe(recipe);
  }
  return config;
}

function originsValid(origins: unknown): origins is string[] {
  return (
    Array.isArray(origins) &&
    origins.length > 0 &&
    origins.length <= 10 &&
    origins.every(
      (origin) =>
        typeof origin === "string" && backendOrigin(origin) === origin,
    )
  );
}

export function validateRecipe(recipe: Recipe) {
  if (recipe?.executionWorld !== undefined && !['ISOLATED','MAIN'].includes(recipe.executionWorld)) throw new Error('Contexto de execução inválido.');
  if (
    !recipe ||
    typeof recipe.id !== "string" ||
    !originsValid(recipe.allowedOrigins) ||
    !originsValid(recipe.affiliateOrigins)
  ) {
    throw new Error("Configuração de domínios inválida.");
  }
  if (
    !recipe.allowedOrigins.includes(new URL(recipe.loginUrl).origin) ||
    !Array.isArray(recipe.steps) ||
    !recipe.steps.length ||
    recipe.steps.length > 15
  ) {
    throw new Error("Configuração de execução inválida.");
  }
  if (
    !Number.isInteger(recipe.batchSize) ||
    recipe.batchSize < 1 ||
    recipe.batchSize > 10 ||
    !Number.isInteger(recipe.intervalMs) ||
    recipe.intervalMs < 100 ||
    recipe.intervalMs > 600000
  ) {
    throw new Error("Intervalo ou tamanho de lote inválido.");
  }
  for (const step of recipe.steps) {
    validateStep(step);
  }
}

function validateStep(step: Step) {
  switch (step?.type) {
    case "request":
      validateRequest(step);
      break;
    case "extract":
      validateExtract(step);
      break;
    case "fill":
      if (typeof step.value !== "string") {
        throw new TypeError("Preenchimento inválido.");
      }
      validateSelector(step.selector);
      break;
    case "click":
      validateSelector(step.selector);
      break;
    default:
      throw new Error("Operação não suportada pela extensão.");
  }
}
function validateSelector(selector: unknown) {
  if (
    typeof selector !== "string" ||
    !selector.trim() ||
    selector.length > 600
  ) {
    throw new Error("Seletor inválido.");
  }
}
function validateExtract(step: Extract<Step, { type: "extract" }>) {
  if (
    !/^[a-zA-Z]\w{0,40}$/.test(step.name) ||
    ["originalUrl", "__proto__", "constructor", "prototype"].includes(
      step.name,
    ) ||
    !["dom", "localStorage", "sessionStorage", "cookie", "requestHeader"].includes(step.source)
  ) {
    throw new Error("Extração inválida.");
  }
  if (step.source === "dom") {
    validateSelector(step.selector);
    return;
  }
  if(step.source==='requestHeader'&&(!step.sourceUrl||!/^(?:x-[\w-]+|csrf-token)$/i.test(step.key??'')||new URL(step.sourceUrl).protocol!=='https:'))throw new Error('Origem do header inválida.');
  if (typeof step.key !== "string" || !step.key) {
    throw new Error("Chave de extração inválida.");
  }
}
function validateRequest(step: Extract<Step, { type: "request" }>) {
  if (
    !["GET", "POST"].includes(step.method) ||
    typeof step.url !== "string" ||
    !isResponsePath(step.responsePath)
  ) {
    throw new Error("Requisição inválida.");
  }
  if (step.bodyEncoding && !["json", "form"].includes(step.bodyEncoding)) {
    throw new Error("Codificação inválida.");
  }
  for (const values of [step.headers]) {
    if (
      values &&
      (typeof values !== "object" ||
        !Object.values(values).every((value) => typeof value === "string"))
    ) {
      throw new Error("Valores de requisição inválidos.");
    }
  }
  if (step.body !== undefined && !isRequestBody(step.body, step.bodyEncoding === 'form')) throw new Error('Corpo de requisição inválido.');
  if (step.responseChecks !== undefined && (!Array.isArray(step.responseChecks) || step.responseChecks.length > 8 || step.responseChecks.some(check => !check || !isResponsePath(check.path) || !(check.equals === null || ['string','boolean'].includes(typeof check.equals) || typeof check.equals === 'number' && Number.isFinite(check.equals))))) throw new Error('Condição de resposta inválida.');
}
