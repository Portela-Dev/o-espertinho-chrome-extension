# O Espertinho — Chrome Extension

Extensão Chrome Manifest V3 em TypeScript, com autenticação real no O Espertinho e executor genérico de conversão orientado por configuração. A versão 0.2.0 usa filas e receitas mockadas do backend para testar o fluxo completo. Não possui implementação específica para Amazon, Mercado Livre ou qualquer outra loja.

## Testar localmente

Requisito: Node.js 24 e Chrome. O backend precisa estar na branch que implementa `/api/extension`, com a migration `019_extension_access.sql` aplicada.

No backend (`1-backend`):

```powershell
npm run db:migrate
npm run dev
```

Use o frontend normalmente para entrar com Google. O login existente continua validando a identidade no backend. Abra o site com `localhost`, assim como a URL do backend, para que a aba de autorização compartilhe o cookie; misturar `127.0.0.1` e `localhost` não compartilha a sessão.

Na extensão:

```powershell
npm ci
Copy-Item .env.example .env  # Somente se ainda não existir .env
npm run check
npm run package
```

O `.env` contém `BACKEND_URL=http://localhost:3000`. O build incorpora o endereço como padrão; não incorpora credenciais. O valor também pode ser alterado nas configurações da extensão, depois de sair da conta. URLs de produção devem usar HTTPS; HTTP é permitido somente em localhost/127.0.0.1.

1. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e carregue `dist` em **Carregar sem compactação**. Se já instalou o boilerplate, recarregue a extensão e confirme as novas permissões.
2. Abra a extensão e clique em **Entrar no O Espertinho**.
3. Na aba aberta, entre no site com Google se necessário, clique em **Verificar login novamente** e depois em **Autorizar extensão**. Somente perfis com a permissão **Gerar links de afiliados pela extensão** podem autorizar. A migration concede essa permissão ao perfil Administrador; outros perfis podem recebê-la na gestão de perfis já existente.
4. Volte ao popup. A conexão pode levar até 30 segundos se o popup esteve fechado.
5. Escolha **Loja demonstrativa** e clique em **Gerar links pendentes**. A extensão abre uma aba local e processa cinco itens em lotes de dois.
6. Confira progresso e resultados; teste **Pausar**, **Continuar geração**, **Reiniciar demonstração** e **Sair**.

O teste não cadastra ofertas ou produtos e não gera comissões reais. Nenhum cookie de marketplace é enviado ao backend.

## Sessão e permissões

A extensão inicia um pareamento de cinco minutos com desafio SHA-256 e verificador secreto local. A aprovação usa a sessão Google existente do site e sua proteção XSRF. O segredo de verificação não aparece na URL da aba. O backend entrega um token opaco de acesso de 15 minutos e refresh token de até sete dias, com rotação. A sessão também depende da validade da sessão do site.

Os tokens da extensão ficam no armazenamento local do perfil Chrome, restrito aos contextos confiáveis da extensão, sem sincronização. Somente hashes são persistidos pelo backend. A permissão `affiliate_links` é verificada a cada chamada; bloquear o usuário, remover a permissão ou sair do site impede o acesso. Sair da extensão revoga sua sessão e interrompe o processamento local.

O backend deve responder em `EXTENSION_BACKEND_URL=http://localhost:3000`. `EXTENSION_MOCK_ENABLED=true` habilita as rotas fora de produção; em produção elas sempre ficam desativadas nesta implementação.

## Executor declarativo

O backend entrega `/api/extension/config`, com versão do contrato, indicação de mock e lista de marketplaces. Cada receita define:

- `id`, `name`, `loginUrl` e `allowedOrigins`.
- `affiliateOrigins`: origens aceitas nos links retornados.
- `batchSize` e `intervalMs` (100 a 60.000 ms).
- `steps`: operações suportadas pelo executor.

Operações disponíveis:

- `extract`: ler texto/atributo de um seletor DOM, uma chave de localStorage/sessionStorage ou um cookie acessível a JavaScript.
- `fill` e `click`: preencher um campo e acionar um elemento.
- `request`: chamada GET/POST na mesma origem da aba, com sessão do navegador, headers configuráveis, corpo JSON/form e extração do resultado por caminho JSON, como `data.shortUrl`.

Templates aceitam `{{originalUrl}}`, variáveis extraídas como `{{csrf}}` e codificação `{{originalUrl|urlencode}}`. As variáveis da sessão são usadas somente no mundo isolado da aba e somente o link final ou um erro genérico retorna ao worker. Cookies HttpOnly são enviados pelo navegador quando aplicável; não são lidos nem exportados pela extensão.

Não há eval, JavaScript remoto, plugins por marketplace ou manipulação de headers reservados como Cookie/Origin/Host. As requisições de conversão não seguem redirecionamentos e não enviam os valores extraídos a outra origem. Se um fluxo exigir operações não suportadas, ele deve permanecer pendente para uma evolução futura; não existe uma implementação alternativa específica para aquela loja.

