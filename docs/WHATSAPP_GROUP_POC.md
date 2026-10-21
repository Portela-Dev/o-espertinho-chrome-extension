# POC — identificação de grupos no WhatsApp Web

Esta prova apenas identifica, vincula, valida e remove vínculos. Não envia mensagens, não entra em grupos, não procura destinos pelo nome e não possui método de envio. Não usa cookies ou tokens do WhatsApp, não consulta mensagens nem envia os dados do vínculo ao backend. O login do Espertinho e a permissão affiliate_links continuam obrigatórios.

## Uso local

1. Recarregue a extensão dist em chrome://extensions e abra o painel lateral.
2. Entre no Espertinho e expanda WhatsApp — vínculo de grupos (POC).
3. Abra o WhatsApp Web, faça login se necessário e abra o grupo de teste.
4. Clique em Identificar grupo na aba atual e autorize somente https://web.whatsapp.com/*.
5. Confira nome, identificador @g.us e impressão da conta. Clique em Confirmar vínculo deste grupo em até dois minutos.
6. Selecione o vínculo e use Validar na aba atual. A conferência vale somente para o instante exibido; qualquer envio futuro exigiria outra validação.
7. Para testar bloqueios, abra outro grupo com o mesmo nome ou uma conversa individual e tente validar o vínculo original. Ambos devem ser recusados. Renomear o mesmo grupo deve continuar válido e informar a mudança. Outra conta deve ser recusada.
8. Remover vínculo apaga o registro local. Carregar vínculos restaura a lista após reabrir o painel.

Vínculos são locais ao perfil Chrome: identificador do grupo, nome confirmado, SHA-256 do identificador da conta e data. O número da conta não é persistido. A confirmação temporária fica somente na memória do service worker, é de uso único e se perde quando ele reinicia. O armazenamento é restrito a TRUSTED_CONTEXTS; não há sincronização entre PCs ou backup no servidor.

## Leitura e validação

O adaptador somente lê WAWebCollections.Chat.getModelsArray e WAWebUserPrefsMeUser.getMaybeMePnUser/getMaybeMeLidUser no MAIN world do frame principal. Exige uma única conversa active, identificador @g.us e confirmação do tipo grupo pelo modelo. Dois levantamentos consecutivos precisam apresentar o mesmo identificador de conta, grupo e documento. Recarregar a página ou trocar de grupo/conta entre identificação e confirmação invalida o ticket. Nome nunca decide identidade.

São módulos privados e sujeitos a mudanças: se não estiverem disponíveis, a POC recusa a identificação, sem fallback por título, foto, histórico ou seletores de texto. A página comprometida ou extensões maliciosas no mesmo perfil estão fora da garantia desta prova. Não é uma certificação de identidade fornecida por uma API oficial.

Referências de investigação: https://github.com/wppconnect-team/wa-js/blob/main/src/chat/functions/getActiveChat.ts e https://github.com/pedroslopez/whatsapp-web.js/blob/main/src/Client.js . Nenhuma dessas bibliotecas foi adicionada como dependência nem foram importadas rotinas de envio.

## Testes

npm run check executa contratos, isolamento, confirmação, expiração, persistência e UI. npm run test:native inclui um cenário Chromium com página simulada no domínio WhatsApp e módulos controlados. Ele testa grupos homônimos, nome alterado, contato individual, outra conta e recarga de documento. Não usa perfil pessoal nem realiza envio. O teste com a versão autenticada do WhatsApp real precisa de homologação manual; os testes controlados não comprovam compatibilidade com todas as versões do site.

Homologação em 21/10/2026: o administrador confirmou a identificação de um grupo no WhatsApp Web real (nome, identificador @g.us e impressão da conta). Os identificadores reais não são registrados no repositório. Confirmação do vínculo e rejeição de outro destino no ambiente real ainda aguardam retorno; esses cenários passaram nos testes controlados.
