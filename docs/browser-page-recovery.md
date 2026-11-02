# Recuperação de acesso às páginas

A leitura de página verifica origem/permissões e espera a navegação atual, sem aceitar o status complete do documento anterior. Injeção recusada por acesso do Chrome tem até três tentativas limitadas; outras exceções não repetem o script, preservando operações de conversão. Redirecionamentos fora dos hosts configurados, login/CAPTCHA e permissão revogada continuam exigindo intervenção.

Páginas ilegíveis e timeout de um item de preços/enriquecimento deixam atualização pendente e permitem continuar o lote. Não inferem indisponibilidade nem alteram preço por falta de acesso. Continuar solicita permissão dos hosts do marketplace da execução e retoma o mesmo ciclo.

Pular registro e continuar fica disponível para preços/enriquecimento pausados com um item reservado, sem resultado pendente de confirmação. Envia itemId/leaseToken ao endpoint autenticado do backend e mantém o preço/histórico. Itens pulados entram no progresso, permanecem elegíveis para ciclos futuros e não geram execução nova. Respostas tardias anteriores ao pulo são ignoradas.

Requer backend com capabilities.skipItem=true para habilitar o botão. Publicar backend primeiro; no painel, Atualizar configurações. Sem a capacidade, o botão fica desabilitado com orientação. O reparo genérico de navegação/preços continua compatível com o backend anterior.
