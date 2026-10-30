import { ReviewAiInventory, decideReview } from './review-ai-inventory.js';
export type AiTask = 'category' | 'product';
type StructuredFailureCode = 'analysis_failed' | 'result_rejected';
const structuredFailureMessages: Record<StructuredFailureCode, string> = {
  result_rejected: 'Resultado recusado ao validar ou salvar; repetição limitada',
  analysis_failed: 'Falha na análise de IA; repetição limitada',
};
function structuredPhase(context: any, mode: string) {
  let phase = 'Identificando produto do link';
  if (context.preparation) phase = 'Preparando candidato relacionado ao link';
  else if (context.stage === 'category') phase = 'Definindo categoria do produto';
  return (mode === 'shadow' ? 'Simulação · ' : '') + phase;
}
export type ReviewTransport = (
  operation:
    | 'config'
    | 'queue'
    | 'context'
    | 'result'
    | 'release'
    | 'inventory'
    | 'prepare'
    | 'resolverStart'
    | 'resolverClaim'
    | 'resolverComplete'
    | 'resolverAction',
  payload: any,
) => Promise<any>;
export class ReviewAiWorkflow {
  config: any;
  marketplaceId = '';
  busy = false;
  progress = {
    task: 'category' as AiTask,
    completed: 0,
    total: 0,
    failed: 0,
    pending: 0,
    invalid: 0,
    excluded: 0,
    status: 'idle',
    mode: 'legacy',
    title: '',
  };
  private sequence = 0;
  private resolverRunId = '';
  private requestKey = '';
  private resolverScope = '';
  constructor(
    private readonly transport: ReviewTransport,
    private readonly analyze: (input: any) => Promise<any>,
    private readonly changed: () => void = () => {},
  ) {}
  async refresh(marketplaceId: string) {
    const data = await this.transport('config', { marketplaceId });
    this.marketplaceId = marketplaceId;
    this.config = data;
    this.changed();
    return data;
  }
  cancel() {
    this.sequence++;
    if (this.resolverRunId)
      void this.transport('resolverAction', {
        runId: this.resolverRunId,
        action: 'pause',
      }).catch(() => {});
    if (this.busy) {
      this.progress.status = 'cancelled';
      this.changed();
    }
  }
  async run(
    task: AiTask,
    marketplaceId: string,
    limit: number,
    model: string,
    retryReview = false,
  ) {
    if (this.busy) throw new Error('Já existe uma revisão de IA em andamento.');

    if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
      throw new Error('Informe um limite entre 1 e 10000.');
    this.busy = true;
    const generation = ++this.sequence;
    this.progress = {
      task,
      completed: 0,
      total: 0,
      failed: 0,
      pending: 0,
      invalid: 0,
      excluded: 0,
      status: 'running',
      mode: 'legacy',
      title: '',
    };
    this.changed();
    const current = () => {
      if (generation !== this.sequence)
        throw new Error('Revisão por IA cancelada.');
    };
    try {
      const config = await this.refresh(marketplaceId);
      this.progress.mode = config.resolver?.mode ?? 'legacy';
      current();
      if (config.resolver && config.resolver.mode !== 'legacy') {
        await this.runStructured(task, marketplaceId, limit, model, current);
        this.progress.status = 'completed';
        await this.refresh(marketplaceId);
        return;
      }
      if (
        !config.settings[
          task === 'category' ? 'categoryEnabled' : 'productEnabled'
        ]
      )
        throw new Error('Esta tarefa de IA está desativada no admin.');
      if (!model) throw new Error('Escolha um modelo da conta ChatGPT.');
      const inventory = new ReviewAiInventory();
      this.progress.title = 'Carregando todo o inventário';
      this.changed();
      await inventory.load(this.transport, current);
      const queue = await this.transport('queue', {
        marketplaceId,
        task,
        limit,
        retryReview,
      });
      current();
      this.progress.total = queue.items.length;
      this.changed();
      for (const link of queue.items) {
        current();
        await this.processLink(
          link,
          task,
          inventory,
          model,
          retryReview,
          current,
        );
      }
      this.progress.status = 'completed';
      await this.refresh(marketplaceId);
    } catch (error) {
      if (generation === this.sequence) {
        this.progress.failed++;
        this.progress.status = 'failed';
      }
      throw error;
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  private async runStructured(
    task: AiTask,
    marketplaceId: string,
    limit: number,
    model: string,
    current: () => void,
  ) {
    let cursor: string | null = null;
    this.progress.title = 'Preparando identidades existentes';
    this.changed();
    do {
      current();
      const page = await this.transport('prepare', { cursor });
      cursor = page.nextCursor;
    } while (cursor);
    const scope = marketplaceId + ':' + task;
    if (scope !== this.resolverScope) {
      this.requestKey = crypto.randomUUID();
      this.resolverScope = scope;
    }
    if (!this.requestKey) this.requestKey = crypto.randomUUID();
    const run = await this.transport('resolverStart', {
      marketplaceId,
      task,
      limit,
      requestKey: this.requestKey,
    });
    this.resolverRunId = run.id;
    if (run.status === 'paused')
      await this.transport('resolverAction', {
        runId: run.id,
        action: 'resume',
      });
    const count = Math.min(
      2,
      Math.max(1, this.config.resolver.concurrency ?? 1),
    );
    let failure: unknown;
    const check = () => {
      current();
      if (failure) throw failure;
    };
    const workers = Array.from({ length: count }, async () => {
      try {
        await this.structuredWorker(run, model, check);
      } catch (error) {
        failure ??= error;
      }
    });
    await Promise.all(workers);
    if (failure) {
      await this.transport('resolverAction', {
        runId: run.id,
        action: 'pause',
      }).catch(() => {});
      throw failure;
    }
  }
  private async structuredWorker(run: any, model: string, current: () => void) {
    while (true) {
      current();
      const response = await this.transport('resolverClaim', { runId: run.id });
      current();
      const stats = response.run.stats;
      this.progress.total = stats.total;
      this.progress.completed = Math.max(
        this.progress.completed,
        stats.accepted,
      );
      this.progress.excluded = Math.max(this.progress.excluded, stats.excluded);
      this.progress.failed = Math.max(this.progress.failed, stats.failed);
      this.progress.title =
        run.mode === 'shadow'
          ? 'Simulação — nenhuma decisão altera o catálogo'
          : 'Resolução estruturada';
      this.changed();
      if (response.run.status === 'completed') {
        this.requestKey = '';
        this.resolverRunId = '';
        break;
      }
      if (response.run.status !== 'running')
        throw new Error('Execução pausada ou cancelada no admin.');
      if (response.advance) continue;
      if (!response.item) {
        this.progress.title += ' · aguardando reserva disponível';
        this.changed();
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      await this.structuredItem(run.id, response.item, model, current);
    }
  }
  private async structuredItem(
    runId: string,
    item: any,
    model: string,
    current: () => void,
  ) {
    if (
      item.context.enabled &&
      !item.deterministic &&
      !item.context.defaultCategoryId &&
      !model
    )
      throw new Error('Conecte a IA e selecione um modelo para continuar.');
    const start = Date.now(),
      context = item.context;
    this.progress.title = structuredPhase(context, this.config.resolver.mode);
    this.changed();
    let decision = item.deterministic,
      usedModel = '',
      tokens = 0;
    let errorCode: StructuredFailureCode = 'analysis_failed';
    if (context.stage === 'category' && context.defaultCategoryId)
      decision = {
        categoryId: context.defaultCategoryId,
        path: [],
        exclude: false,
        reason: 'Categoria definida na política.',
      };
    try {
      if (!decision) {
        if (!context.enabled)
          decision =
            context.stage === 'category'
              ? {
                  categoryId: null,
                  path: [],
                  exclude: true,
                  reason: 'Sem regra determinística e IA da tarefa desativada.',
                }
              : {
                  policyId: context.policy.id,
                  facts: {},
                  exclude: true,
                  reason:
                    'Sem identidade determinística e IA da tarefa desativada.',
                };
        else {
          if (!model)
            throw new Error(
              'Conecte a IA e selecione um modelo para as tarefas sem regra determinística.',
            );
          usedModel = model;
          const analysis = await this.analyze({
            task: 'resolver',
            context,
            model,
          });
          decision = analysis.decision ?? analysis;
          tokens = analysis.metrics?.tokens ?? 0;
        }
      }
      current();
      errorCode = 'result_rejected';
      await this.transport('resolverComplete', {
        runId,
        itemId: item.id,
        leaseId: item.leaseId,
        decision,
        model: usedModel,
        tokens,
        elapsedMs: Date.now() - start,
      });
    } catch {
      // Provider/validation errors become bounded technical retries; never forward raw provider errors or credentials to the backend.
      current();
      this.progress.title = structuredFailureMessages[errorCode];
      this.changed();
      await this.transport('resolverComplete', {
        runId,
        itemId: item.id,
        leaseId: item.leaseId,
        error: 'technical',
        errorCode,
        model: usedModel,
        elapsedMs: Math.min(Date.now() - start, 300000),
      });
    }
  }
  private async processLink(
    link: any,
    task: AiTask,
    inventory: ReviewAiInventory,
    model: string,
    retryReview: boolean,
    current: () => void,
  ) {
    let requestId: string | undefined,
      saved = false;
    try {
      this.progress.title = link.title || 'Oferta';
      this.changed();
      const context = await this.transport('context', {
        id: link.id,
        task,
        inventoryRevision: inventory.revision,
        retryReview,
      });
      requestId = context.requestId;
      current();
      const suggestion = await decideReview(
        context,
        inventory,
        model,
        this.analyze,
        current,
      );
      current();
      if (!suggestion)
        throw new Error('A análise não retornou uma sugestão válida.');
      const result = await this.transport('result', {
        requestId,
        model,
        suggestion,
      });
      saved = true;
      current();
      inventory.merge(result.inventory);
      if (result.applied) this.progress.completed++;
      else if (result.outcome === 'invalid') this.progress.invalid++;
      else this.progress.pending++;
      this.changed();
    } finally {
      if (requestId && !saved)
        await this.transport('release', { requestId }).catch(() => {});
    }
  }
}
