import { ReviewAiInventory, decideReview } from './review-ai-inventory.js';
export type AiTask = 'category' | 'product';
export type ReviewTransport = (
  operation:
    | 'config'
    | 'queue'
    | 'context'
    | 'result'
    | 'release'
    | 'inventory',
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
    status: 'idle',
    title: '',
  };
  private sequence = 0;
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
    if (!model) throw new Error('Escolha um modelo da conta ChatGPT.');
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
      status: 'running',
      title: '',
    };
    this.changed();
    const current = () => {
      if (generation !== this.sequence)
        throw new Error('Revisão por IA cancelada.');
    };
    try {
      const config = await this.refresh(marketplaceId);
      current();
      if (
        !config.settings[
          task === 'category' ? 'categoryEnabled' : 'productEnabled'
        ]
      )
        throw new Error('Esta tarefa de IA está desativada no admin.');
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
