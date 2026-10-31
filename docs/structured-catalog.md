# Resolução estruturada na extensão

Correção: a preparação por IA é restrita aos candidatos relacionados ao link atual; não existe uma preparação global obrigatória antes do primeiro link. A interface informa a etapa, distingue falha de análise de rejeição ao salvar e identifica resultados de simulação como "simulados (sem salvar)". As regras de negócio dos prompts antigos são preservadas, mas suas ações legadas são explicitamente traduzidas para o contrato estruturado na instrução enviada ao modelo.

Os botões 4/5 usam o modo configurado no backend: anterior, simulação (inicial) ou ativo. No modo novo não baixam todo o inventário nem comparam cada oferta com todos os produtos. O backend fornece políticas/evidências e candidatos limitados. Identidades completas, decisões reaproveitáveis e categorias pré-configuradas dispensam IA; demais casos fazem uma chamada curta por etapa. Produtos antigos são preparados uma vez, sem alterar seus IDs ou vínculos.

A IA retorna atributos com citações literais ou categoria; o backend valida e aplica transacionalmente. Ambiguidades são excluídas com motivo, sem novos invalid/needs_review. Falhas técnicas têm repetição limitada. Publicação permanece manual. Sem credenciais de IA no backend; a conexão e o modelo existentes continuam persistidos e desconectar continua revogando a sessão.

A barra única conta links. Preparação do inventário é contabilizada separadamente no admin. Reservas e progresso ficam persistidos no backend. Ao fechar/trocar ambiente/cancelar localmente, a execução é pausada; ao iniciar novamente, retoma a pendente. Cancelamento definitivo está no menu da execução no admin.

Concorrência é limitada a 1 ou 2 conforme configuração do admin. O cache de modelos é usado somente durante análise; recarregar modelos manualmente consulta o provedor. Não usa Batch API ou parâmetros não confirmados para assinatura/OAuth. Os tokens reportados são métricas do provedor, não uma medição da cota do plano.

Requer backend com migration 043. O modo de simulação não modifica o catálogo. Antes de ativar, valide amostra real e calibre políticas. Evidência literal não garante interpretação semântica perfeita. Testes automatizados usam respostas fictícias e não gastam a conta do usuário. Sem deploy nesta entrega.
