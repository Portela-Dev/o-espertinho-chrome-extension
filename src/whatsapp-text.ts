export interface WhatsAppTextDestination {
  bindingId: string;
  groupId: string;
  name: string;
  accountHash: string;
  documentId: string;
}
interface Draft {
  tabId: number;
  destination: WhatsAppTextDestination;
  text: string;
  expiresAt: number;
}
export interface TextAttempt {
  id: string;
  groupId: string;
  name: string;
  createdAt: string;
  status: 'started' | 'observed' | 'unknown' | 'not_sent';
  textHash: string;
}
const attemptKey = 'whatsappLastTextAttempt';

/** One explicit send to a captured group model. No composer, recipient search or retry. */
export async function sendWhatsAppText(
  input: {
    attemptId: string;
    groupId: string;
    name: string;
    accountHash: string;
    text: string;
  },
  timeoutMs = 10000,
) {
  let invoked = false,
    collection: any,
    listener: ((msg: any) => void) | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (
      location.origin !== 'https://web.whatsapp.com' ||
      !/^\d{5,30}(?:-\d{1,20})?@g\.us$/.test(input.groupId) ||
      typeof input.text !== 'string' ||
      !input.text.trim() ||
      input.text.length > 2000
    )
      throw new Error('preflight');
    const w = window as any,
      req = w.require;
    if (typeof req !== 'function') throw new Error('preflight');
    const chats = req('WAWebCollections')?.Chat,
      me = req('WAWebUserPrefsMeUser'),
      action = req('WAWebSendTextMsgChatAction')?.sendTextMsgToChat;
    const current = () => {
      const account = (me.getMaybeMePnUser?.() ?? me.getMaybeMeLidUser?.())
        ?._serialized;
      const all = chats?.getModelsArray?.();
      if (!Array.isArray(all)) throw new Error('preflight');
      const active = all.filter((c: any) => c.active === true);
      if (active.length !== 1) throw new Error('preflight');
      const chat = active[0];
      if (
        typeof account !== 'string' ||
        !/^\d{5,30}@(c\.us|s\.whatsapp\.net|lid)$/.test(account) ||
        chat.id?._serialized !== input.groupId ||
        chat.id?.server !== 'g.us' ||
        !(chat.isGroup === true || chat.id?.isGroup?.() === true) ||
        (chat.name ?? chat.formattedTitle)?.trim() !== input.name
      )
        throw new Error('preflight');
      return { account: account.replace('@s.whatsapp.net', '@c.us'), chat };
    };
    if (typeof action !== 'function') throw new Error('preflight');
    const before = current(),
      digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(before.account),
      );
    if (
      Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('') !== input.accountHash
    )
      throw new Error('preflight');
    const verified = current();
    if (verified.account !== before.account) throw new Error('preflight');
    const chat = verified.chat;
    collection = chat.msgs;
    if (
      typeof collection?.on !== 'function' ||
      typeof collection?.off !== 'function' ||
      typeof collection?.getModelsArray !== 'function'
    )
      throw new Error('preflight');
    // Only IDs of already-loaded messages are inspected; their bodies are not read.
    const baseline = new Set(
      collection.getModelsArray().map((msg: any) => msg.id?._serialized),
    );
    const matches = (msg: any) =>
      typeof msg?.id?._serialized === 'string' &&
      !baseline.has(msg.id._serialized) &&
      msg.id.fromMe === true &&
      msg.id.remote?._serialized === input.groupId &&
      msg.type === 'chat' &&
      msg.body === input.text;
    let observed: (value: { status: 'observed' }) => void = () => {};
    const observation = new Promise<{ status: 'observed' }>((resolve) => {
      observed = resolve;
    });
    listener = (msg) => {
      if (matches(msg)) observed({ status: 'observed' });
    };
    collection.on('add', listener);
    const marker = Symbol.for('o-espertinho.whatsapp.text-attempts');
    const used: Set<string> = w[marker] ?? (w[marker] = new Set());
    if (used.has(input.attemptId) || used.size >= 1000)
      throw new Error('preflight');
    // Recheck synchronously immediately before invocation; no await or recipient lookup follows.
    const final = current();
    if (final.account !== before.account || final.chat !== chat)
      throw new Error('preflight');
    used.add(input.attemptId);
    invoked = true;
    const sent = Promise.resolve(action(chat, input.text, {})).then(
      () => {
        const message = collection.getModelsArray().some(matches);
        return message ? { status: 'observed' as const } : observation;
      },
      () => ({ status: 'unknown' as const }),
    );
    const timeout = new Promise<{ status: 'unknown' }>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: 'unknown' }),
        Math.min(15000, Math.max(1, timeoutMs)),
      );
    });
    return await Promise.race([observation, sent, timeout]);
  } catch {
    return { status: invoked ? ('unknown' as const) : ('not_sent' as const) };
  } finally {
    clearTimeout(timer);
    if (listener && collection)
      try {
        collection.off('add', listener);
      } catch {
        /* Observation cleanup never triggers another send. */
      }
  }
}

