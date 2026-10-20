# Prova de conceito: ChatGPT local

Esta prova valida autorização oficial e análise de uma oferta. Não cria categorias/produtos, não vincula ofertas e não publica resultados. Backend e banco não foram alterados. A disponibilidade do uso do plano depende da autorização efetivamente concedida pela OpenAI; não existe fallback para cookies do ChatGPT, endpoints privados ou cobrança automática por API key.

## Executar

Requer Node.js 24 ou superior. Na pasta deste repositório (ou do ZIP do auxiliar), execute:

```powershell
npm run ai:helper
```

Mantenha o terminal aberto. O auxiliar escuta somente `127.0.0.1:18765` e exibe um código de vínculo de uso único, válido até reiniciar. Não abre janelas CMD adicionais. Não é necessário instalar dependências para executar o auxiliar.

1. Gere/carregue a extensão atualizada (`npm run package`, pasta `dist`) e entre no O Espertinho com permissão de gerar links de afiliados.
2. Abra **Assistente IA local — prova de conceito**, cole o código do terminal e clique em **Vincular auxiliar local**. Autorize acesso a `127.0.0.1` quando solicitado.
3. Escolha adicionar uma conta ou uma conta registrada e clique em **Continue with ChatGPT**. Conclua o login e o consentimento oficiais. Confira na extensão a conta conectada e a autorização de uso do plano.
4. Clique em **Carregar modelos da minha conta**. A lista vem da conta autorizada; não há modelo fixo nem troca para uma conta de API.
5. Abra uma página HTTPS de produto. Com ela ativa, use **Capturar dados básicos da aba atual**, ou preencha os campos manualmente. Esta prova lê apenas Product JSON-LD ou metadados públicos; não substitui os seletores de enriquecimento configurados. Marca/categoria podem não estar presentes.
6. Confira os dados. Opcionalmente informe categorias existentes (uma árvore por linha) e até 30 produtos candidatos em JSON, com `id`, `name` e `brand`. Somente estes IDs poderão ser sugeridos para vinculação. Sem candidatos, a prova avalia criação ou revisão.
7. Marque o consentimento e clique em **Analisar esta oferta**. A chamada consome os limites do seu plano. O resultado é uma sugestão local de categoria e criação/vinculação/revisão, sem alterar o catálogo. A sessão só é considerada validada para inferência após uma resposta `response.completed` real.
8. Use **Desconectar ChatGPT** para revogar a sessão. Se a revogação remota não puder ser confirmada, a interface avisa para desconectar nas configurações do ChatGPT. Encerre o auxiliar com Ctrl+C.

O ZIP da extensão e o ZIP `o-espertinho-local-ai-*.zip` são separados no artefato de CI. O auxiliar não deve ser colocado dentro da pasta carregada pelo Chrome. O ZIP do auxiliar contém seu próprio package.json e estas instruções, sem node_modules ou arquivos de sessão.

## Limites da prova

- Uma análise de até dois minutos por vez, cancelável. Sem lote, agendamento ou gravação no backend.
- Os dados enviados à OpenAI são nome, descrição, marca, categoria de origem e candidatos informados. Sem URL de afiliado, cookies, HTML inteiro ou credenciais do Espertinho.
- O resultado e os tokens ficam em memória do auxiliar e somem ao encerrar. O painel pode fechar e reabrir para consultar a mesma análise enquanto o auxiliar estiver ativo. Após reiniciar o Chrome, pode ser necessário reiniciar o auxiliar e vinculá-lo novamente.
- Em Windows, somente identidade de host e registros de contas (client ID, identificador da conta e e-mail) são persistidos em `%LOCALAPPDATA%/O-Espertinho/chatgpt-local/registrations.json`, fora do repositório e OneDrive, com ACL do usuário atual. Linux/macOS usam `~/.local/share/O-Espertinho/chatgpt-local` com permissões restritas. Tokens OAuth nunca são gravados ali.
- A chave de vínculo com o auxiliar (que não é um token ChatGPT) fica em `chrome.storage.session` restrito a contextos confiáveis. Nenhum token OAuth sai do auxiliar. O servidor recusa outros hosts, sites, extensões não vinculadas, métodos e payloads fora dos limites; o código de vínculo tem limite de tentativas.
- OAuth usa PKCE, state e nonce; o ID token é validado por assinatura/JWKS, emissor, audience e expiração. Renovação de token é serializada. Login do Espertinho e ChatGPT são independentes.
- O auxiliar usa somente HTTPS oficial para autorização, metadados, tokens, modelos, inferência e revogação. Não consulta backend ou PostgreSQL.
- Dados das ofertas são tratados como conteúdo não confiável. Não são disponibilizadas ferramentas para a IA executar comandos, consultar o banco ou alterar o catálogo. Sugestões podem estar erradas e exigem revisão humana.

## Verificação

`npm run test:ai` testa OAuth com chaves RSA descartáveis, scopes, renovação, revogação, isolamento HTTP/CORS/Host, limites e respostas SSE incompletas. Não usa sua conta. `npm run check` inclui estes testes. `npm run test:native` valida o painel contra um auxiliar simulado em Chromium temporário; nenhuma conta ChatGPT ou sessão pessoal é usada.

Homologação com a conta real: pendente do login e da análise pelo administrador. Nunca envie tokens ou cookies em mensagens de suporte. Informe somente a mensagem sanitizada que aparece no painel.

Referências oficiais consultadas em 20/10/2026:

- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
