import { OpenAISession, LocalError } from './shared/openai-session.mjs';
import { AiVault, emptyAiSession, type AiSavedSession } from './ai-vault.js';
const credentialFields = [
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
const publicRecord = (r: AiSavedSession) => ({
  revision: r.revision,
  sessionId: r.sessionId,
  account: r.credentials
    ? {
        clientId: r.credentials.clientId,
        subject: r.credentials.subject,
        email: r.credentials.email,
        scope: r.credentials.scope,
      }
    : null,
  model: r.model,
  models: r.models,
});
export class AiSessionBroker {
  private modelCache: { sessionId: string; expires: number } | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly authorize: () => Promise<void>,
    private readonly vault: Pick<AiVault, 'load' | 'save'> = new AiVault(),
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {}
  handle(operation: string, payload: any = {}) {
    const work = this.tail
      .catch(() => {})
      .then(() => this.execute(operation, payload));
    this.tail = work;
    return work;
  }
  private async execute(operation: string, p: any) {
    if (!p || typeof p !== 'object' || Array.isArray(p))
      throw new LocalError('Operação de sessão inválida.');
    const allowed: Record<string, string[]> = {
      snapshot: [],
      install: ['revision', 'credentials'],
      token: ['sessionId'],
      models: ['sessionId', 'cached'],
      selectModel: ['sessionId', 'model'],
      disconnect: [],
    };
    if (
      !allowed[operation] ||
      Object.keys(p).some((k) => !allowed[operation].includes(k))
    )
      throw new LocalError('Operação de sessão inválida.');
    const record = await this.vault.load();
    if (operation === 'snapshot') return publicRecord(record);
    if (operation === 'disconnect') {
      this.modelCache = undefined;
      await this.vault.save(emptyAiSession());
      const session = this.session(record);
      return record.credentials ? session.signout() : { revoked: true };
    }
    await this.authorize();
    if (operation === 'install') {
      this.modelCache = undefined;
      return this.installSession(p, record);
    }
    if (!record.credentials || p.sessionId !== record.sessionId)
      throw new LocalError(
        'Sessão ChatGPT encerrada ou alterada. Entre novamente.',
      );
    if (
      operation === 'models' &&
      p.cached === true &&
      this.modelCache?.sessionId === record.sessionId &&
      this.modelCache.expires > this.now()
    )
      return publicRecord(record);
    const session = this.session(record);
    if (operation === 'selectModel') {
      if (
        typeof p.model !== 'string' ||
        !record.models.some((m) => m.id === p.model)
      )
        throw new LocalError('Escolha um modelo disponível nesta conta.');
      return publicRecord(await this.vault.save({ ...record, model: p.model }));
    }
    return this.refreshSession(operation, record, session);
  }
  private async refreshSession(
    operation: string,
    record: AiSavedSession,
    session: OpenAISession,
  ) {
    try {
      const token = await session.token();
      // Persist rotation before any subsequent provider request can fail.
      if (session.active !== record.credentials)
        await this.vault.save({
          ...record,
          credentials: this.credentials(session.active),
        });
      if (operation === 'token') return { accessToken: token };
      const models = await session.models();
      this.modelCache = {
        sessionId: record.sessionId,
        expires: this.now() + 600000,
      };
      const updated = {
        ...record,
        credentials: this.credentials(session.active),
        models,
        model: models.some((m: any) => m.id === record.model)
          ? record.model
          : '',
      };
      return { ...publicRecord(await this.vault.save(updated)), models };
    } catch (error) {
      if (
        (error as any).status === 401 ||
        (error as any).code === 'invalid_grant'
      )
        await this.vault.save(emptyAiSession());
      throw error;
    }
  }
  private credentials(active: any) {
    return Object.fromEntries(
      credentialFields
        .filter((k) => active[k] !== undefined)
        .map((k) => [k, active[k]]),
    );
  }
  private session(record: AiSavedSession) {
    const session = new OpenAISession({
      hostId: '',
      fetcher: this.fetcher,
      now: this.now,
    });
    session.active = record.credentials;
    return session;
  }

  private async installSession(p: any, record: AiSavedSession) {
    const c = p.credentials;
    if (p.revision !== record.revision)
      throw new LocalError('A sessão foi alterada. Inicie o login novamente.');
    if (
      !c ||
      Object.keys(c).some((k) => !credentialFields.includes(k)) ||
      !['clientId', 'subject', 'email', 'scope'].every(
        (k) => typeof c[k] === 'string',
      ) ||
      !c.subject ||
      !/^[-\w]{1,250}$/.test(c.clientId) ||
      !Number.isFinite(c.expiresAt)
    )
      throw new LocalError('Credenciais locais inválidas.');
    this.session({ ...record, credentials: c }).validateTokens(c);
    const credentials = Object.fromEntries(
      credentialFields.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]),
    );
    return publicRecord(
      await this.vault.save({
        ...emptyAiSession(),
        sessionId: crypto.randomUUID(),
        credentials,
      }),
    );
  }
}
