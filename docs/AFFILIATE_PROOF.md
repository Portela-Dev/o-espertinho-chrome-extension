# Conversão local antes do enriquecimento

Prova de desenvolvimento com até três links descobertos que falharam no enriquecimento. Não usa a captura de cookies da prova anterior. A sessão permanece no Chrome: o executor chama o endpoint de conversão na mesma origem da aba, com `credentials: include`. Apenas o link final ou `conversion_failed` chega ao backend.

As receitas vêm de `GET /api/extension/affiliate-proof/config`, persistidas em `affiliate_proof_recipes` (migration 028). O endpoint de configuração `POST /api/extension/affiliate-proof/recipes/:market` exige sessão real da extensão, conta administradora e permissão `affiliate_links`. As rotas só existem fora de produção, com `EXTENSION_MOCK_ENABLED=true`. Cookies, Authorization e headers reservados não podem ser configurados. Headers X- de sessão devem usar variáveis, nunca valores fixos.

## Procedimento

1. Compile com `npm run package` e recarregue a extensão em `chrome://extensions` pela pasta `dist`. Esta versão acrescenta a permissão `webRequest`; não solicita a permissão `cookies` para este fluxo.
2. Conecte sua conta administradora. Em **Conversão antes do enriquecimento**, carregue as receitas e escolha o marketplace.
3. Clique **Preparar aba do marketplace** e autorize somente seus domínios cadastrados. Na aba preparada, gere um link pelo próprio site. Essa chamada legítima fornece o header CSRF configurado para a memória local da extensão. Não copie tokens ou cookies.
4. Abra a extensão novamente e confira **Header de sessão pronto na memória local**. Clique **Converter até 3 links**. Cada tentativa respeita o intervalo da receita (mínimo 20 segundos nesta prova). O popup pode ser fechado; o alarme retoma o processamento.
5. Após concluir, clique **Iniciar enriquecimento dos convertidos**. Só os itens que receberam links válidos são enviados ao job; os resultados aparecem no popup e na execução normal da revisão de ofertas. O cancelamento continua disponível na administração.

O observador usa `onBeforeSendHeaders` somente com `requestHeaders`, sem `extraHeaders`, sem interceptação bloqueante e sem modificar tráfego. Lê apenas o header X- explicitamente configurado, na URL de origem e aba preparadas. Ignora outros headers, outras abas e outros iniciadores. Os valores ficam em `chrome.storage.session`, acessível somente aos contextos confiáveis, por até 15 minutos; não entram em `storage.local`, logs, popup, banco ou chamadas ao backend. Saída da conta limpa os valores. Recarregar a extensão ou reiniciar o Chrome também elimina essa memória.

O teste e os links convertidos têm validade de 30 minutos no backend, em memória e vinculados à sessão da extensão. Reiniciar o backend os descarta. Use **Novo teste** após interrupção ou expiração. O snapshot persistido do enriquecimento contém apenas URLs públicas de navegação, nunca headers/cookies. A URL original continua como identidade do item e em `enrichment_data.productUrl`; a URL de afiliado é usada apenas para navegar naquele lote. Não há publicação automática, criação de produto ou confirmação de categoria.

Receitas aceitam passos declarativos de leitura, preenchimento, clique comum e requisição. Não contêm JavaScript remoto ou adaptadores por marketplace. `extract` com `source: requestHeader` usa `key` para o nome do header, `sourceUrl` para a chamada observada e `name` para a variável local. `request` usa templates como `{{csrf}}` e `{{originalUrl}}`, além de `responsePath` para o campo JSON do link.

No teste inicial com um link de afiliado já existente, o job obteve título, preço e uma imagem; descrição, especificações e árvore de origem vieram vazias com os seletores cadastrados. Conversão bem-sucedida não garante que a página de destino ofereça todos os dados necessários. Resultados incompletos não devem confirmar categorias ou vincular produtos automaticamente.
