# Prova local de sessão autenticada

Esta prova usa os marketplaces, domínios e seletores cadastrados no backend. Não contém adaptadores por loja e não integra sessões aos jobs de enriquecimento ou preços.

1. Compile com `npm run package`. Recarregue a extensão em `chrome://extensions`, usando a pasta `dist`.
2. Conecte a extensão ao backend como administrador com permissão `affiliate_links`.
3. Em **Prova de sessão no container**, carregue os marketplaces e escolha a loja.
4. Abra o marketplace pelo botão da prova e faça login normalmente. Não informe senhas no O Espertinho.
5. Abra a extensão na aba normal desse marketplace. Confira o link HTTPS ou marque **Testar até 5 links com falha no enriquecimento deste marketplace**, marque a autorização e clique em **Capturar sessão e testar**. O armazenamento local é opcional e vem desmarcado.
6. A extensão solicita a permissão opcional `cookies` e acesso somente aos domínios apresentados. O resultado mostra o estado da extração, HTTP, URL final sem query e quantidade de cookies importados.

A captura inclui cookies HttpOnly da loja. Cookies particionados, expirados e de domínios não cadastrados são excluídos. Cadastre explicitamente o domínio raiz se a loja usa cookies nesse domínio. A sessão deve caber em 48 KiB. O armazenamento local, quando selecionado, é lido somente da origem da aba ativa. Abas anônimas não são usadas nesta prova.

O backend exige a sessão real da extensão e uma conta administradora. Os endpoints `/api/extension/session-proof/*` só ficam disponíveis em desenvolvimento/teste com `EXTENSION_MOCK_ENABLED=true`. Usa `MANUAL_EXTRACTOR_URL` e `MANUAL_EXTRACTION_SERVICE_TOKEN` já existentes para chamar o extrator.

Cookies e armazenamento local não são gravados no banco, nos logs, no estado da extensão ou retornados ao popup. O backend mantém a entrada cifrada durante o processamento; o container restaura o estado em um navegador isolado e o encerra ao terminar. Somente o resultado sem credenciais fica disponível à sessão que solicitou o teste, por até cinco minutos no teste individual ou quinze no lote. A auditoria registra o identificador e o resultado técnico, sem os valores da sessão.

O lote seleciona no backend até cinco links não arquivados com `extraction_status=failed`, restritos ao marketplace escolhido, começando pelos mais recentemente extraídos (desempate por ID). Não usa o campo de URL manual. Executa um acesso por vez, com 20 segundos entre o fim de uma tentativa e o início da próxima, inclusive depois de falhas. Cada acesso usa um contexto novo com a mesma captura inicial: não é um teste de navegação contínua ou de renovação de cookies. Mostra progresso e resultado por link, incluindo preço e HTTP, e continua mesmo se um link falhar. O popup pode ser fechado enquanto o backend processa. Não altera o status, os dados extraídos ou a categorização dos links no banco; uma nova prova exige nova captura e consentimento.

Não há geração de links, alteração de ofertas, agendamento ou retentativa automática. Uma sessão pode não funcionar quando transferida para outro navegador; `technical_failure` não comprova expiração ou bloqueio. Essa prova importa cookies e, opcionalmente, localStorage; não importa IndexedDB, sessionStorage, senhas, extensões ou perfil completo do Chrome.

## Resultado observado na prova inicial

Em 19/10/2026, uma captura explícita do Mercado Livre importou 42 cookies no container e permitiu extrair título e preço de um produto anteriormente redirecionado para login. A resposta foi HTTP 200, estado `available`, com preço de R$ 749,99. O backend registrou `extension.session_proof.available` na auditoria. Nenhum cookie foi incluído nesta documentação ou no resultado público.

O resultado valida um acesso autenticado naquele momento. Não mede duração da sessão, renovação, estabilidade em lotes ou limites de acesso; os jobs continuam sem integração com essa sessão.

## Resultado do lote de links com falha

Em 19/10/2026, a prova `58faa772-27bd-4319-8542-bed4e27ed3fe` testou cinco links do Mercado Livre anteriormente classificados com falha no enriquecimento. A auditoria confirmou cinco respostas `technical_failure/incomplete`, nenhuma `available`, e o encerramento normal do lote. A duração total foi de aproximadamente 159 segundos, com acessos sequenciais e 20 segundos entre tentativas. Os registros de enriquecimento permaneceram intactos. Os pipelines do backend e da extensão passaram.

Em uma tentativa individual anterior, o usuário observou redirecionamento para `/captcha/wall/logged`, com 38 cookies importados e HTTP 302 → 200. Isso comprova a apresentação de um desafio naquele acesso, mas não comprova sozinho a URL final das cinco tentativas do lote. `incomplete` indica ausência de campos obrigatórios; o popup mostra URL final e campos ausentes por item para distinguir os casos. A captura que funcionou inicialmente não garantiu a extração das novas tentativas; ainda não existe validação de estabilidade ou renovação automática da sessão.
