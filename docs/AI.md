# IA do catálogo no painel

A implementação antiga com auxiliar Node.js e a aba de análise foram removidas. Não há serviço local, porta em escuta, pareamento ou pacote adicional.

## Testar

1. Recarregue a extensão a partir de dist em chrome://extensions.
2. Abra o painel lateral e entre no O Espertinho com permissão de gerar links de afiliados. No modo popup, use Abrir painel para usar IA.
3. Expanda IA do catálogo (teste) e clique em Continue with ChatGPT. Autorize os domínios oficiais e conclua o login. Apenas essa aba é aberta e é fechada ao capturar o retorno.
4. No painel, confira a conta e Usando seu plano ChatGPT. Carregue e selecione um modelo.
5. Capture metadados públicos da aba HTTPS de produto ou preencha os campos manualmente. Confira nome, descrição, marca e categoria de origem. Categorias e produtos candidatos são opcionais e manuais nesta prova.
6. Autorize o envio desta oferta à OpenAI e clique em Analisar esta oferta. O resultado aparece no próprio painel. Cancelar interrompe login/análise; Desconectar limpa a sessão e tenta revogar o token.

## Sessão e segurança

Tokens OAuth, PKCE e resultados ficam apenas na memória deste documento do painel. Fechar, recarregar ou alternar para popup exige novo login. Só identificadores públicos de registro (host/client/conta) são persistidos localmente para reutilizar o registro. Não são salvos tokens em chrome.storage, logs ou backend.

O retorno de login é observado pelo Chrome no loopback 127.0.0.1:18766/auth/callback, sem servidor nessa porta. Somente a aba criada pela tentativa, frame principal, origem/caminho e state exatos são aceitos. PKCE S256, nonce, assinatura da identidade, issuer, audience, validade e escopos são verificados. A aba de login é fechada sem retransmitir o retorno a outra página.

As chamadas são diretas aos endpoints oficiais de autenticação, modelos e Responses da OpenAI. Renovação é serializada. Erros são sanitizados. Captura da página lê apenas metadados públicos limitados; não lê cookies, storage ou scripts arbitrários. O backend recebe a consulta de permissão e, nos passos 4 e 5, as decisões estruturadas para aplicação validada. Credenciais ChatGPT nunca são enviadas ao backend; análises avulsas permanecem no painel.

A análise avulsa não altera categorias, produtos ou publicações. Os passos 4 e 5 aplicam automaticamente decisões válidas no backend, preservando revisão e publicação manual. categoryExists depende das categorias fornecidas no formulário; não consulta o banco. Vinculação usa somente IDs candidatos fornecidos. Cor, tamanho e tensão, isoladamente, não distinguem produtos.

## Validação

Login e análise direta de uma oferta foram confirmados pelo administrador na prova anterior, com o auxiliar desligado (tênis Kappa Park 2.0). O teste em Chromium real passou com login, fechamento da aba de autorização, modelos, análise, desconexão e verificação de ausência de credenciais no storage/backend. A repetição com a conta real no painel integrado foi confirmada pelo administrador em 20/10/2026: análise da oferta Creatina Monohidratada Growth Supplements 250 g, retornando create_new com categoria e dados do produto. Nenhuma alteração no catálogo foi executada. Testes automatizados usam identidades e respostas simuladas, sem acessar a conta real. A integração mantém o retorno OAuth experimental já validado, sujeito às condições e limites da conta e da integração.

Execute npm run check, npm run test:native e npm run package. O artefato contém apenas o ZIP da extensão e instruções/checksum.

## Fluxo de revisão integrado

Ative tarefas e prompts independentes no admin. Atualize as configurações, conecte ChatGPT, selecione modelo e autorize o lote.

4 — Catalogar produtos percorre todos os produtos e rascunhos, em blocos de 30. Produtos existentes herdam sua categoria. Identidades novas aguardam como rascunhos compartilhados.

5 — Categorizar produtos compara todas as árvores em blocos de 100, seleciona os melhores candidatos e reutiliza ou cria a categoria. Finaliza o produto e seus links automaticamente. Resultados atualizam o inventário em memória para as ofertas seguintes; revisão consistente invalida contextos concorrentes obsoletos. Não há limite global oculto.

Ambiguidades ficam pendentes; decisões válidas contam como aplicadas. Cancelar interrompe o restante do lote e não desfaz aplicações anteriores. Publicação continua manual. Fechar o painel pode exigir aguardar a reserva de até 10 minutos. O passo 6 — Analisar Preços fica separado por divisor.

O backend valida permissões, flags, contratos, versões e idempotência. Tokens ChatGPT não saem do painel. Testes automatizados usam respostas simuladas, incluindo catálogo com múltiplos blocos, cache, login e aplicação. O painel informa tokens desta sessão, sem estimar a quota total da conta.