export class WhatsAppTextPoc {
  private readonly drafts = new Map<string, Draft>();
  constructor(
    private readonly browser: typeof chrome,
    private readonly destination: (
      bindingId: string,
      tabId: number,
      prepare?: boolean,
    ) => Promise<WhatsAppTextDestination>,
  ) {}
  private async hash(text: string) {
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(text),
    );
    return Array.from(new Uint8Array(bytes), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  }
  async handle(operation: string, payload: any) {
    for (const [ticket, draft] of this.drafts)
      if (draft.expiresAt < Date.now()) this.drafts.delete(ticket);
    if (operation === 'text_status') return this.lastTextStatus();
    if (operation === 'cancel_text') {
      this.drafts.delete(payload.ticket);
      return { cancelled: true };
    }
    if (operation === 'preview_text') return this.previewText(payload);
    if (operation !== 'send_text')
      throw new Error('Operação de texto inválida.');
    const draft = this.drafts.get(payload.ticket);
    this.drafts.delete(payload.ticket);
    if (!draft)
      throw new Error(
        'Prévia expirada ou já utilizada. Não houve nova tentativa de envio.',
      );
    const current = await this.destination(
      draft.destination.bindingId,
      draft.tabId,
    );
    if (
      current.groupId !== draft.destination.groupId ||
      current.accountHash !== draft.destination.accountHash ||
      current.documentId !== draft.destination.documentId ||
      current.name !== draft.destination.name
    )
      throw new Error(
        'O destino ou a página mudou. Gere uma nova prévia. Nenhuma mensagem foi enviada.',
      );
    const attempt: TextAttempt = {
      id: crypto.randomUUID(),
      groupId: current.groupId,
      name: current.name,
      textHash: await this.hash(draft.text),
      createdAt: new Date().toISOString(),
      status: 'started',
    };
    // Durable before invoking the page: a lost worker/response can never replay this ticket.
    await this.browser.storage.local.setAccessLevel({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    await this.browser.storage.local.set({ [attemptKey]: attempt });
    try {
      const frames = await this.browser.scripting.executeScript({
        target: { tabId: draft.tabId, documentIds: [current.documentId] },
        world: 'MAIN',
        func: sendWhatsAppText,
        args: [
          {
            attemptId: attempt.id,
            groupId: current.groupId,
            name: current.name,
            accountHash: current.accountHash,
            text: draft.text,
          },
        ],
      });
      const result = frames.find((f) => f.frameId === 0)?.result;
      function sendStatus() {
        if (result?.status === 'observed') {
          return 'observed';
        }
        if (result?.status === 'not_sent') {
          return 'not_sent';
        }
        return 'unknown';
      }
      attempt.status = sendStatus();
    } catch {
      attempt.status = 'unknown';
    }
    try {
      await this.browser.storage.local.set({ [attemptKey]: attempt });
    } catch {
      attempt.status = 'unknown';
    }
    return attempt;
  }

  private async previewText(payload: any) {
    if (
      typeof payload.text !== 'string' ||
      payload.text.length > 2000 ||
      !payload.text.trim() ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(payload.text)
    )
      throw new Error('Digite uma mensagem de 1 a 2.000 caracteres.');
    const text = payload.text.replace(/\r\n?/g, '\n').trim(),
      destination = await this.destination(payload.id, payload.tabId, true),
      ticket = crypto.randomUUID();
    this.drafts.clear();
    this.drafts.set(ticket, {
      tabId: payload.tabId,
      destination,
      text,
      expiresAt: Date.now() + 120000,
    });
    return {
      ticket,
      text,
      name: destination.name,
      groupId: destination.groupId,
      accountFingerprint: destination.accountHash.slice(0, 12),
    };
  }

  private async lastTextStatus() {
    const last = (await this.browser.storage.local.get(attemptKey))[
      attemptKey
    ] as TextAttempt | undefined;
    return last
      ? {
          ...last,
          status: last.status === 'started' ? 'unknown' : last.status,
        }
      : null;
  }
}
