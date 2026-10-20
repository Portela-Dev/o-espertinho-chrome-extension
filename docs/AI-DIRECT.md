# Segunda prova: ChatGPT diretamente na extensão

Esta prova mantém OAuth, tokens, modelos e análise dentro de uma aba interna da extensão. Não inicia processo Node, servidor HTTP ou serviço remoto para IA. O backend continua sendo usado pelo login administrativo existente, mas nunca recebe tokens ChatGPT, códigos OAuth, verificadores PKCE ou resultados desta prova.

## Teste real

1. Encerre o auxiliar anterior com Ctrl+C no terminal de `npm run ai:helper`. Não inicie esse comando neste teste.
2. Recarregue a extensão atualizada em `chrome://extensions`, usando a pasta `dist` do projeto.
3. Entre no O Espertinho com permissão de gerar links de afiliados. Abra uma página HTTPS de produto e depois o painel da extensão.
4. Em **Assistente IA local — prova de conceito**, clique em **Testar sem auxiliar — abrir aba de IA**. Isso captura apenas os metadados públicos da oferta, quando disponíveis, e abre a página interna. Se não houver metadados/permissão da aba, preencha manualmente os campos.
5. Mantenha a nova aba aberta e clique em **Continue with ChatGPT — sem auxiliar**. Autorize os hosts oficiais e o retorno local quando o Chrome solicitar. Conclua o login e o consentimento da OpenAI na aba criada pela prova.
6. Volte à aba de IA. Confira **Conta conectada diretamente pela extensão**, o e-mail da conta e **Usando seu plano ChatGPT**. O indicador de retorno deve informar que ele foi reconhecido. A aba de retorno não contém parâmetros ou tokens.
7. Clique em **Carregar modelos da minha conta**, escolha um modelo e confira os dados da oferta. Categorias e produtos candidatos são opcionais.
8. Marque o consentimento de envio dos dados à OpenAI e clique em **Analisar esta oferta**. Aguarde a conclusão. A prova sugere categoria e criação/vinculação/revisão; nenhum dado é aplicado ao catálogo.
9. Use **Desconectar ChatGPT** antes de fechar. Se a revogação remota não for confirmada, desconecte o aplicativo também nas configurações do ChatGPT. Fechar/recarregar a aba apaga os tokens locais, sem garantir revogação remota.

## Como o retorno funciona

O callback experimental é `http://127.0.0.1:18766/auth/callback`, diferente da porta do auxiliar anterior. Não há servidor nessa porta. Um listener não bloqueante de `webRequest.onBeforeRequest` reconhece somente a navegação principal da aba criada pela própria tentativa, no endereço exato e com state correspondente. O código é trocado diretamente com a OpenAI usando PKCE e a mesma redirect_uri. O ID token é verificado por Web Crypto: assinatura/JWKS, issuer, audience, nonce e validade. A aba de login é substituída por uma página interna sem parâmetros. Outros retornos, abas, frames e tentativas expiradas são ignorados; o callback é consumido uma única vez.

Este retorno observado pelo Chrome é uma hipótese experimental, diferente do listener HTTP descrito pela documentação da OpenAI. Um teste automatizado com endpoints simulados não comprova aceitação pela conta real nem suporte oficial dessa combinação. A prova não lê cookies, DOM ou armazenamento do ChatGPT, não captura sessões de outros aplicativos e não usa endpoints privados. Se a autorização for recusada, o erro é apresentado; não existe fallback para capturar credenciais existentes.

## Sessão e isolamento

- Tokens OAuth, state, nonce e PKCE ficam apenas em memória desta aba. Não são gravados em storage.local/session/sync, IndexedDB, URL interna, logs, mensagens da extensão ou backend.
- Somente um identificador de host estável e registros não secretos de contas (client ID, identificador da conta e e-mail) ficam em `chrome.storage.local`, restrito a contextos confiáveis. Eles não permitem chamadas de IA sem novo login.
- O rascunho de oferta capturado pelo painel contém apenas nome, descrição, marca e categoria, em `chrome.storage.session` confiável; não contém credenciais.
- A página não exporta a sessão ou tokens via runtime messaging. A única mensagem ao runtime é STATE, para verificar a permissão administrativa existente.
- Uma análise por vez, com até dois minutos, cancelável. Fechar a aba interrompe a prova. Resposta sem `response.completed`, modelo não disponível ou produto inventado é recusado.
- Autorização, validação de identidade, renovação serializada, revogação, prompt e validação da análise compartilham módulos com o auxiliar. A primeira prova permanece disponível, sem iniciar automaticamente.

## Validação

Testes unitários cobrem retorno de outra aba/frame/path/state, replay, cancelamento, permissão administrativa e ausência de tokens em storage/backend. O teste Chromium navega de um endpoint OAuth simulado para uma porta local sem servidor, observa o retorno real pelo Chrome, valida um JWT assinado com chave descartável, faz uma análise SSE simulada e confere que os tokens não foram persistidos ou enviados ao backend. Não usa a conta pessoal.

Homologação com conta real desta segunda prova: pendente da interação do administrador. A primeira prova com auxiliar foi confirmada como funcional pelo administrador.

Referências consultadas em 20/10/2026:

- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developer.chrome.com/docs/extensions/reference/api/webRequest
