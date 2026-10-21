# O Espertinho — extensão Chrome

Extensão Manifest V3/TypeScript para seis etapas manuais de manutenção do catálogo, usando receitas e seletores do backend, sem implementação fixa por marketplace.

## Instalar e conectar

Node 24 e Chrome 120+. Execute `npm ci` e `npm run package`. Carregue dist em chrome://extensions ou extraia o ZIP de artifacts em pasta permanente e carregue a pasta com manifest.json. Após atualizar, recarregue a extensão. O pipeline gera ZIP, checksum e instruções, sem deploy/Web Store.

BACKEND_URL no .env ou variable do build define a origem da API (padrão http://localhost:3000). A conexão pode ser alterada na interface após sair. Não coloque segredos no .env da extensão. Produção usa HTTPS. Nenhuma credencial de marketplace é embutida no pacote.

O ícone da extensão abre o painel lateral por padrão. O botão de ícone no cabeçalho alterna entre painel lateral (janela com coluna lateral) e popup (janela com pequeno painel), com tooltip e nome acessível indicando o destino. A preferência é salva; o painel permanece aberto enquanto você usa a página. O seletor visual e sua composição continuam disponíveis, com edição e contagem de matches. Pause a coleta antes de inspecionar uma página.

Atualizar configurações consulta somente configurações e contadores; não depende da execução salva. O acompanhamento trata uma execução removida no backend descartando apenas suas referências locais, sem encerrar a conta ou reenviar resultados antigos. Erros de ações, processamento e consulta aparecem em uma notificação fixa na parte inferior, com fechamento manual e duração de dez segundos. Mensagens repetidas do acompanhamento não reabrem continuamente a notificação. A confirmação de atualização de configurações usa a mesma apresentação, com cor de sucesso.

Entre no O Espertinho e aprove no site com a conta Google autorizada. A extensão exige affiliate_links e, por etapa, discovery, catalog ou updates. Requisições são autorizadas novamente pelo backend. Sessões revogadas/expiradas interrompem o fluxo.

## Seis etapas

1. **Extrair links:** carrega vitrines/perfis habilitados e percorre a paginação configurada. Envia URLs e origem, não dados incompletos de cards.
2. **Gerar links de afiliados:** processa candidatos ainda sem conversão usando a receita cadastrada. Categoria/produto ainda não são necessários. A URL original é preservada separadamente.
3. **Extrair informações:** navega na URL original dos produtos que já possuem link de afiliado e aplica os seletores de produto; grava categorias de origem e dados para revisão, sem confirmar mapeamentos ou publicar.
4. **Catalogar produtos:** reutiliza produtos e rascunhos globais; confirma decisões válidas.
5. **Categorizar produtos:** reutiliza árvores existentes e finaliza novos produtos, aplicando decisões válidas.
6. **Analisar Preços:** atualiza ofertas publicadas e seu histórico diário. Falha técnica mantém o último preço e a oferta.

No admin, revise as decisões aplicadas, resolva ambiguidades e publique explicitamente. Cada botão inicia só sua própria etapa. Limite de itens e inclusão de falhas ficam na interface. Novas configurações valem para execuções novas.

Os botões 2 e 3 mostram links já gerados e extrações concluídas / total de links descobertos não arquivados do marketplace selecionado. Os rótulos Gerados e Extraídos distinguem conclusão de pendência; falhas não contam como conclusão. A inclusão de falhas altera os elegíveis da extração. O botão 6 mostra ofertas sem verificação bem-sucedida nas últimas 24 horas / ofertas publicadas com link de afiliado; falhas técnicas não renovam a data. Esse indicador não restringe a execução manual, que continua podendo verificar todas as ofertas, começando pelas mais antigas. Os totais independem do máximo de itens por execução. Contadores são atualizados ao trocar o filtro, atualizar configurações e concluir uma execução, com cache de até 15 segundos durante a consulta do painel. Falhas de consulta mostram indisponibilidade, sem inventar valores zero. Execução atual e histórico identificam a etapa; a execução atual também identifica o marketplace.

## Aba, bloqueios e retomada

O processamento cria e ativa uma aba própria na mesma janela em que você interage com a extensão. Após a abertura, se você voltar para outra aba, as navegações seguintes do lote respeitam essa escolha e não retomam o foco. Preparar aba / fazer login e Abrir aba de processamento a ativam explicitamente para permitir sua interação. Uma aba própria existente de uma janela antiga pode ser movida para a janela atual; outras abas do usuário não são reutilizadas. Se a aba for fechada, use Abrir aba de processamento para recriá-la e depois Continuar para retomar a mesma execução.

Faça login na aba de processamento quando necessário. A receita pode extrair o token automaticamente com source=dom, selector=meta[name="csrf-token"] e attribute=content, preservando o nome da variável usada no header da requisição. O valor é relido a cada conversão, permanece no contexto isolado da aba e nunca é enviado ao backend. Se o elemento estiver ausente ou o marketplace recusar a sessão, o fluxo pausa para intervenção, sem tentar gerar um token artificialmente. Essa estratégia é configurável para qualquer marketplace. A observação manual permanece disponível apenas se a receita usar requestHeader: somente o header X- da chamada, aba e origem configuradas fica em storage.session confiável, com prazo de 15 minutos e limpeza ao sair. Ele nunca integra resultados enviados ao backend.

Login, CAPTCHA, acesso negado ou limite são detectados por regras de URL, seletores ou texto e pausam o processamento. Resolva manualmente na mesma aba e clique Continuar; a extensão verifica novamente. Não há resolução automática de desafios ou troca de identidade para evitar bloqueio.

Uma regra de estado unavailable é um resultado válido: ao encontrar o indicador configurado, a extração encerra a espera sem exigir preço. Login e desafios têm prioridade caso vários indicadores coincidam. A ausência de preço sem esse indicador continua sendo falha técnica, preservando a última disponibilidade conhecida. Cadastre a regra em Admin → Marketplaces → Execução pela extensão → Detecção de estados; nenhum seletor é fixo no executor.

Painel pode ser fechado sem perder progresso. Use Carregar execuções para retomar uma execução própria ou prévia solicitada no admin; a lista tem paginação e tamanho selecionável. Pausar/cancelar é explícito. Reservas e respostas pendentes são persistidas; resultados repetidos são idempotentes no backend. Uma retomada invalida reservas antigas e reextrai o item ainda não confirmado.

O computador e o Chrome precisam estar disponíveis. Suspensão, abas congeladas/descartadas, perda de rede ou janela fechada podem pausar a execução. Não existe garantia de processamento com janela minimizada. Iframes configurados não são suportados nesta versão e causam falha controlada; documento principal, links de próximo, templates de URL, carregar mais e rolagem usam configurações limitadas.

## IA do catálogo (teste)

Login com ChatGPT, modelos e análise de uma oferta ficam no painel lateral da extensão. Apenas a autorização abre uma aba; ela fecha após o retorno. Não há auxiliar, servidor local ou aba separada de análise. Tokens ficam exclusivamente na memória do painel, sem envio das credenciais ao backend. Fechar/recarregar o painel exige novo login. Veja [instruções e limites](docs/AI.md).

## Segurança e limites do catálogo

Em Admin → Exploração → Perfis, a paginação por rolagem permite avançar por distância ou ir até o fim do conteúdo carregado. A segunda opção repete a ida ao fim quando novos cards aumentam a página e aguarda os tempos de hidratação configurados. Só encerra por falta de progresso após as tentativas configuradas no fim da página, sem novos links nem aumento de altura. Funciona também com um contêiner de rolagem configurado, sem código específico por marketplace.

O total descoberto considera URLs únicas após normalização. Releituras dos mesmos cards e retomadas não somam novos itens; o backend conserva essa contagem e aplica o limite de itens únicos. Login e desafios continuam pausando o processamento para intervenção manual.

Cookies, Authorization, tokens CSRF e storage do marketplace não são enviados ao backend. Sessão é enviada apenas pelo próprio navegador à origem do marketplace. Há permissão obrigatória apenas para o host da API e permissões opcionais por domínio de navegação. A antiga permissão cookies e as POCs de exportação de sessão foram removidas do pacote.

Receitas suportam extract, request GET/POST na mesma origem, fill e click, com variáveis locais e responsePath. Headers reservados são recusados. Não há eval, scripts remotos ou código por loja. Receitas complexas não suportadas devem permanecer pendentes, sem fallback específico.

## Testar e empacotar

- `npm run check`: TypeScript, HTML, testes e cobertura.
- `npm run test:native`: quatro passos em Chromium real, com páginas HTTPS e API descartáveis. Requer Chromium do Playwright e OpenSSL; `npx --no-install playwright install chromium` prepara o navegador.
- `npm run package`: build de produção sem source maps e ZIP instalável com checksum.

Playwright é dependência somente de testes e não entra no ZIP. O teste nativo usa perfil temporário, certificado descartável e flags exclusivamente de teste; não acessa perfil pessoal, banco ou sessões reais. A API de fixture não substitui os testes SQL do backend. O CI instala Chromium e executa esse teste além dos unitários.

SonarQube permanece no runner Windows windows-portela-dev; validação/pacote ficam em ubuntu-22.04, preservando a sandbox do Chromium. Projeto Sonar: o-espertinho-chrome-extension. Configurações: SONAR_ENABLED, SONAR_HOST_URL e SONAR_TOKEN. Nenhum deploy acontece em PR.

Documentos em docs/SESSION_PROOF.md e docs/AFFILIATE_PROOF.md são registros históricos de provas encerradas, sem rotas/telas no runtime atual. O plano principal e os aceites operacionais ficam no workspace e em 1-backend/docs.

Contas Espertinho e ChatGPT são gerenciadas no topo. A IA reutiliza a única barra de Execução atual, incluindo pendências na quantidade processada, sem contá-las como links catalogados. O login e o início da tarefa substituem o antigo checkbox adicional. Não há mais seção de análise avulsa. Consulte docs/AI.md.

O card Contas reúne Google/Espertinho, ChatGPT e modelo. A interface compacta mantém somente controles, estados e contadores, sem informações de consumo ou nomes de produtos durante a IA.

Os cards Contas, Manter catálogo, Selecionar elementos e Configuração da conexão iniciam recolhidos. Clique no título (ou use Enter/Espaço no teclado) para expandir. Recolher não interrompe execuções nem descarta a sessão/modelo do painel.
