import { LocalError } from './shared/openai-session.mjs';
export const AI_VAULT_KEY = 'directAiSessionV1';
export interface AiSavedSession {
  revision: string;
  sessionId: string;
  credentials: any;
  model: string;
  models: { id: string; name: string }[];
}
export const emptyAiSession = (): AiSavedSession => ({
  revision: crypto.randomUUID(),
  sessionId: '',
  credentials: null,
  model: '',
  models: [],
});
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.codePointAt(0)!);
const encoded = (value: Uint8Array) => btoa(String.fromCodePoint(...value));
export class AiVault {
  private keyPromise?: Promise<CryptoKey>;
  constructor(
    private readonly browser: typeof chrome = chrome,
    private readonly keyProvider?: () => Promise<CryptoKey>,
  ) {}
  private key() {
    this.keyPromise ??= this.keyProvider ? this.keyProvider() : this.localKey();
    return this.keyPromise;
  }
  private async localKey(): Promise<CryptoKey> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('espertinho-ai-vault', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Vault unavailable'));
    });
    try {
      const current = await new Promise<CryptoKey | undefined>(
        (resolve, reject) => {
          const tx = db.transaction('keys');
          const r = tx.objectStore('keys').get('session');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error ?? new Error('Vault read failed'));
        },
      );
      if (current) return current;
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').put(key, 'session');
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error('Vault transaction failed'));
        tx.onabort = () =>
          reject(tx.error ?? new Error('Vault transaction failed'));
      });
      return key;
    } finally {
      db.close();
    }
  }
  async load(): Promise<AiSavedSession> {
    await this.browser.storage.local.setAccessLevel({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    const raw = (await this.browser.storage.local.get(AI_VAULT_KEY))[
      AI_VAULT_KEY
    ] as any;
    if (!raw) return this.save(emptyAiSession());
    try {
      if (raw.version !== 1 || typeof raw.revision !== 'string')
        throw new Error('Invalid operation data.');
      if (raw.sealed === null)
        return { ...emptyAiSession(), revision: raw.revision };
      if (
        typeof raw.sealed !== 'string' ||
        raw.sealed.length > 100000 ||
        typeof raw.iv !== 'string'
      )
        throw new Error('Invalid operation data.');
      const data = JSON.parse(
        new TextDecoder().decode(
          await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: bytes(raw.iv),
              additionalData: new TextEncoder().encode(raw.revision),
            },
            await this.key(),
            bytes(raw.sealed),
          ),
        ),
      );
      const c = data.credentials;
      if (
        !c ||
        ![
          'clientId',
          'subject',
          'email',
          'access_token',
          'refresh_token',
          'scope',
          'token_type',
        ].every((k) => typeof c[k] === 'string') ||
        !c.clientId ||
        !c.subject ||
        !c.access_token ||
        !c.refresh_token ||
        !Number.isFinite(c.expiresAt) ||
        typeof data.sessionId !== 'string' ||
        !data.sessionId
      )
        throw new Error('Invalid operation data.');
      return {
        ...data,
        revision: raw.revision,
        model: typeof data.model === 'string' ? data.model : '',
        models: Array.isArray(data.models)
          ? data.models
              .filter(
                (m: any) =>
                  typeof m.id === 'string' && typeof m.name === 'string',
              )
              .slice(0, 100)
          : [],
      };
    } catch {
      const cleared = emptyAiSession();
      await this.save(cleared);
      throw new LocalError(
        'A sessão local não pôde ser recuperada. Entre novamente no ChatGPT.',
      );
    }
  }
  async save(record: AiSavedSession) {
    const revision = crypto.randomUUID();
    let value: any = { version: 1, revision, sealed: null };
    if (record.credentials) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const payload = JSON.stringify({ ...record, revision });
      const sealed = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: new TextEncoder().encode(revision),
        },
        await this.key(),
        new TextEncoder().encode(payload),
      );
      value = {
        ...value,
        iv: encoded(iv),
        sealed: encoded(new Uint8Array(sealed)),
      };
    }
    await this.browser.storage.local.set({ [AI_VAULT_KEY]: value });
    return { ...record, revision };
  }
}
