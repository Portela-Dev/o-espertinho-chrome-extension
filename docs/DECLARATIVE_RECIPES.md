# Receitas de conversão

As receitas vêm do backend por marketplace. O executor não contém endpoints ou regras fixas por loja. As requisições usam somente a origem da aba preparada, com sessão do navegador, redirecionamentos recusados e resultado restrito às origens autorizadas.

`executionWorld` é opcional e aceita `ISOLATED` (padrão) ou `MAIN`. O contexto principal usa o `fetch` instalado pela própria página, inclusive seus interceptadores, em vez do `fetch` do mundo isolado. A escolha afeta somente a receita de conversão; descoberta, leitura de produtos e credenciais do backend continuam isoladas. Não fornece implementação de assinaturas nem copia headers de segurança da página para o servidor.

## JSON estruturado

`request.body` aceita um objeto JSON com objetos, listas e valores escalares. Strings podem usar `{{originalUrl}}` e variáveis locais; o executor serializa o resultado com `JSON.stringify`, sem concatenação de JSON ou execução de código. Números, booleanos e `null` mantêm seus tipos. Formulários continuam aceitando somente campos textuais.

Limites: seis níveis, 512 nós e 32 KB. Chaves `__proto__`, `constructor` e `prototype`, números não finitos e valores não JSON são recusados.

`responsePath` aceita índices com pontos, por exemplo `data.links.0.shortLink`. `responseChecks` é opcional e exige igualdade estrita antes de aceitar a URL:

```json
{
  "responsePath": "data.links.0.shortLink",
  "responseChecks": [{ "path": "data.links.0.failCode", "equals": 0 }]
}
```

As receitas anteriores não precisam dessas condições e continuam válidas. Falhas não devolvem o conteúdo sensível da resposta ao backend.

HTTP 401 pausa por autenticação (`login`), 403 por acesso negado (`access_denied`) e 429 por limite de chamadas (`rate_limit`). O status HTTP aparece localmente no painel, sem copiar o corpo da resposta. Uma pausa nunca é retomada automaticamente.

## Header CSRF local

Uma extração `requestHeader` pode observar um header `X-*` ou `csrf-token` explicitamente declarado. A observação exige a mesma aba, origem/endpoint configurados e prazo de validade. Os valores ficam somente no armazenamento de sessão da extensão, com acesso restrito, e nunca fazem parte da configuração salva no servidor. `Cookie` e `Authorization` não podem ser observados por essa operação nem definidos na requisição.

Ao preparar uma receita com essa origem, o usuário precisa realizar uma operação pelo próprio portal para que o header seja observado. Essa funcionalidade não reproduz headers de verificação de tráfego: login ou desafio exigem intervenção humana, e uma recusa não deve iniciar tentativas de contornar a proteção.
