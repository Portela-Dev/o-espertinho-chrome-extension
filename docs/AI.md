# IA do catálogo no painel — prova de conceito

A implementação antiga com auxiliar Node.js e a aba de análise foram removidas. Não há serviço local, porta em escuta, pareamento ou pacote adicional.

## Testar

1. Recarregue a extensão a partir de dist em chrome://extensions.
2. Abra o painel lateral e entre no O Espertinho com permissão de gerar links de afiliados. No modo popup, use Abrir painel para usar IA.
3. Expanda IA do catálogo (teste) e clique em Continue with ChatGPT. Autorize os domínios oficiais e conclua o login. Apenas essa aba é aberta e é fechada ao capturar o retorno.
4. No painel, confira a conta e Usando seu plano ChatGPT. Carregue e selecione um modelo.
5. Capture metadados públicos da aba HTTPS de produto ou preencha os campos manualmente. Confira nome, descrição, marca e categoria de origem. Categorias e produtos candidatos são opcionais e manuais nesta prova.
6. Autorize o envio desta oferta à OpenAI e clique em Analisar esta oferta. O resultado aparece no próprio painel. Cancelar interrompe login/análise; Desconectar limpa a sessão e tenta revogar o token.

## Sessão e segurança

Tokens OAuth, PKCE e resultados ficam apenas na memória deste documento do painel. Fechar, recarregar ou alternar para popup exige novo login. Só identificadores públicos de registro (host/client/conta) são persistidos localmente para reutilizar o registro. Não são salvos tokens em chrome.storage, logs ou backend.

O retorno de login é observado pelo Chrome no loopback 127.0.0.1:18766/auth/callback, sem servidor nessa porta. Somente a aba criada pela tentativa, frame principal, origem/caminho e state exatos são aceitos. PKCE S256, nonce, assinatura da identidade, issuer, audience, validade e escopos são verificados. A aba de login é fechada sem retransmitir o retorno a outra página.

As chamadas são diretas aos endpoints oficiais de autenticação, modelos e Responses da OpenAI. Renovação é serializada. Erros são sanitizados. Captura da página lê apenas metadados públicos limitados; não lê cookies, storage ou scripts arbitrários. O backend recebe apenas a consulta de permissão da conta Espertinho, nunca credenciais ou análises ChatGPT desta prova.

A sugestão não altera categorias, produtos ou publicações. categoryExists depende das categorias fornecidas no formulário; não consulta o banco. Vinculação usa somente IDs candidatos fornecidos. Cor, tamanho e tensão, isoladamente, não distinguem produtos.

## Validação

Login e análise direta de uma oferta foram confirmados pelo administrador na prova anterior, com o auxiliar desligado (tênis Kappa Park 2.0). O teste em Chromium real passou com login, fechamento da aba de autorização, modelos, análise, desconexão e verificação de ausência de credenciais no storage/backend. A repetição com a conta real no painel integrado está pendente. Testes automatizados usam identidades e respostas simuladas, sem acessar a conta real. Esta prova mantém o retorno OAuth experimental já validado, sujeito às condições e limites da conta e da integração.

Execute npm run check, npm run test:native e npm run package. O artefato contém apenas o ZIP da extensão e instruções/checksum.
