import { discoveryPolicy, failureKind } from './catalog-policy.js';
import { DEFAULT_BACKEND_URL } from './config.js';
import { backendOrigin, validateRecipe, type Auth } from './contracts.js';
import { RequestHeaderMemory } from './request-header-memory.js';
import { CatalogNavigation } from './catalog-navigation.js';
import { discoverPage } from './catalog-discovery.js';
import { extractCatalogProduct } from './catalog-product.js';
import { executeRecipe } from './executor.js';
import type { CatalogState, CatalogRun, CatalogStep, CatalogClaim, CatalogMarket,CatalogStats } from './catalog-types.js';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
class BackendError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}
type CatalogCommand = {
    type: string;
    marketplaceId?: string;
    step?: CatalogStep;
    url?: string;
    limit?: number;
    retryFailed?: boolean;
    runId?: string;
    page?: number;
    pageSize?: number;
    hostWindowId?:number;
};
export class CatalogRuntime {
    state!: CatalogState;
    private initialization?: Promise<void>;
    private refreshing?: Promise<boolean>;
    private pumping = false;
    private generation = 0;
    private nextRequestAt = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private stats?:CatalogStats;
    private statsAt=0;
    private statsError='';
    private statsFilter='';
    private statsSequence=0;
    private statsRequest?:{key:string;sequence:number;promise:Promise<void>};
    private readonly headers: RequestHeaderMemory;
    private readonly navigation: CatalogNavigation;
    constructor(private readonly browser: typeof chrome = chrome) {
        this.headers = new RequestHeaderMemory(browser);
        this.navigation = new CatalogNavigation(browser, () => this.state, () => this.save());
    }
    async init() {
        this.initialization ??= this.load();
        await this.initialization;
    }
    private async load() {
        await this.browser.storage.local.setAccessLevel({
            accessLevel: 'TRUSTED_CONTEXTS'
        });
        const old = (await this.browser.storage.local.get('state')).state as CatalogState | undefined;
        this.state = old?.version === 2 ? old : {
            version: 2, backendUrl: old?.backendUrl ?? DEFAULT_BACKEND_URL, auth: old?.auth, markets: [], message: 'Conecte sua conta para começar.'
        };
        this.state.backendUrl = backendOrigin(this.state.backendUrl);
        await this.browser.alarms.create('worker', {
            periodInMinutes: 0.5
        });
        await this.save();
    }
    private save() {
        return this.browser.storage.local.set({
            state: this.state
        });
    }
    private async disconnect() {
        this.generation++;
        clearTimeout(this.timer);
        await this.headers.clear();
        delete this.state.auth;
        delete this.state.pair;
        delete this.state.claim;
        delete this.state.pendingResult;
        delete this.state.run;
        delete this.state.nextAt;
        delete this.state.locallyPaused;
        delete this.state.error;
        this.state.markets = [];
        this.stats=undefined;this.statsAt=0;this.statsError='';this.statsFilter='';this.statsSequence++;this.statsRequest=undefined;
        this.state.message = 'Sessão encerrada. Entre novamente.';
        await this.save();
    }
    private async request(path: string, body?: unknown, token?: string) {
        const delay = Math.max(0, this.nextRequestAt - Date.now());
        this.nextRequestAt = Math.max(Date.now(), this.nextRequestAt) + 300;
        if (delay)
            await sleep(delay);
        const response = await fetch(this.state.backendUrl + '/api/extension' + path, {
            method: body === undefined ? 'GET' : 'POST', headers: {
                'Content-Type': 'application/json', 'X-Espertinho-Extension-Id': this.browser.runtime.id, ...(token ? {
                    Authorization: 'Bearer ' + token
                } : {})
            }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000)
        });
        let data: any;
        try {
            data = await response.json();
        }
        catch {
            throw new Error('Resposta inválida do backend.');
        }
        return {
            response, data
        };
    }
    private async api<T = any>(path: string, body?: unknown, retry = true): Promise<T> {
        const auth = this.state.auth, generation = this.generation;
        if (!auth)
            throw new Error('Entre no O Espertinho.');
        const { response, data } = await this.request(path, body, auth.token);
        if (generation !== this.generation)
            throw new Error('Operação interrompida.');
        if(response.status===401&&retry){
            const renewed=await this.renew(auth);
            if(generation!==this.generation)throw new Error('Operação interrompida.');
            if(renewed)return this.api(path,body,false);
        }
        if (response.status === 401 || response.status === 403)
            await this.disconnect();
        if (!response.ok)
            throw new BackendError(data.error ?? 'Não foi possível concluir a operação.', response.status);
        return data as T;
    }
    private async renew(auth:Auth){
        if(this.state.auth?.token!==auth.token)return true;
        this.refreshing??=this.rotate(auth).finally(()=>{this.refreshing=undefined;});
        return this.refreshing;
    }
    private async rotate(auth:Auth){
        const renewed=await this.request('/auth/refresh',{refreshToken:auth.refreshToken});
        if(this.state.auth?.refreshToken!==auth.refreshToken)throw new Error('Operação interrompida.');
        if(!renewed.response.ok)return false;
        this.state.auth=renewed.data as Auth;await this.save();return true;
    }
    async observeAffiliateHeaders(details: Parameters<RequestHeaderMemory['observe']>[0]) {
        await this.init();
        await this.headers.observe(details);
    }
    private async refresh() {
        const config = await this.api('/catalog/config');
        this.state.markets = config.marketplaces;
        if(!this.state.markets.some(m=>m.id===this.state.marketplaceId))this.state.marketplaceId=this.state.markets[0]?.id;
        this.state.message = 'Configurações atualizadas.';
        await this.save();
    }
    private async syncRun() {
        const run = this.state.run;
        if (!run) return;
        try {
            const updated = await this.api<CatalogRun>('/catalog/runs/' + run.id);
            if (this.state.run?.id === run.id) this.state.run = updated;
        } catch (error) {
            if (!(error instanceof BackendError) || error.status !== 404) throw error;
            if (this.state.run?.id !== run.id) return;
            clearTimeout(this.timer);
            delete this.state.run;
            delete this.state.claim;
            delete this.state.pendingResult;
            delete this.state.nextAt;
            delete this.state.locallyPaused;
            delete this.state.error;
            this.state.message = 'A execução anterior não está mais disponível. Você pode iniciar uma nova execução.';
        }
        await this.save();
    }
    private market(id?: string): CatalogMarket {
        const market = this.state.markets.find(m => m.id === (id ?? this.state.marketplaceId));
        if (!market)
            throw new Error('Escolha um marketplace.');
        return market;
    }
    private async login() {
        const verifier = hex(crypto.getRandomValues(new Uint8Array(32)).buffer), challenge = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
        const { response, data } = await this.request('/auth/start', {
            challenge
        });
        if (!response.ok)
            throw new Error(data.error ?? 'Falha no login.');
        const url = new URL(data.verificationUrl);
        if (url.origin !== this.state.backendUrl)
            throw new Error('Origem de login inválida.');
        this.state.pair = {
            ...data, verifier, nextAt: 0
        };
        await this.save();
        await this.browser.tabs.create({
            url: url.href, active: true
        });
    }
    private async poll() {
        const pair = this.state.pair;
        if (!pair || pair.nextAt > Date.now())
            return;
        if (pair.expiresAt < Date.now()) {
            delete this.state.pair;
            this.state.message = 'Conexão expirada. Entre novamente.';
            await this.save();
            return;
        }
        pair.nextAt = Date.now() + 3000;
        const generation = this.generation;
        const { response, data } = await this.request('/auth/poll', {
            deviceCode: pair.deviceCode, verifier: pair.verifier
        });
        if (generation !== this.generation)
            return;
        if (response.status === 202)
            return;
        if (!response.ok)
            throw new Error(data.error ?? 'Login recusado.');
        if (!data.user?.permissions?.includes('affiliate_links'))
            throw new Error('Perfil sem permissão para gerar links.');
        this.state.auth = data;
        delete this.state.pair;
        this.state.message = 'Conta conectada.';
        await this.refresh();
    }
    private async prepare(market: CatalogMarket) {
        const recipe = market.config.recipe;
        if (recipe)
            validateRecipe(recipe);
        if (this.state.run && !['completed', 'failed', 'cancelled'].includes(this.state.run.status) && this.state.run.marketplace_id !== market.id)
            throw new Error('Prepare o marketplace da execução atual.');
        if (this.state.tabId) {
            try {
                const tab = await this.browser.tabs.get(this.state.tabId);
                if (tab.windowId !== this.state.windowId)
                    throw new Error('tab_closed');
            }
            catch {
                delete this.state.tabId;
                delete this.state.windowId;
                await this.save();
            }
        }
        const tabId = await this.navigation.ensure(recipe?.loginUrl ?? market.website_url, market.allowedOrigins);
        await this.navigation.wait(market.allowedOrigins, market.config.timeoutMs);
        if (recipe)
            await this.headers.arm(recipe, tabId);
        else
            await this.headers.clear();
        await this.navigation.focus();
        this.state.message = 'Faça login se necessário. Se a receita usa header de requisição, gere um link manualmente nesta aba para prepará-lo.';
        await this.save();
    }
    private async focusProcessing() {
        try {
            await this.navigation.focus();
            return;
        }
        catch (error) {
            if (!(error instanceof Error) || error.message !== 'tab_closed')
                throw error;
        }
        const run = this.state.run;
        const active = !!run && !['completed', 'failed', 'cancelled'].includes(run.status);
        if (active && ['queued', 'running'].includes(run.status))
            await this.action('pause');
        await this.prepare(this.market(active ? run.marketplace_id : this.state.marketplaceId));
        this.state.message = active
            ? 'Aba reaberta. Confira a sessão e clique em Continuar para retomar a mesma execução.'
            : 'Aba de processamento aberta. Faça login se necessário.';
        await this.save();
    }
    async handle(command: CatalogCommand) {
        await this.init();
        if (command.type !== 'STATE') delete this.state.error;
        if(command.hostWindowId!==undefined&&['START','PREPARE','FOCUS','ATTACH'].includes(command.type)){
            if(!Number.isInteger(command.hostWindowId)||command.hostWindowId<0)throw new Error('Janela inválida.');
            this.state.hostWindowId=command.hostWindowId;
        }
        switch (command.type) {
            case 'STATE': break;
            case 'FILTER':
                this.state.marketplaceId=this.market(command.marketplaceId).id;
                this.state.retryFailed=command.retryFailed??false;
                await this.save();
                break;
            case 'LOGIN':
                await this.login();
                break;
            case 'LOGOUT':
                this.generation++;
                if (this.state.auth) {
                    try {
                        await this.api('/auth/logout', {});
                    }
                    finally {
                        await this.disconnect();
                    }
                }
                else
                    await this.disconnect();
                break;
            case 'REFRESH':
                await this.refresh();
                break;
            case 'BACKEND':
                if (this.state.auth || this.state.pair)
                    throw new Error('Saia antes de alterar o backend.');
                this.state.backendUrl = backendOrigin(command.url!);
                delete this.state.run;
                delete this.state.claim;
                delete this.state.pendingResult;
                await this.save();
                break;
            case 'PREPARE':
                this.state.marketplaceId = this.market(command.marketplaceId).id;
                await this.prepare(this.market());
                break;
            case 'START':
                await this.start(command);
                break;
            case 'ATTACH':
                await this.attach(command.runId!);
                break;
            case 'RUNS': return this.api('/catalog/runs?page=' + Math.max(1, command.page ?? 1) + '&pageSize=' + Math.min(50, Math.max(1, command.pageSize ?? 10)));
            case 'FOCUS':
                await this.focusProcessing();
                break;
            case 'PAUSE':
                await this.action('pause');
                break;
            case 'CANCEL':
                await this.action('cancel');
                delete this.state.claim;
                delete this.state.pendingResult;
                break;
            case 'RESUME':
                await this.resume();
                break;
            default: throw new Error('Operação desconhecida.');
        }
        if (command.type === 'STATE')
            void this.pump();
        if(this.state.auth)await this.loadStats(command.type!=='STATE');
        return this.view();
    }
    private async start(command: CatalogCommand) {
        if (this.state.run && !['completed', 'cancelled', 'failed'].includes(this.state.run.status)) await this.syncRun();
        if (this.state.run && !['completed', 'cancelled', 'failed'].includes(this.state.run.status))
            throw new Error('Conclua ou cancele a execução atual.');
        const market = this.market(command.marketplaceId);
        if (market.catalog_executor !== 'extension')
            throw new Error('Ative o executor da extensão no admin.');
        this.state.marketplaceId = market.id;
        this.state.retryFailed=command.retryFailed??false;
        if (command.step === 'convert') {
            if (!market.config.recipe)
                throw new Error('Cadastre a receita de conversão.');
            await this.headers.values(market.config.recipe);
        }
        this.state.locallyPaused = false;
        this.state.run = await this.api('/catalog/runs', {
            marketplaceId: market.id, step: command.step, requestKey: crypto.randomUUID(), limit: command.limit ?? 100, retryFailed: command.retryFailed ?? false
        });
        delete this.state.claim;
        delete this.state.pendingResult;
        delete this.state.nextAt;
        await this.save();
        void this.pump();
    }
    private async attach(runId: string) {
        const run = await this.api<CatalogRun>('/catalog/runs/' + runId);
        if (this.state.run && this.state.run.id !== run.id && !['completed', 'cancelled', 'failed'].includes(this.state.run.status))
            throw new Error('Já existe uma execução local.');
        this.state.run = run;
        this.state.locallyPaused = false;
        await this.save();
    }
    private async resume() {
        const run = this.state.run;
        if (!run)
            throw new Error('Não há execução para retomar.');
        if (this.state.tabId) {
            const blocked = await this.navigation.inspect(run.snapshot.settings.blockRules);
            if (blocked && blocked !== 'unavailable')
                throw new Error('A página ainda exige intervenção: ' + blocked);
        }
        this.state.run = await this.api('/catalog/runs/' + run.id + '/action', {
            action: 'resume'
        });
        this.state.locallyPaused = false;
        delete this.state.claim;
        delete this.state.pendingResult;
        await this.save();
        void this.pump();
    }
    private view() {
        return {
            backendUrl: this.state.backendUrl, user: this.state.auth?.user, pairing: !!this.state.pair, markets: this.state.markets, marketplaceId: this.state.marketplaceId,retryFailed:this.state.retryFailed??false,stats:this.stats,statsError:this.statsError, error:this.state.error, run: this.state.run, message: this.state.message, version: this.browser.runtime.getManifest().version
        };
    }
    private async loadStats(force=false){
        const marketplaceId=this.state.marketplaceId,retryFailed=this.state.retryFailed??false,generation=this.generation;
        if(!marketplaceId)return;
        const key=marketplaceId+':'+retryFailed;
        if(this.statsRequest?.key===key)return this.statsRequest.promise;
        if(!force&&this.statsFilter===key&&Date.now()-this.statsAt<15000)return;
        if(this.stats?.marketplaceId!==marketplaceId||this.stats.retryFailed!==retryFailed)this.stats=undefined;
        const sequence=++this.statsSequence;this.statsFilter=key;this.statsAt=Date.now();this.statsError='';
        const promise=(async()=>{
            try{
                const data=await this.api<CatalogStats>('/catalog/stats?marketplaceId='+encodeURIComponent(marketplaceId)+'&retryFailed='+retryFailed);
                if(generation!==this.generation||sequence!==this.statsSequence||this.state.marketplaceId!==marketplaceId||(this.state.retryFailed??false)!==retryFailed)return;
                if(data.marketplaceId!==marketplaceId||data.retryFailed!==retryFailed)throw new Error('Contadores inválidos.');
                this.stats=data;this.statsAt=Date.now();this.statsError='';
            }catch{
                if(generation===this.generation&&sequence===this.statsSequence&&this.state.marketplaceId===marketplaceId){this.stats=undefined;this.statsError='Contadores indisponíveis. Atualize as configurações para tentar novamente.';}
            }finally{if(this.statsRequest?.sequence===sequence)this.statsRequest=undefined;}
        })();
        this.statsRequest={key,sequence,promise};await promise;
    }
    private async action(action: 'pause' | 'cancel' | 'human' | 'technical', reason = '') {
        if (!this.state.run)
            return;
        this.generation++;
        this.state.locallyPaused = action !== 'cancel';
        this.state.run = await this.api('/catalog/runs/' + this.state.run.id + '/action', {
            action, reason
        });
        await this.save();
    }
    private remainOnPage(claim: CatalogClaim) {
        const checkpoint = claim.item!.payload.checkpoint;
        if (claim.step === 'convert')
            return !!this.state.tabId;
        if (claim.step !== 'discover' || !checkpoint || !this.state.tabId)
            return false;
        return ['load_more', 'scroll'].includes(claim.item!.payload.config.pagination.mode) || checkpoint.advance;
    }
    private async execute(claim: CatalogClaim): Promise<any> {
        const generation = this.generation;
        const assertActive = () => {
            if (generation !== this.generation)
                throw new Error('interrupted');
        };
        const { item, snapshot, step } = claim;
        if (!item)
            throw new Error('incomplete');
        const origins = snapshot.market.allowedHosts.map((h: string) => 'https://' + h), settings = snapshot.settings;
        let url = item.payload.url;
        if (step === 'convert')
            url = settings.recipe.loginUrl;
        if (step === 'discover' && item.payload.checkpoint)
            url = item.payload.checkpoint.url;
        const sameTab = !!this.state.tabId;
        await this.navigation.ensure(url, origins, !this.remainOnPage(claim));
        await this.navigation.wait(origins, settings.timeoutMs);
        assertActive();
        const block = await this.navigation.inspect(settings.blockRules);
        if (block && block !== 'unavailable')
            return {
                blocked: block
            };
        const inject = async (func: any, args: any[]) => {
            assertActive();
            const values = await this.browser.scripting.executeScript({
                target: {
                    tabId: this.state.tabId!
                }, world: 'ISOLATED', func, args
            });
            const value = values[0]?.result;
            if (value === undefined)
                throw new Error('incomplete');
            return value as any;
        };
        if (step === 'convert')
            return this.convert(claim, inject);
        if (step === 'discover')
            return this.discover(claim, inject, origins, sameTab);
        return inject(extractCatalogProduct, [{
                profile: snapshot.profile, settings, originalUrl: item.payload.originalUrl, allowedOrigins: origins
            }]);
    }
    private async convert(claim: CatalogClaim, inject: (func: any, args: any[]) => Promise<any>) {
        const recipe = claim.snapshot.settings.recipe;
        validateRecipe(recipe);
        const variables = await this.headers.values(recipe), item = claim.item!;
        const result = await inject(executeRecipe, [recipe, {
                id: item.id, title: item.payload.title ?? '', originalUrl: item.payload.originalUrl
            }, variables]);
        if (result.needsLogin)
            return {
                blocked: 'login'
            };
        if (!result.affiliateUrl)
            return {
                outcome: 'technical_failure', reason: 'configuration'
            };
        return {
            outcome: 'success', affiliateUrl: result.affiliateUrl
        };
    }
    private async advanceDiscovery(claim: CatalogClaim, inject: (func: any, args: any[]) => Promise<any>, origins: string[], sameTab: boolean) {
        const { config, checkpoint } = claim.item!.payload, settings = claim.snapshot.settings;
        if (!checkpoint || !(['load_more', 'scroll'].includes(config.pagination.mode) || checkpoint.advance))
            return null;
        if (!sameTab)
            throw new Error('incomplete');
        const advance = await inject(discoverPage, [{
                config, rules: settings.blockRules, action: 'advance', page: checkpoint.page + 1
            }]);
        if (advance.blocked)
            return advance;
        await sleep(Math.max(50, config.pagination.waitAfterMs));
        await this.navigation.wait(origins, settings.timeoutMs);
        return null;
    }
    private allowedLink(value: string, origins: string[]) {
        try {
            return origins.includes(new URL(value).origin);
        }
        catch {
            return false;
        }
    }
    private linkIdentity(links: string[], rules: any[]) {
        return links.map(value => {
            const u = new URL(value);
            u.search = '';
            u.hash = '';
            for (const rule of rules) {
                if (rule.type !== 'remove_path_suffix')
                    continue;
                const at = u.pathname.indexOf(rule.marker);
                if (at >= 0)
                    u.pathname = u.pathname.slice(0, at) || '/';
            }
            return u.href;
        }).sort((a,b)=>a.localeCompare(b,'en')).join('\n');
    }
    private async discoveryCheckpoint(claim: CatalogClaim, result: any, links: string[]) {
        const { config, checkpoint } = claim.item!.payload, page = (checkpoint?.page ?? 0) + 1;
        const identity = this.linkIdentity(links, claim.snapshot.market.normalizationRules ?? []);
        const fingerprint = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))), seen = checkpoint?.seen ?? [], found = (checkpoint?.found ?? 0) + links.length;
        const repeated = seen.includes(fingerprint), noProgress = repeated ? (checkpoint?.noProgress ?? 0) + 1 : 0;
        const repeatedPage = ['next', 'url'].includes(config.pagination.mode) && repeated;
        const limit = page >= config.limits.maxPages || found >= config.limits.maxItems;
        const done = result.done || repeatedPage || limit || noProgress >= config.pagination.noProgressLimit;
        const advance = !done && config.pagination.mode === 'next' && !result.nextUrl;
        return {
            outcome: 'success', links: links.slice(0, Math.max(0, config.limits.maxItems - (checkpoint?.found ?? 0))), done, checkpoint: {
                url: result.nextUrl ?? result.url, page, seen: [...seen, fingerprint].slice(-1000), found: Math.min(found, config.limits.maxItems), noProgress, advance
            }
        };
    }
    private async discover(claim: CatalogClaim, inject: (func: any, args: any[]) => Promise<any>, origins: string[], sameTab: boolean) {
        const { config, checkpoint } = claim.item!.payload;
        if (config.rendering.frameSelector)
            throw new Error('configuration');
        const advance = await this.advanceDiscovery(claim, inject, origins, sameTab);
        if (advance)
            return advance;
        const result = await inject(discoverPage, [{
                config, rules: claim.snapshot.settings.blockRules, action: 'read', page: (checkpoint?.page ?? 0) + 1
            }]);
        if (result.blocked)
            return result;
        const links = result.links.filter((value: string) => this.allowedLink(value, origins));
        const invalid = result.invalid || links.length !== result.links.length;
        if (invalid && discoveryPolicy(config, 'invalidItem', 5).action !== 'skip_item')
            throw new Error('invalidItem');
        return this.discoveryCheckpoint(claim, result, links);
    }
    private discoveryDeadline(claim: CatalogClaim) {
        const { config, checkpoint: previous, startedAt } = claim.item!.payload;
        if (!startedAt || !config.limits.maxDurationSeconds || (Date.now() - Date.parse(startedAt)) <= config.limits.maxDurationSeconds * 1000)
            return null;
        if (config.failures?.limitReached === 'pause_source')
            return {
                outcome: 'technical_failure', reason: 'incomplete', failureType: 'limit'
            };
        return {
            outcome: 'success', links: [], done: true, checkpoint: {
                url: previous?.url ?? claim.item!.payload.url, page: (previous?.page ?? 0) + 1, seen: previous?.seen ?? [], found: previous?.found ?? 0, noProgress: previous?.noProgress ?? 0
            }
        };
    }
    private discoveryFailure(claim: CatalogClaim, kind: string, action: string) {
        const { config, checkpoint: previous } = claim.item!.payload;
        if (action === 'skip_page' && config.pagination.mode === 'url') {
            const page = (previous?.page ?? 0) + 1, url = config.pagination.urlTemplate.replaceAll('{page}', String(config.pagination.startPage + page * config.pagination.pageStep));
            return {
                outcome: 'success', links: [], done: page >= config.limits.maxPages, reason: 'incomplete', failureType: kind, checkpoint: {
                    url, page, seen: previous?.seen ?? [], found: previous?.found ?? 0, noProgress: previous?.noProgress ?? 0
                }
            };
        }
        return {
            outcome: 'technical_failure', reason: 'incomplete', failureType: kind
        };
    }
    private discoveryAttemptFailure(claim:CatalogClaim,error:unknown,attempt:number){
        const message=error instanceof Error?error.message:'navigation';
        if(['permission','tab_closed','interrupted','access_denied'].includes(message))throw error;
        if(message==='limit')return {retry:false,delayMs:0,result:this.discoveryFailure(claim,'limit','stop_section')};
        const kind=failureKind(message),policy=discoveryPolicy(claim.item!.payload.config,kind,attempt);
        return {retry:policy.retry,delayMs:policy.delayMs,result:this.discoveryFailure(claim,kind,policy.action)};
    }
    private async executeWithPolicy(claim: CatalogClaim): Promise<any> {
        if (claim.step !== 'discover')
            return this.execute(claim);
        const deadline = this.discoveryDeadline(claim);
        if (deadline)
            return deadline;
        const generation = this.generation;
        for (let attempt = 0; attempt <= 5; attempt++) {
            if (generation !== this.generation)
                throw new Error('interrupted');
            try {
                return await this.execute(claim);
            }
            catch (error) {
                const failure=this.discoveryAttemptFailure(claim,error,attempt);
                if(!failure.retry)return failure.result;
                await sleep(failure.delayMs);
            }
        }
        throw new Error('incomplete');
    }
    private async consumeClaim(run: CatalogRun, claim: CatalogClaim, generation: number) {
        const currentItem = claim.item!;
        await this.api('/catalog/runs/' + run.id + '/heartbeat', {
            itemId: currentItem.id, leaseToken: currentItem.lease_token
        });
        const heart = setInterval(() => {
            void this.api('/catalog/runs/' + run.id + '/heartbeat', {
                itemId: currentItem.id, leaseToken: currentItem.lease_token
            }).catch(() => {
            });
        }, 45000);
        let result: any;
        try {
            result = await this.executeWithPolicy(claim);
        }
        finally {
            clearInterval(heart);
        }
        if (generation !== this.generation)
            return;
        if (result.blocked) {
            await this.action('human', result.blocked);
            this.state.message = 'Intervenção necessária: ' + result.blocked + '. Abra a janela de processamento e depois clique em Continuar.';
            await this.save();
            return;
        }
        this.state.pendingResult = {
            itemId: currentItem.id, leaseToken: currentItem.lease_token, ...result
        };
        await this.save();
        await this.api('/catalog/runs/' + run.id + '/results', this.state.pendingResult);
        delete this.state.pendingResult;
        delete this.state.claim;
        this.state.nextAt = Date.now() + this.itemInterval(claim);
        this.state.run = await this.api('/catalog/runs/' + run.id);
        if(this.state.run&&['completed','failed','cancelled'].includes(this.state.run.status))this.statsAt=0;
        this.state.message = 'Resultado salvo.';
        await this.save();
    }
    private itemInterval(claim: CatalogClaim) {
        let interval = claim.snapshot.settings.intervalMs;
        if (claim.step === 'discover')
            interval = Math.max(interval, claim.item!.payload.config.limits.requestIntervalMs);
        if (claim.step === 'convert')
            interval = Math.max(interval, claim.snapshot.settings.recipe.intervalMs);
        return interval;
    }
    private async pumpRun(run: CatalogRun) {
        if (['completed', 'cancelled', 'failed'].includes(run.status)) return;
        if (['queued', 'running'].includes(run.status) && (this.state.nextAt ?? 0) > Date.now())
            return;
        await this.syncRun();
        if (!this.state.run || this.state.run.id !== run.id) return;
        if (!['queued', 'running'].includes(this.state.run.status) || ((this.state.nextAt ?? 0) > Date.now()))
            return;
        const generation = this.generation;
        if (this.state.pendingResult) {
            await this.api('/catalog/runs/' + run.id + '/results', this.state.pendingResult);
            delete this.state.pendingResult;
            delete this.state.claim;
            await this.save();
        }
        if (!this.state.claim) {
            this.state.claim = await this.api<CatalogClaim>('/catalog/runs/' + run.id + '/claim', {});
            await this.save();
        }
        const claim = this.state.claim;
        if (!claim?.item) {
            delete this.state.claim;
            this.state.run = await this.api('/catalog/runs/' + run.id);
            this.statsAt=0;
            this.state.nextAt = Date.now() + 30000;
            await this.save();
            return;
        }
        await this.consumeClaim(run, claim, generation);
    }
    private async pauseOnFailure(error: unknown) {
        const reason = error instanceof Error ? error.message : '';
        this.state.error = reason || 'Não foi possível continuar o processamento.';
        this.state.message = 'O processamento encontrou um erro. Confira a notificação e tente novamente.';
        if (this.state.auth && this.state.run && ['queued', 'running'].includes(this.state.run.status)) {
            const code = ['permission', 'tab_closed', 'incomplete'].includes(reason) ? reason : 'network';
            try {
                await this.action('technical', code);
            }
            catch {
                if (this.state.run)
                    this.state.run.status = 'paused_technical';
                this.state.locallyPaused = true;
            }
        }
        await this.save();
    }
    private schedulePump() {
        this.pumping = false;
        clearTimeout(this.timer);
        if (this.state.auth && !this.state.locallyPaused && this.state.run && ['queued', 'running'].includes(this.state.run.status))
            this.timer = setTimeout(() => {
                void this.pump();
            }, Math.max(100, (this.state.nextAt ?? 0) - Date.now()));
    }
    async pump() {
        await this.init();
        if (this.pumping)
            return;
        this.pumping = true;
        try {
            if (this.state.pair)
                await this.poll();
            const run = this.state.run;
            if (!this.state.auth || !run || this.state.locallyPaused)
                return;
            await this.pumpRun(run);
        }
        catch (error) {
            await this.pauseOnFailure(error);
        }
        finally {
            this.schedulePump();
        }
    }
}
