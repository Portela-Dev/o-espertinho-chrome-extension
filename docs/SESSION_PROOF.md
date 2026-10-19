# Prova local de sessão autenticada

Esta prova usa os marketplaces, domínios e seletores cadastrados no backend. Não contém adaptadores por loja e não integra sessões aos jobs de enriquecimento ou preços.

1. Compile com `npm run package`. Recarregue a extensão em `chrome://extensions`, usando a pasta `dist`.
2. Conecte a extensão ao backend como administrador com permissão `affiliate_links`.
3. Em **Prova de sessão no container**, carregue os marketplaces e escolha a loja.
4. Abra o marketplace pelo botão da prova e faça login normalmente. Não informe senhas no O Espertinho.
5. Abra a extensão na aba normal desse marketplace. Confira o link HTTPS, marque a autorização e clique em **Capturar sessão e testar**. O armazenamento local é opcional e vem desmarcado.
6. A extensão solicita a permissão opcional `cookies` e acesso somente aos domínios apresentados. O resultado mostra o estado da extração, HTTP, URL final sem query e quantidade de cookies importados.

A captura inclui cookies HttpOnly da loja. Cookies particionados, expirados e de domínios não cadastrados são excluídos. Cadastre explicitamente o domínio raiz se a loja usa cookies nesse domínio. A sessão deve caber em 48 KiB. O armazenamento local, quando selecionado, é lido somente da origem da aba ativa. Abas anônimas não são usadas nesta prova.

O backend exige a sessão real da extensão e uma conta administradora. Os endpoints `/api/extension/session-proof/*` só ficam disponíveis em desenvolvimento/teste com `EXTENSION_MOCK_ENABLED=true`. Usa `MANUAL_EXTRACTOR_URL` e `MANUAL_EXTRACTION_SERVICE_TOKEN` já existentes para chamar o extrator.

Cookies e armazenamento local não são gravados no banco, nos logs, no estado da extensão ou retornados ao popup. O backend mantém a entrada cifrada durante o processamento; o container restaura o estado em um navegador isolado e o encerra ao terminar. Somente o resultado sem credenciais fica disponível à sessão que solicitou o teste, por até cinco minutos. A auditoria registra o identificador e o resultado técnico, sem os valores da sessão.

Não há geração de links, alteração de ofertas, agendamento ou retentativa automática. Uma sessão pode não funcionar quando transferida para outro navegador; `technical_failure` não comprova expiração ou bloqueio. Essa prova importa cookies e, opcionalmente, localStorage; não importa IndexedDB, sessionStorage, senhas, extensões ou perfil completo do Chrome.
