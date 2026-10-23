# IA do catálogo no painel

## Contas e operação

Os logins Google/Espertinho e ChatGPT e a seleção de modelo ficam no mesmo card Contas. Abra o painel lateral, entre no Espertinho e use Continue with ChatGPT. Apenas o login abre uma aba, fechada ao retornar. Carregue os modelos e escolha um disponível na sua conta.

Ative as tarefas e seus prompts independentes no admin. Os botões 4 — Catalogar produtos e 5 — Categorizar produtos ficam disponíveis conforme login, permissões, modelo e flags. Iniciar uma tarefa após login autoriza sua análise, sem checkbox adicional. A análise avulsa e sua captura de metadados foram removidas.

O passo 4 compara todos os produtos e rascunhos globalmente e herda a categoria dos existentes. Identidades novas aguardam categorização como rascunhos compartilhados. O passo 5 compara todas as árvores e finaliza novos produtos. O inventário completo é carregado por páginas consistentes e atualizado em memória após cada decisão. Produtos são comparados em blocos de 30; categorias em blocos de 100, sem truncar o catálogo.

Decisões válidas são aplicadas automaticamente. Ambiguidades ficam pendentes; publicação permanece manual no admin. Cor, tamanho e tensão isolados não distinguem produtos. Erros encerram o lote sem repetir inferência automaticamente.

## Progresso único

Execução atual e sua única barra mostram tanto etapas de navegador quanto de IA, sem nomes ou informações individuais dos produtos durante a IA. Catalogação conta links processados: aplicações, pendências e falhas são detalhadas separadamente. Por exemplo, 51/51 processados pode conter 47 catalogados e 4 pendências; o contador do botão continua 47/51, pois pendências não são vínculos válidos. Uma oferta ligada a um produto já usado continua contando como mais um link catalogado. Categorização processa um rascunho compartilhado por vez e seus contadores do catálogo incluem os links relacionados.

Cancelar execução também cancela a IA e libera a reserva quando possível. Aplicações anteriores não são desfeitas. Iniciar ou retomar uma etapa do navegador substitui a exibição de progresso da IA anterior; consultas periódicas não a restauram.

## Sessão e segurança

A sessão ChatGPT e o modelo selecionado são restaurados após fechar/recarregar o painel e reiniciar o Chrome. Não há auxiliar nem serviço externo. O backend nunca recebe credenciais OpenAI.

O serviço de fundo da extensão mantém uma fila única para gravar credenciais, renovar tokens, consultar modelos e desconectar. A rotação salva o token substituto antes de responder ao painel, evitando concorrência entre painéis. O painel recebe apenas metadados, modelos e o access token temporário necessário à chamada direta de inferência. O callback OAuth continua validando state, PKCE, nonce, assinatura, emissor, público e identidade antes de instalar uma sessão.

O cofre local usa AES-GCM com IV aleatório e autenticação da revisão. A chave não exportável pela API Web Crypto fica no IndexedDB da própria extensão; somente o texto cifrado vai para chrome.storage.local, restrito a TRUSTED_CONTEXTS. Não usa storage.sync. Isso protege contra exposição acidental do armazenamento, mas não equivale ao cofre de credenciais do sistema operacional nem protege um perfil/PC comprometido. Cookies, ID tokens, códigos OAuth e PKCE não são persistidos. Registros públicos de cliente/conta permanecem separados.

Ao desconectar, o serviço de fundo elimina os dados cifrados e a seleção do modelo, mantém um marcador de versão sem segredos e tenta revogar a sessão na OpenAI. Callbacks e solicitações de sessões anteriores são recusados. A saída se propaga aos demais painéis e cancela novas análises. Uma falha de rede na revogação não restaura a sessão local; a interface informa quando a revogação remota não foi confirmada.

Um token recusado/invalid_grant remove a sessão salva e exige novo login. Uma falha transitória não apaga credenciais. Modelos removidos da conta deixam de ser selecionados; a conta do Espertinho e suas permissões continuam sendo verificadas antes de cada operação. Fechar o painel cancela a análise e o login pendente, mas preserva uma sessão já instalada.

O retorno é observado em 127.0.0.1:18766/auth/callback, sem servidor nessa porta, aceitando apenas a aba, frame, origem, caminho e state esperados. PKCE S256, nonce, assinatura da identidade, issuer, audience, validade e escopos são verificados. Chamadas de modelos/Responses são diretas à OpenAI.

O backend valida permissões, flags, contratos, versões e idempotência. A interface não exibe consumo, quota ou diagnósticos de retorno do login. Cancelamento não desfaz decisões já aplicadas; fechamento abrupto pode exigir aguardar a reserva de até 10 minutos.

## Validação

Login e inferência com a conta real foram homologados anteriormente pelo administrador. Este ciclo usa serviços/identidades simulados em testes unitários e Chromium real. Execute npm run check, npm run test:native e npm run package. O pacote contém somente a extensão e instruções/checksum.

O painel usa espaçamento uniforme entre campos e ações. Textos explicativos fixos foram removidos; estados, contadores, erros e nomes acessíveis dos controles permanecem disponíveis.

Testes incluem reinício real do Chromium com o mesmo perfil, restauração sem OAuth adicional, modelo preservado e segundo reinício após desconectar. Cofre adulterado, rotação serializada, callbacks antigos, modelos inexistentes e falha de rede são testados isoladamente.


## Revisão e anúncios inválidos

Os prompts configurados no admin são lidos do backend em cada contexto e enviados ao modelo. RAM física, armazenamento, tamanho de tela, modelo e geração distinguem produtos. Kits personalizados geram produto próprio por anúncio. Inconsistências factuais internas retornam invalid sem aplicar dados; dúvidas sem contradição retornam needs_review. O progresso distingue inválidos de pendências e falhas.

Marque Reprocessar somente itens em revisão nos passos 4 e 5 para reavaliar needs_review do marketplace selecionado, respeitando o máximo de itens. Desmarque para o fluxo normal. Uma reserva ativa não é substituída. Anúncios inválidos exigem Extrair novamente para reavaliar no admin, passo 3 bem-sucedido e nova análise. Isso permite que o vendedor corrija a página sem aceitar dados antigos automaticamente.

Os candidatos de produto de todos os lotes são consolidados antes da decisão final; mapeamentos anteriores de categoria são incluídos no contexto. Não há inferência, publicação ou reenvio automático ao marcar a opção.
