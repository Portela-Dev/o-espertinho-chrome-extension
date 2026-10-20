# O Espertinho — extensão Chrome

Extensão Manifest V3/TypeScript para quatro etapas manuais de manutenção do catálogo, usando receitas e seletores do backend, sem implementação fixa por marketplace.

## Instalar e conectar

Node 24 e Chrome 120+. Execute `npm ci` e `npm run package`. Carregue dist em chrome://extensions ou extraia o ZIP de artifacts em pasta permanente e carregue a pasta com manifest.json. Após atualizar, recarregue a extensão. O pipeline gera ZIP, checksum e instruções, sem deploy/Web Store.

BACKEND_URL no .env ou variable do build define a origem da API (padrão http://localhost:3000). A conexão pode ser alterada na interface após sair. Não coloque segredos no .env da extensão. Produção usa HTTPS. Nenhuma credencial de marketplace é embutida no pacote.

O ícone abre o painel lateral por padrão. O switch Popup / Painel lateral aplica e salva a preferência; o painel permanece aberto enquanto você usa a página. O seletor visual e sua composição continuam disponíveis, com edição e contagem de matches. Pause a coleta antes de inspecionar uma página.

Entre no O Espertinho e aprove no site com a conta Google autorizada. A extensão exige affiliate_links e, por etapa, discovery, catalog ou updates. Requisições são autorizadas novamente pelo backend. Sessões revogadas/expiradas interrompem o fluxo.

## Quatro etapas

1. **Extrair links:** carrega vitrines/perfis habilitados e percorre a paginação configurada. Envia URLs e origem, não dados incompletos de cards.
2. **Gerar links de afiliados:** processa candidatos ainda sem conversão usando a receita cadastrada. Categoria/produto ainda não são necessários. A URL original é preservada separadamente.
3. **Extrair informações:** navega nos links convertidos e aplica seletores de produto; grava categorias de origem e dados para revisão, sem confirmar mapeamentos ou publicar.
4. **Atualizar preços:** atualiza ofertas publicadas e seu histórico diário. Falha técnica mantém o último preço e a oferta.

No admin, confirme categoria, atribua/crie produto e publique explicitamente. Cada botão inicia só sua própria etapa. Limite de itens e inclusão de falhas ficam na interface. Novas configurações valem para execuções novas.

## Janela, bloqueios e retomada

Preparar janela / fazer login abre uma janela de processamento própria. Ela não substitui a aba que você está usando. Faça login ali quando necessário. Se a receita usa requestHeader, gere um link manualmente nessa janela: somente o header X- da chamada, aba e origem configuradas fica em storage.session confiável, com prazo de 15 minutos e limpeza ao sair. Ele nunca integra resultados enviados ao backend.

Login, CAPTCHA, acesso negado ou limite são detectados por regras de URL, seletores ou texto e pausam o processamento. Resolva manualmente na mesma janela e clique Continuar; a extensão verifica novamente. Não há resolução automática de desafios ou troca de identidade para evitar bloqueio.

Painel pode ser fechado sem perder progresso. Use Carregar execuções para retomar uma execução própria ou prévia solicitada no admin; a lista tem paginação e tamanho selecionável. Pausar/cancelar é explícito. Reservas e respostas pendentes são persistidas; resultados repetidos são idempotentes no backend. Uma retomada invalida reservas antigas e reextrai o item ainda não confirmado.

O computador e o Chrome precisam estar disponíveis. Suspensão, abas congeladas/descartadas, perda de rede ou janela fechada podem pausar a execução. Não existe garantia de processamento com janela minimizada. Iframes configurados não são suportados nesta versão e causam falha controlada; documento principal, links de próximo, templates de URL, carregar mais e rolagem usam configurações limitadas.

## Segurança e limites

Cookies, Authorization, tokens CSRF e storage do marketplace não são enviados ao backend. Sessão é enviada apenas pelo próprio navegador à origem do marketplace. Há permissão obrigatória apenas para o host da API e permissões opcionais por domínio de navegação. A antiga permissão cookies e as POCs de exportação de sessão foram removidas do pacote.

Receitas suportam extract, request GET/POST na mesma origem, fill e click, com variáveis locais e responsePath. Headers reservados são recusados. Não há eval, scripts remotos ou código por loja. Receitas complexas não suportadas devem permanecer pendentes, sem fallback específico.

## Testar e empacotar

- `npm run check`: TypeScript, HTML, testes e cobertura.
- `npm run test:native`: quatro passos em Chromium real, com páginas HTTPS e API descartáveis. Requer Chromium do Playwright e OpenSSL; `npx --no-install playwright install chromium` prepara o navegador.
- `npm run package`: build de produção sem source maps e ZIP instalável com checksum.

Playwright é dependência somente de testes e não entra no ZIP. O teste nativo usa perfil temporário, certificado descartável e flags exclusivamente de teste; não acessa perfil pessoal, banco ou sessões reais. A API de fixture não substitui os testes SQL do backend. O CI instala Chromium e executa esse teste além dos unitários.

SonarQube permanece no runner Windows windows-portela-dev; validação/pacote ficam em ubuntu-22.04, preservando a sandbox do Chromium. Projeto Sonar: o-espertinho-chrome-extension. Configurações: SONAR_ENABLED, SONAR_HOST_URL e SONAR_TOKEN. Nenhum deploy acontece em PR.

Documentos em docs/SESSION_PROOF.md e docs/AFFILIATE_PROOF.md são registros históricos de provas encerradas, sem rotas/telas no runtime atual. O plano principal e os aceites operacionais ficam no workspace e em 1-backend/docs.
