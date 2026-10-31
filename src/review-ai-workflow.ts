import { analysisFailure } from './analysis-failure.js';
export type AiTask = 'category' | 'product';
export type ReviewTransport = (operation: 'config' | 'resolverStart' | 'resolverClaim' | 'resolverComplete' | 'resolverAction', payload: any) => Promise<any>;
const phase = (context: any) => ({ type: 'Identificando o tipo', identity: 'Identificando produto', match: 'Comparando produtos', category: 'Definindo categoria' }[context.stage as string] ?? 'Processando oferta');
export class ReviewAiWorkflow {
  config: any;
  marketplaceId = '';
  busy = false;
  progress = { task: 'product' as AiTask, completed: 0, total: 0, failed: 0, skipped: 0, fallback: 0, status: 'idle', mode: 'active', title: '' };
  private sequence = 0;
  private resolverRunId = '';
  private requestKey = '';
  private resolverScope = '';
  private consecutiveFailures = 0;
  private providerFailure = '';
  constructor(private readonly transport: ReviewTransport, private readonly analyze: (input: any) => Promise<any>, private readonly changed: () => void = () => {}) {}
  async refresh(marketplaceId: string) {
    this.config = await this.transport('config', { marketplaceId });
    this.marketplaceId = marketplaceId;
    this.changed();
    return this.config;
  }
  cancel() {
    this.sequence++;
    if (this.resolverRunId) void this.transport('resolverAction', { runId: this.resolverRunId, action: 'pause' }).catch(() => {});
    if (this.busy) { this.progress.status = 'cancelled'; this.progress.title = 'Interrompida pelo usuário; pode ser retomada'; this.changed(); }
  }
  async run(task: AiTask, marketplaceId: string, limit: number, model: string) {
    if (this.busy) throw new Error('Já existe uma catalogação em andamento.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Informe um limite entre 1 e 10000.');
    this.busy = true;
    const generation = ++this.sequence;
    this.progress = { task, completed: 0, total: 0, failed: 0, skipped: 0, fallback: 0, status: 'running', mode: 'active', title: '' };
    this.consecutiveFailures = 0;
    this.providerFailure = '';
    const current = () => { if (generation !== this.sequence) throw new Error('Processamento interrompido pelo usuário.'); };
    this.changed();
    try {
      const config = await this.refresh(marketplaceId);
      current();
      this.progress.mode = config.resolver?.mode ?? '';
      if (config.resolver?.protocolVersion !== 3) throw new Error('Atualize o backend e a extensão para o fluxo de catalogação completa.');
      if (!config.settings[task === 'category' ? 'categoryEnabled' : 'productEnabled']) throw new Error('Esta tarefa de IA está desativada no admin.');
      if (!model) throw new Error('Conecte a IA e selecione um modelo.');
      await this.runStructured(task, marketplaceId, limit, model, current);
      current();
      this.progress.status = 'completed';
      this.progress.title = this.progress.mode === 'shadow' ? 'Simulação concluída; nenhuma alteração salva' : 'Processamento concluído';
      await this.refresh(marketplaceId);
    } catch (error) {
      if (generation === this.sequence) {
        this.progress.status = 'paused';
        this.progress.title = 'Interrupção técnica; os itens permanecem disponíveis para retomar';
        if (this.resolverRunId) await this.transport('resolverAction', { runId: this.resolverRunId, action: 'pause' }).catch(() => {});
      }
      throw error;
    } finally { this.busy = false; this.changed(); }
  }
  private async runStructured(task: AiTask, marketplaceId: string, limit: number, model: string, current: () => void) {
    const scope = marketplaceId + ':' + task;
    if (scope !== this.resolverScope || !this.requestKey) { this.requestKey = crypto.randomUUID(); this.resolverScope = scope; }
    let run = await this.transport('resolverStart', { marketplaceId, task, limit, requestKey: this.requestKey });
    if (['completed', 'cancelled'].includes(run.status)) {
      this.requestKey = crypto.randomUUID();
      run = await this.transport('resolverStart', { marketplaceId, task, limit, requestKey: this.requestKey });
    }
    this.resolverRunId = run.id;
    if (run.status === 'paused') await this.transport('resolverAction', { runId: run.id, action: 'resume' });
    const count = Math.min(2, Math.max(1, this.config.resolver.concurrency ?? 1));
    let failure: unknown;
    const check = () => { current(); if (failure) throw failure; };
    await Promise.all(Array.from({ length: count }, async () => {
      try { await this.worker(run.id, model, check); } catch (error) { failure ??= error; }
    }));
    if (failure) throw failure;
    this.requestKey = '';
    this.resolverRunId = '';
  }
  private async worker(runId: string, model: string, current: () => void) {
    while (true) {
      current();
      const response = await this.transport('resolverClaim', { runId });
      current();
      const stats = response.run.stats;
      this.progress.total = stats.total;
      this.progress.completed = Math.max(this.progress.completed, stats.accepted);
      this.progress.skipped = Math.max(this.progress.skipped, stats.skipped ?? 0);
      this.progress.fallback = Math.max(this.progress.fallback, stats.fallback ?? 0);
      this.changed();
      if (response.run.status === 'completed') {
        if (stats.failed > 0) throw new Error('Existem itens antigos com falha; retome a execução para recuperá-los.');
        return;
      }
      if (response.run.status !== 'running') throw new Error('Execução interrompida no admin; os itens foram preservados.');
      if (response.advance) continue;
      if (!response.item) { await new Promise(r => setTimeout(r, 1000)); continue; }
      await this.item(runId, response.item, model, current);
    }
  }
  private async item(runId: string, item: any, model: string, current: () => void) {
    const context = item.context;
    if (!context.enabled) throw new Error('Esta tarefa de IA está desativada no admin.');
    const start = Date.now();
    this.progress.title = phase(context);
    this.changed();
    let decision = item.deterministic, tokens = 0, diagnostic = this.providerFailure, usedModel = '';
    if (context.stage === 'category' && (context.mappedCategoryId ?? context.defaultCategoryId)) decision = { categoryId: context.mappedCategoryId ?? context.defaultCategoryId, path: [], reason: 'Categoria configurada ou mapeada no admin.' };
    if (decision) diagnostic = '';
    if (!decision && !diagnostic) {
      try {
        usedModel = model;
        const analysis = await this.analyze({ task: 'resolver', context, model });
        decision = analysis.decision ?? analysis;
        tokens = analysis.metrics?.tokens ?? 0;
        this.consecutiveFailures = 0;
      } catch (error) {
        current();
        const failure = analysisFailure(error);
        diagnostic = failure.code;
        this.progress.title = failure.label + '; concluindo pelos dados da oferta';
        if (++this.consecutiveFailures >= 2 || ['authentication', 'usage_limit'].includes(diagnostic)) this.providerFailure = diagnostic;
        this.changed();
      }
    }
    current();
    const payload = { runId, itemId: item.id, leaseId: item.leaseId, model: usedModel, tokens, elapsedMs: Math.min(Date.now() - start, 300000) };
    await this.save({ ...payload, ...(diagnostic ? { error: 'technical', errorCode: 'analysis_failed', diagnostic } : { decision }) }, current);
    this.changed();
  }
  private async save(payload: any, current: () => void) {
    // A lost response retries the same decision; never infer again or substitute a different payload.
    try { return await this.transport('resolverComplete', payload); }
    catch {
      current();
      await new Promise(r => setTimeout(r, 1000));
      current();
      return this.transport('resolverComplete', payload);
    }
  }
}
