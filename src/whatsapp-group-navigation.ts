/** Opens only an existing group model by its stored ID; never searches names or sends. */
export async function openWhatsAppGroup(
  input: { groupId: string; accountHash: string },
  timeoutMs = 8000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (
      location.origin !== 'https://web.whatsapp.com' ||
      !/^\d{5,30}(?:-\d{1,20})?@g\.us$/.test(input.groupId) ||
      !/^[a-f0-9]{64}$/.test(input.accountHash)
    )
      throw new Error('Destino de grupo inválido.');
    const w = window as any;
    if (typeof w.require !== 'function')
      throw new Error('WhatsApp Web ainda não está pronto.');
    const store = w.require('WAWebCollections')?.Chat,
      me = w.require('WAWebUserPrefsMeUser');
    const account = () => {
      const id = (me.getMaybeMePnUser?.() ?? me.getMaybeMeLidUser?.())
        ?._serialized;
      if (
        typeof id !== 'string' ||
        !/^\d{5,30}@(c\.us|s\.whatsapp\.net|lid)$/.test(id)
      )
        throw new Error('Confirme o login no WhatsApp Web.');
      return id.replace('@s.whatsapp.net', '@c.us');
    };
    const before = account(),
      digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(before),
      );
    if (
      Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('') !== input.accountHash ||
      account() !== before
    )
      throw new Error('A conta do WhatsApp não corresponde ao vínculo.');
    const models = store?.getModelsArray?.();
    if (!Array.isArray(models))
      throw new Error('Lista de conversas indisponível.');
    const found = models.filter(
      (chat: any) => chat.id?._serialized === input.groupId,
    );
    if (found.length !== 1)
      throw new Error(
        'O grupo vinculado não está carregado no WhatsApp. Abra-o manualmente uma vez e tente novamente.',
      );
    const chat = found[0];
    if (
      chat.id?.server !== 'g.us' ||
      !(chat.isGroup === true || chat.id?.isGroup?.() === true)
    )
      throw new Error('O destino não é um grupo confirmado.');
    const selected = () => {
      const active = store
        .getModelsArray()
        .filter((c: any) => c.active === true);
      return (
        active.length === 1 &&
        active[0] === chat &&
        active[0].id?._serialized === input.groupId
      );
    };
    async function openAndWait() {
      const cmd = w.require('WAWebCmd')?.Cmd;
      if (typeof cmd?.openChatBottom !== 'function')
        throw new Error(
          'A versão atual do WhatsApp não disponibiliza a abertura segura do grupo.',
        );
      if (account() !== before || chat.id?._serialized !== input.groupId)
        throw new Error('A conta ou grupo mudou antes da abertura.');
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                'Tempo esgotado ao abrir o grupo. Nenhuma mensagem foi enviada.',
              ),
            ),
          Math.max(1, Math.min(timeoutMs, 10000)),
        );
      });
      await Promise.race([
        Promise.resolve(cmd.openChatBottom({ chat })),
        timeout,
      ]);
      const end = Date.now() + Math.max(1, Math.min(timeoutMs, 10000));
      while (!selected()) {
        if (account() !== before)
          throw new Error('A conta mudou durante a abertura.');
        if (Date.now() >= end)
          throw new Error(
            'O WhatsApp não confirmou a abertura do grupo vinculado.',
          );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!selected()) await openAndWait();
    if (account() !== before || !selected())
      throw new Error('A conversa mudou durante a abertura.');
    return { selected: true as const };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message.slice(0, 300)
          : 'Não foi possível abrir o grupo vinculado.',
    };
  } finally {
    clearTimeout(timer);
  }
}
