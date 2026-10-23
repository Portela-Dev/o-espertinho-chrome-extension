import { OpenAISession, LocalError } from './shared/openai-session.mjs';
export class PersistentAiSession extends OpenAISession {
  private saved: any = { revision: '', sessionId: '', model: '', models: [] };
  constructor(
    options: any,
    private readonly browser: typeof chrome = chrome,
  ) {
    super(options);
  }
  private async call(operation: string, payload: any = {}) {
    const generation = this.generation;
    const reply = await this.browser.runtime.sendMessage({
      type: 'AI_SESSION',
      operation,
      payload,
    });
    if (generation !== this.generation)
      throw new LocalError('Sessão ChatGPT encerrada ou alterada.');
    if (reply.error) throw new LocalError(reply.error);
    return reply.value;
  }
  async sync() {
    const record = await this.call('snapshot');
    if (!record || typeof record.revision !== 'string')
      throw new LocalError('Sessão local indisponível.');
    this.saved = record;
    this.active = record.account;
    return record;
  }
  preference() {
    return {
      sessionId: this.saved.sessionId,
      model: this.saved.model,
      models: this.saved.models,
    };
  }
  async begin(redirectUri: string, accountId?: string) {
    await this.sync();
    return super.begin(redirectUri, accountId);
  }
  async callback(params: URLSearchParams) {
    const revision = this.saved.revision;
    await super.callback(params);
    const generation = this.generation;
    const fields = [
      'clientId',
      'subject',
      'email',
      'access_token',
      'refresh_token',
      'scope',
      'token_type',
      'expires_in',
      'expiresAt',
      'earliest_refresh_at',
    ];
    const credentials = Object.fromEntries(
      fields
        .filter((k) => this.active[k] !== undefined)
        .map((k) => [k, this.active[k]]),
    );
    const record = await this.call('install', { revision, credentials });
    if (generation !== this.generation)
      throw new LocalError('Login interrompido.');
    this.saved = record;
    this.active = record.account;
  }
  async token() {
    return (await this.call('token', { sessionId: this.saved.sessionId }))
      .accessToken;
  }
  async models() {
    const record = await this.call('models', {
      sessionId: this.saved.sessionId,
    });
    this.saved = record;
    this.active = record.account;
    return record.models;
  }
  async selectModel(model: string) {
    this.saved = await this.call('selectModel', {
      sessionId: this.saved.sessionId,
      model,
    });
  }
  async signout() {
    this.generation++;
    this.active = null;
    this.pending = null;
    this.loginError = '';
    this.saved = { revision: '', sessionId: '', model: '', models: [] };
    return this.call('disconnect');
  }
}
