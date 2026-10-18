# O Espertinho — Chrome Extension

Boilerplate de extensão Chrome Manifest V3 em TypeScript. Possui popup, identidade visual do O Espertinho, suporte ao tema do sistema e um service worker vazio. Não implementa login, coleta, conversão de links ou integrações com marketplaces. Não solicita permissões de navegação, cookies ou acesso a sites.

## Executar localmente

Requisito: Node.js 24 ou superior, com npm.

```powershell
npm ci
npm run check
npm run build
```

Abra `chrome://extensions`, ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione a pasta `dist` deste projeto. Fixe a extensão no menu de extensões para abrir o popup. Depois de alterar o código, execute `npm run build` novamente e recarregue a extensão nessa página.

## Gerar o pacote

```powershell
npm run package
```

O diretório `artifacts` recebe:

- `o-espertinho-chrome-extension-0.1.0.zip`: extensão compilada, com `manifest.json` na raiz.
- `SHA256SUMS`: checksum do ZIP.
- `INSTALAR.txt`: instruções de instalação.

Extraia o ZIP em uma pasta permanente e carregue essa pasta em `chrome://extensions`. O pacote não é um instalador automático `.exe`/`.crx`. A distribuição pela Chrome Web Store e atualizações automáticas estão fora deste boilerplate. [Instalação de extensões em desenvolvimento](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).

## GitHub Actions

O workflow **CI e pacote da extensão** roda em push para `main`/`develop`, em pull requests para essas branches e manualmente. Instala as dependências pelo lockfile, audita todas as dependências, valida TypeScript e HTML, verifica o conteúdo do ZIP e publica o pacote por 30 dias. Não há deploy.

Para baixar: **Actions → CI e pacote da extensão → execução → Artifacts → o-espertinho-chrome-extension-...**. Extraia o arquivo externo baixado do GitHub e depois o ZIP da extensão que está dentro dele. Os passos completos acompanham o artefato em `INSTALAR.txt`.

Build e empacotamento usam `ubuntu-latest` e não exigem secrets ou variables. Somente a análise opcional do SonarQube usa `[self-hosted, Windows, X64, windows-portela-dev]`, em `develop`. Para habilitá-la:

1. Crie no SonarQube o projeto com chave `o-espertinho-chrome-extension`.
2. Cadastre o secret `SONAR_TOKEN` e a variable `SONAR_HOST_URL` no GitHub.
3. Libere o repositório no grupo do runner da organização.
4. Defina a variable `SONAR_ENABLED=true`.

A análise aguarda o Quality Gate. Como este é um boilerplate sem regras de negócio, ainda não há cobertura da interface do navegador; o teste existente valida o pacote real, seus recursos e checksum. O artefato fica disponível após o job de build, independentemente da análise opcional. Não habilite acesso do runner próprio para pull requests externos; o workflow não executa Sonar em PRs.

## Estrutura

```text
extension/       Manifest, popup, estilos e ícones
src/             TypeScript do popup e service worker
scripts/         Build e empacotamento
test/            Verificação do pacote gerado
docs/            Instruções incluídas no artefato
.github/         Workflow e configuração do actionlint
```

Mantenha a versão de `package.json` igual à de `extension/manifest.json`. O build recusa versões divergentes. A CSP bloqueia conexões externas neste estágio; as permissões e a comunicação com o backend serão definidas em uma implementação futura, mantendo a extensão genérica e orientada por configuração.
