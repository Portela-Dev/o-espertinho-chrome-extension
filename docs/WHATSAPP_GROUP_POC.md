# POC — grupos e envio manual de texto no WhatsApp Web

A extensão identifica, vincula e valida grupos. Também permite enviar uma única mensagem de texto ao grupo vinculado, somente após prévia e confirmação explícita. Não há agendamento, fila, envio em massa, busca de destinatário pelo nome ou repetição automática. O grupo existente vinculado pode ser aberto pelo identificador antes da prévia, em segundo plano. Não importa cookies/tokens nem envia mensagens, vínculos ou credenciais do WhatsApp ao backend.

## Vincular e validar

1. Recarregue dist em chrome://extensions, abra o painel lateral e entre no Espertinho com a permissão affiliate_links.
2. Expanda WhatsApp — vínculo de grupos (POC). Abra o WhatsApp Web e o grupo de teste.
3. Clique em Identificar grupo na aba atual e autorize somente https://web.whatsapp.com/*.
4. Confira nome, identificador @g.us e impressão da conta. Confirme o vínculo em até dois minutos.
5. Selecione o vínculo e use Validar na aba atual. Outro grupo, mesmo com nome igual, ou uma conversa individual deve ser recusado. Renomear o mesmo grupo mantém sua identidade. Trocar de conta é recusado.
6. Carregar vínculos restaura a lista após reabrir o painel. Remover vínculo apaga o registro local.

Homologação de identidade em 21/10/2026: o administrador confirmou a identificação no WhatsApp real, a validação no grupo correto e a recusa após trocar para outra conversa. Identificadores reais não são registrados no repositório.

## Envio manual único

1. Mantenha uma única aba do WhatsApp Web aberta na mesma janela do painel, com qualquer conversa aberta. Você pode deixar outra aba em foco. Selecione o vínculo e escreva uma mensagem de até 2.000 caracteres no painel.
2. A prévia e Validar grupo vinculado localizam a única aba do WhatsApp na janela, sem ativá-la. Se não existir ou houver mais de uma, a operação é recusada. Antes de liberar a prévia, a extensão verifica a conta, localiza o modelo já carregado pelo identificador exato do vínculo e o abre com WAWebCmd.Cmd.openChatBottom({chat}). Não cria conversas ou grupos, não entra em grupos e não pesquisa pelo nome. Depois confirma o identificador, conta e documento por duas leituras. O botão Abrir grupo vinculado permite testar essa abertura isoladamente. Grupo ausente do cache ou função indisponível são recusados, sem fallback. O primeiro vínculo ainda exige identificar explicitamente o grupo na aba atual. Clique em Gerar prévia da mensagem. Confira nome, identificador, impressão da conta e texto exato. O texto tem quebras de linha normalizadas e espaços externos removidos; não é interpretado como HTML.
3. Clique uma vez em Confirmar e enviar uma vez. Editar o campo, mudar a seleção, cancelar ou expirar a prévia exige uma nova prévia.
4. A confirmação consome um ticket de uso único antes de qualquer await. A confirmação nunca reabre o grupo: se você trocar de conversa depois da prévia, o envio é recusado. A extensão revalida vínculo/conta/grupo/nome/documento e registra a tentativa localmente antes de injetar a função de envio.
5. A injeção é limitada ao documentId da prévia. No MAIN world, revalida novamente a conta, grupo ativo e nome imediatamente antes de chamar WAWebSendTextMsgChatAction.sendTextMsgToChat com o modelo capturado do grupo. Não usa o compositor, não seleciona destinatários nem tenta outro método se a função estiver indisponível.
6. Observa somente a nova mensagem própria correspondente ao texto e identificador remoto dentro do grupo capturado. Registra apenas observação local, não entrega ou leitura pelos participantes.
7. Se houver erro após invocação, timeout, recarga ou perda de resposta, o resultado fica desconhecido: confira a conversa manualmente antes de preparar outro envio. A extensão não reenvia. Carregar vínculos também recupera o estado da última tentativa; um registro iniciado sem confirmação final é tratado como desconhecido.

Homologação manual em 21/10/2026: o administrador confirmou o envio da mensagem no grupo vinculado e a recusa ao abrir outro grupo. O ensaio real foi realizado pelo próprio administrador com prévia e confirmação no painel. O envio em segundo plano foi homologado pelo administrador, sem mudar o foco da aba. A seleção automática do grupo aguarda teste real. Os testes automatizados continuam isolados e não enviam nada à rede real.

## Dados e limites

Vínculos ficam apenas no perfil Chrome, restritos a TRUSTED_CONTEXTS: identificador do grupo, nome confirmado, SHA-256 da conta e data. O número da conta não é persistido. A última tentativa guarda identificador aleatório, grupo, nome, hash do texto, horário e estado. O texto completo e tickets ficam somente em memória. Não há sincronização com o backend. Tickets se perdem ao reiniciar o service worker; não são restaurados nem reexecutados.

O adaptador de identidade lê WAWebCollections.Chat e WAWebUserPrefsMeUser. Duas leituras consecutivas precisam corresponder em conta, grupo e documento. Os módulos são privados e podem mudar. A identificação não usa fallback por nome ou foto. O envio observa apenas a mensagem própria em processamento; não consulta conteúdo do histórico, exporta conversas ou acessa contatos. Antes de enviar, coleta IDs das mensagens já carregadas para não confundir uma mensagem antiga com a nova.

A tentativa tem no máximo uma chamada iniciada pela extensão por confirmação. Isso não garante entrega exatamente uma vez pelo transporte interno do WhatsApp, nem impede que o usuário crie deliberadamente outra prévia e envie o mesmo texto novamente. Um perfil/página comprometido fica fora das garantias desta prova.

Referências de investigação: https://github.com/wppconnect-team/wa-js/blob/main/src/chat/functions/getActiveChat.ts , https://github.com/wppconnect-team/wa-js/blob/main/src/chat/functions/openChatBottom.ts , https://github.com/wppconnect-team/wa-js/blob/main/src/whatsapp/functions/sendTextMsgToChat.ts e https://github.com/open-wa/wa-automate-nodejs/blob/master/packages/core/src/transport/assets/wapi.js . Nenhuma biblioteca de automação foi instalada.

## Testes

npm run check cobre contratos, autenticação, isolamento, tickets, confirmação, persistência, edição, cancelamento, dupla confirmação e resultados desconhecidos. npm run test:native usa Chromium e páginas/módulos controlados, testando abertura do grupo por identificador entre homônimos com outra aba ativa, recusa de mudança de destino após a prévia e um único disparo simulado após confirmação. Os testes não usam perfil pessoal nem enviam mensagens reais. O fluxo de catálogo e IA continua sendo testado separadamente no mesmo comando.
