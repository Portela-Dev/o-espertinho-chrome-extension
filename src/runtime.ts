import { DEFAULT_BACKEND_URL } from "./config.js";
import {captureSession,type ProofMarket,type ProofTest} from './session-proof.js';
import {
  backendOrigin,
  validateConfiguration,
  type State,
  type Auth,
  type Recipe,
  type Configuration,
  type Batch,
  type Item,
  type Result,
} from "./contracts.js";
import { executeRecipe, type ExecutionResult } from "./executor.js";
export interface Command {
  type: string;
  url?: string;
  marketplaceId?: string;
  consent?:boolean;
  includeStorage?:boolean;
  batchFailed?:boolean;
}
interface Claim {
  leaseId: string;
  leaseExpiresAt: number;
  items: Item[];
  remaining?: number;
}
const emptyProgress = () => ({
  status: "idle" as const,
  success: 0,
  failed: 0,
  total: 0,
  message: "Conecte sua conta para começar.",
});
const pause = (delay: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delay));

export class ExtensionRuntime {
  state!: State;
  private initialization?: Promise<void>;
  private pumping = false;
  private generation = 0;
  private proofCapturing=false;
  constructor(private readonly browser: typeof chrome = chrome) {}
  async init() {
    this.initialization ??= this.load();
    return this.initialization;
  }
  private async load() {
    await this.browser.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    const stored = await this.browser.storage.local.get("state");
    this.state = (stored.state as State) ?? {
      backendUrl: DEFAULT_BACKEND_URL,
      progress: emptyProgress(),
    };
    this.state.backendUrl = backendOrigin(this.state.backendUrl);
    await this.browser.alarms.create("worker", { periodInMinutes: 0.5 });
  }
  private save() {
    return this.browser.storage.local.set({ state: this.state });
  }
  private view() {
    const state = this.state;
    return {
      backendUrl: state.backendUrl,
      user: state.auth?.user,
      pairing: !!state.pair,
      config: state.config,
      queue: state.queue,
      marketplaceId: state.marketplaceId,
      progress: state.progress,
      version: this.browser.runtime.getManifest().version,
      proofMarkets:state.proofMarkets,proofTest:state.proofTest,
    };
  }
  private disconnect(message: string) {
    this.generation++;
    delete this.state.auth;
    delete this.state.pair;
    delete this.state.proofMarkets;delete this.state.proofTest;
    this.setPaused(message);
  }
  private setPaused(message: string) {
    this.state.progress.status = "paused";
    this.state.progress.message = message;
  }
  private active(generation: number) {
    return (
      generation === this.generation && this.state.progress.status === "running"
    );
  }
  private async request(path: string, body?: unknown, token?: string) {
    const response = await fetch(
      `${this.state.backendUrl}/api/extension${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          "X-Espertinho-Extension-Id": this.browser.runtime.id,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error("O backend não retornou JSON. Confira BACKEND_URL.");
    }
    return { response, data };
  }
  private checkGeneration(generation: number) {
    if (generation !== this.generation) {
      throw new Error("A sessão mudou.");
    }
  }
  private async renew(auth: Auth, generation: number) {
    const { response, data } = await this.request("/auth/refresh", {
      refreshToken: auth.refreshToken,
    });
    this.checkGeneration(generation);
    if (!response.ok) {
      this.disconnect("Sessão expirada. Conecte sua conta novamente.");
      await this.save();
      throw new Error(this.state.progress.message);
    }
    this.state.auth = data as Auth;
    await this.save();
  }
  private async api<T>(path: string, body?: unknown, retry = true): Promise<T> {
    const auth = this.state.auth;
    if (!auth) {
      throw new Error("Conecte sua conta no O Espertinho.");
    }
    const generation = this.generation;
    const { response, data } = await this.request(path, body, auth.token);
    this.checkGeneration(generation);
    if (response.status === 401 && retry) {
      await this.renew(auth, generation);
      return this.api<T>(path, body, false);
    }
    if (response.status === 401 || response.status === 403) {
      this.disconnect(data.error ?? "Acesso revogado.");
      await this.save();
    }
    if (!response.ok) {
      throw new Error(data.error ?? "Falha na comunicação com o backend.");
    }
    return data as T;
  }
  private async refresh() {
    this.state.config = validateConfiguration(
      await this.api<Configuration>("/config"),
    );
    this.state.queue = await this.api<State["queue"]>("/queue");
    await this.save();
  }
  private async poll() {
    const pair = this.state.pair;
    if (!pair || pair.nextAt > Date.now()) {
      return;
    }
    if (pair.expiresAt < Date.now()) {
      delete this.state.pair;
      this.state.progress.message =
        "Conexão expirada. Clique em Entrar novamente.";
      await this.save();
      return;
    }
    pair.nextAt = Date.now() + 3000;
    const generation = this.generation;
    const { response, data } = await this.request("/auth/poll", {
      deviceCode: pair.deviceCode,
      verifier: pair.verifier,
    });
    this.checkGeneration(generation);
    if (response.status === 202) {
      return;
    }
    if (!response.ok) {
      delete this.state.pair;
      this.state.progress.message = data.error ?? "Login não autorizado.";
      await this.save();
      return;
    }
    if (!data.user?.permissions?.includes("affiliate_links")) {
      throw new Error("Perfil sem permissão para gerar links.");
    }
    this.state.auth = data as Auth;
    delete this.state.pair;
    this.state.progress = emptyProgress();
    this.state.progress.message = "Conta conectada.";
    await this.refresh();
  }
  private recipe(id = this.state.marketplaceId) {
    const recipe = this.state.config?.marketplaces.find((m) => m.id === id);
    if (!recipe) {
      throw new Error("Escolha um marketplace configurado.");
    }
    return recipe;
  }
  private async existingTab(recipe: Recipe) {
    if (!this.state.tabId) {
      return;
    }
    try {
      const tab = await this.browser.tabs.get(this.state.tabId);
      if (tab.url && recipe.allowedOrigins.includes(new URL(tab.url).origin)) {
        return this.state.tabId;
      }
    } catch {
      /* A aba pode ter sido fechada. */
    }
    return undefined;
  }
  private async recipeTab(recipe: Recipe) {
    const id = await this.existingTab(recipe);
    if (id) {
      return id;
    }
    const tabs = await this.browser.tabs.query({
      url: recipe.allowedOrigins.map((origin) => `${origin}/*`),
    });
    const tab =
      tabs.find((t) => t.url === recipe.loginUrl) ??
      (await this.browser.tabs.create({ url: recipe.loginUrl, active: false }));
    if (!tab.id) {
      throw new Error("Não foi possível abrir a aba do marketplace.");
    }
    this.state.tabId = tab.id;
    await this.save();
    return tab.id;
  }
  private async waitForTab(tabId: number, recipe: Recipe) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const tab = await this.browser.tabs.get(tabId);
      if (tab.status === "complete" && tab.url) {
        if (!recipe.allowedOrigins.includes(new URL(tab.url).origin)) {
          throw new Error(
            "O marketplace redirecionou para uma origem não autorizada.",
          );
        }
        return;
      }
      await pause(250);
    }
    throw new Error("A página do marketplace não terminou de carregar.");
  }
  private async waitInterval() {
    const delay = (this.state.nextAt ?? 0) - Date.now();
    if (delay > 15000) {
      return false;
    }
    if (delay > 0) {
      await pause(delay);
    }
    return true;
  }
  private async reserve(recipe: Recipe) {
    if (this.state.batch) {
      return true;
    }
    const generation = this.generation;
    const batch = await this.api<Claim>("/batches/claim", {
      marketplaceId: recipe.id,
    });
    this.checkGeneration(generation);
    if (!batch.items.length) {
      this.state.progress.status = batch.remaining ? "paused" : "complete";
      this.state.progress.message = batch.remaining
        ? "Há links reservados em outra execução. Aguarde a expiração da reserva e continue."
        : "Todos os links pendentes foram processados.";
      await this.refresh();
      return false;
    }
    this.state.batch = { ...batch, results: [] };
    await this.save();
    return true;
  }
  private async convertNext(recipe: Recipe, batch: Batch) {
    const generation = this.generation,
      item = batch.items[batch.results.length];
    this.state.progress.currentTitle = item.title;
    this.state.progress.message = "Gerando link…";
    await this.save();
    const tabId = await this.recipeTab(recipe);
    await this.waitForTab(tabId, recipe);
    const [{ result }] = await this.browser.scripting.executeScript({
      target: { tabId },
      func: executeRecipe,
      args: [recipe, item],
      world: "ISOLATED",
    });
    if (generation !== this.generation) {
      return false;
    }
    if (result?.needsLogin) {
      this.setPaused(result.error ?? "Confirme o login no marketplace.");
      await this.browser.tabs.update(tabId, { active: true });
      await this.save();
      return false;
    }
    batch.results.push(this.itemResult(item.id, result));
    this.state.nextAt = Date.now() + recipe.intervalMs;
    await this.save();
    return true;
  }
  private itemResult(id: string, result: ExecutionResult | undefined): Result {
    if (result?.affiliateUrl) {
      return { id, affiliateUrl: result.affiliateUrl };
    }
    return {
      id,
      error: result?.error ?? "Não foi possível executar a conversão.",
    };
  }
  private async submit(batch: Batch, generation: number) {
    await this.api("/batches/results", {
      leaseId: batch.leaseId,
      results: batch.results,
    });
    this.checkGeneration(generation);
    this.state.progress.success += batch.results.filter(
      (r) => !!r.affiliateUrl,
    ).length;
    this.state.progress.failed += batch.results.filter((r) => !!r.error).length;
    delete this.state.batch;
    delete this.state.progress.currentTitle;
    await this.refresh();
  }
  private async advance(generation: number) {
    const recipe = this.recipe();
    if (!(await this.reserve(recipe))) {
      return false;
    }
    const batch = this.state.batch!;
    if (batch.leaseExpiresAt < Date.now()) {
      delete this.state.batch;
      this.state.progress.message = "Lote expirou. Buscando uma nova reserva.";
      await this.save();
      return true;
    }
    while (batch.results.length < batch.items.length) {
      if (!this.active(generation) || !(await this.waitInterval())) {
        return false;
      }
      if (!(await this.convertNext(recipe, batch))) {
        return false;
      }
    }
    if (!this.active(generation)) {
      return false;
    }
    await this.submit(batch, generation);
    return true;
  }
  async pump() {
    if (this.pumping) {
      return;
    }
    this.pumping = true;
    try {
      await this.init();
      await this.poll();
      if(this.state.auth&&this.state.proofTest?.status==='running')await this.pollProof();
      while (this.state.auth && this.state.progress.status === "running") {
        if (!(await this.advance(this.generation))) {
          return;
        }
      }
    } catch (error) {
      if (this.state) {
        this.setPaused(
          error instanceof Error
            ? error.message
            : "Falha de comunicação. Clique em Continuar para tentar novamente.",
        );
        await this.save();
      }
    } finally {
      this.pumping = false;
    }
  }
  private async login() {
    if (this.state.auth) {
      return;
    }
    this.generation++;
    const verifier = Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
    const challenge = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      ),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
    const { response, data } = await this.request("/auth/start", { challenge });
    if (!response.ok) {
      throw new Error(data.error ?? "Não foi possível iniciar a conexão.");
    }
    if (new URL(data.verificationUrl).origin !== this.state.backendUrl) {
      throw new Error("URL de conexão inválida.");
    }
    this.state.pair = { ...data, verifier, nextAt: 0 };
    this.state.progress.message =
      "Entre no site com Google e autorize esta extensão na aba aberta.";
    await this.save();
    await this.browser.tabs.create({ url: data.verificationUrl });
  }
  private async logout() {
    try {
      if (this.state.auth) {
        await this.api("/auth/logout", {});
      }
    } finally {
      this.disconnect("Você saiu. Conecte sua conta para continuar.");
      delete this.state.batch;
      delete this.state.config;
      delete this.state.queue;
      await this.save();
    }
  }
  private async changeBackend(url: string) {
    if (this.state.auth || this.state.progress.status === "running") {
      throw new Error("Saia da conta antes de trocar o backend.");
    }
    this.state.backendUrl = backendOrigin(url);
    delete this.state.pair;
    delete this.state.config;
    delete this.state.batch;
    this.state.progress = emptyProgress();
    this.generation++;
    await this.save();
  }
  private async openMarketplace(id: string | undefined) {
    const tab = await this.browser.tabs.create({
      url: this.recipe(id).loginUrl,
    });
    this.state.tabId = tab.id;
    await this.save();
  }
  private async start(id: string | undefined) {
    await this.refresh();
    const recipe = this.recipe(id);
    if (
      !(await this.browser.permissions.contains({
        origins: recipe.allowedOrigins.map((origin) => `${origin}/*`),
      }))
    ) {
      throw new Error("Autorize o acesso aos domínios do marketplace.");
    }
    if (this.state.progress.status === "running") {
      return;
    }
    if (this.state.marketplaceId !== recipe.id) {
      delete this.state.batch;
      this.state.progress = emptyProgress();
    }
    this.state.marketplaceId = recipe.id;
    this.state.progress.status = "running";
    this.state.progress.total =
      (this.state.queue?.items.filter((item) =>
        ["pending", "leased"].includes(item.state),
      ).length ?? 0) +
      this.state.progress.success +
      this.state.progress.failed;
    this.state.progress.message = "Iniciando processamento…";
    await this.save();
    void this.pump();
  }
  private async reset() {
    if (this.state.progress.status === "running") {
      throw new Error("Pause o processamento primeiro.");
    }
    await this.api("/queue/reset", {});
    delete this.state.batch;
    this.state.progress = emptyProgress();
    await this.refresh();
  }
  async handle(message: Command) {
    await this.init();
    switch (message.type) {
      case "STATE":
        void this.pump();
        break;
      case "LOGIN":
        await this.login();
        break;
      case "LOGOUT":
        await this.logout();
        break;
      case "BACKEND":
        await this.changeBackend(message.url ?? "");
        break;
      case "REFRESH":
        await this.refresh();
        break;
      case 'PROOF_MARKETS':
        this.state.proofMarkets=(await this.api<{marketplaces:ProofMarket[]}>('/session-proof/marketplaces')).marketplaces;await this.save();break;
      case 'PROOF_OPEN': {
        if(!this.state.auth)throw new Error('Conecte sua conta administradora.');
        const market=this.proofMarket(message.marketplaceId);await this.browser.tabs.create({url:market.loginUrl});break;
      }
      case 'PROOF_CAPTURE':await this.proveSession(message);break;
      case 'PROOF_BATCH':await this.proveSession({...message,batchFailed:true});break;
      case "OPEN":
        await this.openMarketplace(message.marketplaceId);
        break;
      case "START":
        await this.start(message.marketplaceId);
        break;
      case "PAUSE":
        this.setPaused(
          "Pausado. Os resultados já gerados serão enviados ao continuar.",
        );
        await this.save();
        break;
      case "RESET":
        await this.reset();
        break;
      default:
        throw new Error("Operação desconhecida.");
    }
    return this.view();
  }
  private proofMarket(id?:string){const market=this.state.proofMarkets?.find(m=>m.id===id);if(!market)throw new Error('Carregue e escolha um marketplace para a prova.');return market;}
  private async proveSession(message:Command){
    if(!message.consent)throw new Error('Confirme o envio temporário da sessão para este teste.');
    if(!this.state.auth)throw new Error('Conecte sua conta administradora.');
    if(this.proofCapturing||this.state.proofTest?.status==='running'||this.state.progress.status==='running')throw new Error('Aguarde o processamento em andamento.');
    const market=this.proofMarket(message.marketplaceId),url=message.batchFailed?undefined:new URL(message.url??'');
    if(url&&(url.protocol!=='https:'||url.username||url.password||!market.allowedOrigins.includes(url.origin)))throw new Error('Use um link HTTPS dos domínios cadastrados.');
    if(!await this.browser.permissions.contains({permissions:['cookies'],origins:market.allowedOrigins.map(o=>o+'/*')}))throw new Error('Autorize cookies e os domínios do marketplace.');
    const generation=this.generation;this.proofCapturing=true;
    try{const {session}=await captureSession(this.browser,market,!!message.includeStorage);this.checkGeneration(generation);this.state.proofTest=await this.api<ProofTest>('/session-proof/tests',{marketplaceId:market.id,...(url?{url:url.href}:{}),batchFailed:!!message.batchFailed,consent:true,session});this.checkGeneration(generation);await this.save();}
    finally{this.proofCapturing=false;}
  }
  private async pollProof(){
    const test=this.state.proofTest;if(!test)return;
    try{const next=await this.api<ProofTest>('/session-proof/tests/'+test.id);if(this.state.proofTest?.id===test.id){this.state.proofTest=next;await this.save();}}
    catch{if(this.state.proofTest?.id===test.id){this.state.proofTest={...test,status:'failed',error:'Teste expirado ou conexão perdida. Faça uma nova captura.'};await this.save();}}
  }
}