Domínios HTTPS dos marketplaces são permissões opcionais, solicitadas ao clicar em abrir/gerar. O build concede acesso inicial somente ao host do backend. Nenhum token do O Espertinho é passado à receita ou à aba do marketplace.

## Lotes e retomada

O processamento acontece no service worker, continua com o popup fechado e usa um alarme para recuperar o estado após suspensão. Configuração, progresso, reserva e resultados ainda não enviados são salvos localmente. Há uma única execução por instância da extensão.

O mock reserva até dois itens por 120 segundos, vincula a reserva à sessão da extensão e aceita reenvio idempotente dos mesmos resultados. Uma falha de rede pausa sem apagar o lote local. A ausência de sessão do marketplace também pausa e abre sua aba para intervenção. Reservas expiradas são buscadas novamente. Intervalos longos e suspensão do Chrome podem atrasar a retomada; o alarme tem período de 30 segundos.

A fila mockada fica em memória no backend, separada por usuário. Reiniciar o backend recria a demonstração; as sessões da extensão são persistidas no PostgreSQL. A fila real, a gestão das receitas no admin e a publicação são etapas futuras do backend.

## Pacote e pipeline

`npm run package` gera em `artifacts` o ZIP `o-espertinho-chrome-extension-0.2.0.zip`, `SHA256SUMS` e `INSTALAR.txt`. Para instalar o ZIP, extraia-o em uma pasta permanente e carregue a pasta que contém `manifest.json` em `chrome://extensions`.

O workflow **CI e pacote da extensão** valida TypeScript, HTML, testes e dependências, e disponibiliza o pacote por 30 dias. Build roda em `ubuntu-latest`, sem deploy. A variable opcional `BACKEND_URL` do GitHub define o padrão do pacote; sem ela, usa `http://localhost:3000`.

SonarQube usa somente o runner `[self-hosted, Windows, X64, windows-portela-dev]` em develop, quando `SONAR_ENABLED=true`. Precisa do projeto `o-espertinho-chrome-extension`, secret `SONAR_TOKEN` com permissão de análise e variable `SONAR_HOST_URL`. A análise aguarda o Quality Gate. Pull requests não executam código no runner próprio.

O teste de pacote verifica ZIP, recursos, permissões e checksum. Os testes do executor verificam uso local dos valores de sessão, bloqueio de outra origem, login pendente e respostas inválidas. A validação integrada em Chromium foi feita com o backend real e banco descartável; a identidade Google é substituída somente na configuração de teste, sem bypass de login no runtime.

## Seletor visual de elementos

Abra uma página HTTP/HTTPS, abra a extensão e clique em **Selecionar elementos na aba atual**. A ferramenta usa `activeTab`: o acesso é temporário à aba em que você a ativou, sem uma permissão permanente para todos os sites. A inspeção é local, independente do login e não envia HTML, cookies ou seletores ao backend. Pause a geração de links antes de iniciar a inspeção.

- Passe o mouse e clique para fixar um alvo. Escolha um ancestral pela trilha, use **↑ Pai / ↓ Filho**, ou as teclas ↑ e ↓. O caminho de volta ao filho inspecionado é lembrado.
- Use **Adicionar à seleção** ou Enter para confirmar. **Voltar a apontar** libera o mouse para escolher outro exemplo. Há suporte a até 20 exemplos, remoção individual e limpeza da seleção.
- Em **Padrão**, os candidatos incluem os exemplos e podem encontrar outros elementos semelhantes; a contagem mostra quantos resultados adicionais existem. Em **Exato**, a expressão deve encontrar somente os exemplos selecionados. Quando não há um padrão simples, ela pode ser uma lista de seletores separados por vírgula. Caminhos posicionais são identificados como mais frágeis.
- **Usar como escopo** limita as consultas ao elemento atual, útil para obter seletores relativos a um card. A seleção é limpa ao trocar o escopo. **Escopo: documento** retorna ao documento principal. Copie e use o seletor relativo com o mesmo escopo no extrator.
- A prévia marca exemplos em verde, resultados em azul e alvo em laranja. O destaque fica limitado aos primeiros 60 resultados; a contagem permanece completa. O painel pode ser movido para o outro lado.
- **Copiar seletor** copia o CSS. Se a área de transferência for negada, o campo é selecionado para cópia manual com Ctrl+C. Seletores acima de 600 caracteres recebem um aviso por excederem o limite atual dos cadastros.
- Esc ou **Fechar** remove o painel, destaques e interceptação de cliques/teclas. Ativar novamente substitui a instância anterior. Mudanças no DOM atualizam a seleção e removem referências a elementos que desapareceram.

Esta versão inspeciona somente o documento principal, sem atravessar iframes ou árvores shadow. Páginas internas do navegador, a loja de extensões e documentos protegidos podem impedir a injeção. Os candidatos são validados no DOM atual; não há garantia de estabilidade após mudanças de layout/estado do site. A ferramenta prefere identificadores/atributos/classes com aparência estável e evita classes aparentemente geradas e estados transitórios, mas a revisão visual continua necessária. Não há gravação automática nos perfis do Espertinho nesta entrega.
