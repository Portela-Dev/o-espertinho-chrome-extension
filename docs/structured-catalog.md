# IA do catálogo: tipos genéricos e processamento completo

No fluxo ativo, todos os itens com link de afiliado devem ser catalogados e categorizados. O título tem prioridade; descrições e fichas técnicas complementam apenas os dados compatíveis. Ausências não inventam atributos e não geram revisão, invalidação ou exclusão.

Sem uma política correspondente, a etapa type identifica o tipo e seus atributos em uma chamada. A IA reutiliza uma política oferecida ou cria uma política reutilizável validada pelo backend. Identidades conhecidas podem dispensar IA. Uma comparação match usa até 20 candidatos, escolhendo um produto existente ou criando um novo. A etapa category sempre escolhe ou cria a categoria; publicação continua manual.

O painel mostra a etapa atual e conta links. No modo estruturado não exibe contadores de excluídos, inválidos ou revisão. Credenciais, login e modelo continuam apenas na extensão. A análise não depende de cookies enviados ao backend e não há implementação por marketplace.

Requer protocolo 3 do backend e migration 045; a extensão recusa iniciar contra um backend anterior. Publicar backend primeiro e recarregar a extensão/configurações. Falhas da IA concluem o item pela alternativa do backend, com diagnóstico fixo e sem erro bruto. A perda da sessão da IA não cancela o lote; só interrupções explícitas ou indisponibilidade do backend pausam o processamento. O timeout por análise é de 30 segundos; duas falhas consecutivas evitam chamadas adicionais naquele lote. Tarefas desativadas ou falta de modelo/conexão impedem iniciar, sem veto de negócio sobre o anúncio. A simulação não grava políticas, produtos ou categorias. Testes usam respostas de IA fictícias, sem consumo da conta real.
