# IA do catálogo no painel

## Contas e operação

A conta ChatGPT e a seleção de modelo ficam no topo, junto à conta do O Espertinho. Abra o painel lateral, entre no Espertinho e use Continue with ChatGPT. Apenas o login abre uma aba, fechada ao retornar. Carregue os modelos e escolha um disponível na sua conta.

Ative as tarefas e seus prompts independentes no admin. Os botões 4 — Catalogar produtos e 5 — Categorizar produtos ficam disponíveis conforme login, permissões, modelo e flags. Iniciar uma tarefa após login autoriza sua análise, sem checkbox adicional. A análise avulsa e sua captura de metadados foram removidas.

O passo 4 compara todos os produtos e rascunhos globalmente e herda a categoria dos existentes. Identidades novas aguardam categorização como rascunhos compartilhados. O passo 5 compara todas as árvores e finaliza novos produtos. O inventário completo é carregado por páginas consistentes e atualizado em memória após cada decisão. Produtos são comparados em blocos de 30; categorias em blocos de 100, sem truncar o catálogo.

Decisões válidas são aplicadas automaticamente. Ambiguidades ficam pendentes; publicação permanece manual no admin. Cor, tamanho e tensão isolados não distinguem produtos. Erros encerram o lote sem repetir inferência automaticamente.

## Progresso único

Execução atual e sua única barra mostram tanto etapas de navegador quanto de IA. Catalogação conta links processados: aplicações, pendências e falhas são detalhadas separadamente. Por exemplo, 51/51 processados pode conter 47 catalogados e 4 pendências; o contador do botão continua 47/51, pois pendências não são vínculos válidos. Uma oferta ligada a um produto já usado continua contando como mais um link catalogado. Categorização processa um rascunho compartilhado por vez e seus contadores do catálogo incluem os links relacionados.

Cancelar execução também cancela a IA e libera a reserva quando possível. Aplicações anteriores não são desfeitas. Iniciar ou retomar uma etapa do navegador substitui a exibição de progresso da IA anterior; consultas periódicas não a restauram.

## Sessão e segurança

Tokens OAuth e PKCE ficam somente na memória do painel, sem auxiliar local ou serviço em escuta. Fechar/recarregar o painel ou mudar para popup exige novo login. Persistem apenas registros públicos de conta/cliente. Credenciais OpenAI não vão ao backend, storage ou logs.

O retorno é observado em 127.0.0.1:18766/auth/callback, sem servidor nessa porta, aceitando apenas a aba, frame, origem, caminho e state esperados. PKCE S256, nonce, assinatura da identidade, issuer, audience, validade e escopos são verificados. Chamadas de modelos/Responses são diretas à OpenAI.

O backend valida permissões, flags, contratos, versões e idempotência. O painel informa análises e tokens desta sessão; isso não representa a quota total da conta. Cancelamento não desfaz decisões já aplicadas; fechamento abrupto pode exigir aguardar a reserva de até 10 minutos.

## Validação

Login e inferência com a conta real foram homologados anteriormente pelo administrador. Este ciclo usa serviços/identidades simulados em testes unitários e Chromium real. Execute npm run check, npm run test:native e npm run package. O pacote contém somente a extensão e instruções/checksum.
