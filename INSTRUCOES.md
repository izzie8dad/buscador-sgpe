# Instruções para IA — SGPe Buscador de Páginas

Este arquivo é contexto para qualquer IA (Claude ou outra) que for solicitada a criar,
alterar ou revisar funcionalidades neste projeto. Leia-o inteiro antes de mexer no código.

## 1. O que este projeto é

Extensão Chrome (Manifest V3), **não oficial**, para o SGPe (Portal de Processos Eletrônicos
do Estado de Santa Catarina, `sgpe.sea.sc.gov.br`). Ela adiciona uma caixa flutuante
("Buscador SGPe") sobre a tela da Pasta Digital (Aba Peças) de um processo, com três formas
de localizar conteúdo sem precisar rolar a árvore manualmente:

1. **Busca por número de página** — digita um número, a extensão localiza a peça que contém
   aquela página na árvore já carregada e simula o clique nela.
2. **Busca por nome de peça** — digita parte do nome, mostra as peças correspondentes pra
   escolher.
3. **Busca por palavra-chave** — baixa o PDF de cada peça (mesma sessão autenticada do
   usuário, mesma origem) e lê o texto nativo localmente via `pdf.js` (sem OCR), indicando em
   qual peça/página o termo aparece.

Autor: Daniel Rohden Speck (CONIN FCC). Não há vínculo oficial com o SGPe/SEA-SC.

## 2. Estrutura de arquivos

```
manifest.json                  Manifesto MV3 - permissões, content_scripts, background
background.js                  Service worker: menu de contexto + injeção sob demanda do pdf.js
content-script.js              TODO o resto - UI, lógica de busca, leitura da árvore (ES5, IIFE única)
README.md                      Changelog versionado (mais recente no topo) + notas técnicas
privacy-policy.html            Política de privacidade (Chrome Web Store)
icons/                         Ícones da extensão (16/32/48/128)
vendor/                        pdf.js embutido (pdf.min.js, pdf.worker.min.js) - biblioteca de terceiros, não editar
store-assets/                  Textos pra ficha da Chrome Web Store (ver seção 5)
INSTRUCOES.md                  Este arquivo
```

Não há build step. Os arquivos `.js` são carregados diretamente como extensão
"descompactada" (`chrome://extensions` → Modo desenvolvedor → Carregar sem compactação).

### Pasta ativa — cuidado

O diretório pai (`..`) tem **várias pastas e `.zip` de versões antigas/paralelas**
(`sgpe-page-finder-extension-1.20.8`, zips até `1.24.0.zip`, etc.). **A pasta ativa e
correta é sempre esta** (`sgpe-page-finder-extension-1.21.0/`, apesar do nome não bater
com a versão do `manifest.json` de dentro dela — confirme pelo campo `"version"` do
`manifest.json`, não pelo nome da pasta). Nunca edite as outras pastas/zips.

## 3. Arquitetura do `content-script.js`

Um único IIFE `(function () { 'use strict'; ... })()`, ES5 (sem `const`/`let`/arrow
functions), injetado em **todos os frames** (`all_frames: true`, `document_start`) das
páginas do SGPe. Isso importa porque o SGPe usa vários frames/framesets aninhados — nem
todo frame tem a árvore de peças, então boa parte do código lida com "em qual frame estou
e o que faço se a árvore não estiver aqui".

Seções principais (na ordem em que aparecem no arquivo):

1. **Guarda de entrada** (topo): sai cedo se não for `https://sgpe.sea.sc.gov.br`, se o path
   não bater com `ALLOWED_PATH_PREFIXES`, ou se o script já rodou nesse frame
   (`window.__codexSgpePageFinderInstalled`).
2. **Detecção de estrutura** (`detectSgpeStructure`, `isKnownAlternateSgpeScreen`,
   `scheduleStructureWarning`) — verifica se a árvore de peças (`SGPE_SELECTORS`) existe
   nesta tela; se não existir e não for uma "tela alternativa conhecida" (Inserir Peça,
   Encaminhamento, frames casca), mostra um aviso "Buscador indisponível nesta tela".
3. **Leitura da árvore** (`getPiecesRoots`, `getPiecesFromRoot`, `getAllPieces`,
   `getProcessLi`, `getRootLabel`) — parseia `li.i[data-p]` (atributo com
   `nuPaginaInicial`/`nuPaginaFinal`) pra montar a lista de "peças" com intervalo de página
   real (do SGPe) e intervalo local/sequencial (calculado pela extensão, por processo).
4. **Filtro manual de processo** (`manualProcessFilterActive`, `manualProcessFilter`,
   `getEffectiveProcessFilter`, `refreshProcessSelect`, `renderProcessMenu`) — controle
   custom "Nº do Processo" (não é um `<select>` nativo, ver comentário no código) que
   restringe as buscas a um processo específico (mãe ou apensado). Padrão: processo mãe.
5. **Busca por palavra-chave** (`ensurePdfJsLoaded`, `extractPieceText`, `runKeywordSearch`,
   `startKeywordSearch`) — busca o texto do PDF via `pdfjsLib` (carregado sob demanda pelo
   `background.js`, só quando usado).
6. **Simulação de clique na árvore** (`dispatchClick`, `expandTreeNode`, `collapseTreeNode`,
   `highlightTreePosition`, `openPageInPiece`) — abre uma peça/página simulando eventos de
   mouse nos elementos da árvore **do próprio SGPe**. **Ver seção 4.3 antes de mexer aqui.**
7. **UI** (`installUi`, `installExpandedUi`, `makeEl`, `makeDraggable`) — monta a caixa
   flutuante (mini e expandida) com DOM puro, sem framework.
8. **Menu de contexto** (`handleSearchInProcessRequest`, `extractPageNumberFromSelection`,
   `chrome.runtime.onMessage`) — recebe o gatilho do `background.js` quando o usuário usa
   "Buscar no processo" no botão direito.

`background.js` é pequeno: registra o item de menu de contexto "Buscar no processo"
(aparece em qualquer aba/janela, mira a aba do SGPe ativa via `chrome.tabs.query`) e injeta
`vendor/pdf.min.js` sob demanda via `chrome.scripting.executeScript` quando a busca por
palavra-chave é acionada (evita carregar a lib inteira em todo frame o tempo todo).

## 4. Regras que você deve sempre seguir ao criar/alterar funcionalidades aqui

### 4.1 Versionamento e changelog (obrigatório em toda mudança)

Toda alteração de comportamento bump a versão em **três lugares, juntos**:

1. `"version"` no `manifest.json`.
2. A linha `// @version` no cabeçalho UserScript do `content-script.js`.
3. Uma nova linha `// vX.Y.Z: <resumo>` logo abaixo das anteriores nesse mesmo cabeçalho
   (não reescreva as linhas antigas — é um log cumulativo).

E no `README.md`:
- Troque o número de versão no `# SGPe - Buscador de paginas X.Y.Z` do título.
- Renomeie a seção anterior `## Mudancas desta versao (X.Y.Z)` para
  `## Mudancas da versao X.Y.Z` (vira histórico) e crie uma nova
  `## Mudancas desta versao (X.Y.Z-nova)` no topo, com bullets explicando o quê e por quê
  (cite números/medições reais quando fizer sentido — é um padrão já estabelecido no
  arquivo).

Use versionamento semântico por senso comum do próprio projeto: funcionalidade nova =
minor (1.X.0); correção/ajuste de regra = patch (1.25.X). Nunca pule ou reaproveite um
número já usado.

### 4.2 Permissões novas: nem sempre dá pra saber de antemão se exige justificativa

A Chrome Web Store abre um campo de "justificativa de permissão" (limite de 1000 caracteres)
no painel do desenvolvedor para permissões que ela trata como sensíveis - `host_permissions`
e `scripting` são exemplos confirmados neste projeto. `contextMenus` já foi observada dos
dois jeitos nesta mesma conta (um envio não pediu campo pra ela, um envio posterior pediu) -
ou seja, **não existe uma lista fixa e confiável de quais permissões pedem campo**, e o
próprio painel pode mudar isso entre envios. Não assuma nenhum dos dois lados: nem "essa
com certeza vai ter campo" nem "essa com certeza não vai ter". Prepare o arquivo de
justificativa pra QUALQUER permissão nova (é barato ter pronto e não custa nada se sobrar
sem uso) e, se o usuário disser que o painel não pediu aquele campo, tudo bem deixar o
arquivo só como referência interna - mas nunca apague por assumir que "essa nunca vai
precisar".

Quando a permissão nova FOR uma das que exige justificativa, crie
`store-assets/justificativa-permissao-<nome>.txt` (português, até 1000 caracteres - **confira
a contagem real de caracteres do arquivo**, não só de vista) explicando pra que serve, por
que é necessária, e reforçando que nenhum dado sai do navegador do usuário / vai pra
terceiros (compromisso central do projeto - não quebre isso). Veja os arquivos existentes
como modelo. Independente de ter campo dedicado ou não, garanta que `descricao-longa.txt` e
`unico-proposito.txt` (esse também com limite de 1000 caracteres) expliquem a nova
funcionalidade e o motivo de qualquer acesso mais amplo - é onde o revisor vai ver essa
informação quando não há campo próprio.

### 4.3 Cuidado extra com código que mexe na página do SGPe (não só na UI da extensão)

Isso já causou um bug real neste projeto (ver `## Mudancas da versao 1.25.3` no README):
`closeAllOpenTreeNodes()` disparava cliques sintéticos em massa nos togglers **do próprio
SGPe**, dessincronizando o estado interno do widget de árvore dele e travando a página até
o usuário recarregar.

Regras práticas:
- Qualquer função que chame `dispatchClick()` (ou crie `MouseEvent`/simule interação) em
  elementos que **pertencem ao SGPe** (`.tg`, `li.i`, `.i-nm`, a árvore em si) é uma área de
  risco alto. Prefira manipular o mínimo de nós possível (ver `closePreviousAutoExpandedNodes`
  como padrão correto: só mexe no que a própria extensão abriu, nunca varre a árvore
  inteira).
- Nunca dispare cliques sintéticos em loop síncrono sobre uma coleção potencialmente grande
  (processos reais chegam a milhares de nós — ver nota de performance da versão 1.24.0 no
  README). Se for realmente necessário, considere espaçar/throttle.
- Se uma correção nessa área não puder ser validada com certeza pela leitura do código
  (o comportamento interno do SGPe é uma caixa-preta), **pergunte ao usuário antes de
  aplicar** em vez de arriscar quebrar a página real dele. Peça passos de reprodução
  concretos quando o relato vier vago ou incompleto.

### 4.4 Estilo de código

- **ES5 puro**: `var`, funções nomeadas/expressões de função, sem `const`/`let`, sem arrow
  functions, sem classes, sem template literals novos (o código usa concatenação com `+`
  na maior parte — siga o padrão local do trecho que você está editando).
- **Sem build step, sem dependências novas**: não introduza bundlers, npm packages ou
  frameworks de UI. DOM puro via `makeEl()` (helper já existente).
- **Comentários em português**, explicando o *porquê* (decisões não óbvias, workarounds
  pra comportamento do SGPe, trade-offs de performance) — não o *o quê* (o código já diz
  o que faz). Muitos comentários citam números reais medidos em processos de teste; mantenha
  esse padrão quando adicionar lógica com trade-off de custo/tempo.
- **Extraia lógica repetida em função nomeada** ao invés de duplicar (ex.: `attemptOpenPage`
  foi extraída do handler de submit pra ser reaproveitada pelo menu de contexto).
- Identificadores e strings de UI em português (é o idioma de todo o projeto e do público
  usuário).

### 4.5 Multi-frame e detecção de estrutura

Toda funcionalidade nova que interaja com a árvore de peças deve assumir que pode estar
rodando em um frame **sem** a árvore (frame do topo, frameset, barra de abas, ou uma tela
alternativa como Inserir Peça/Encaminhamento). Nunca assuma que `getPiecesRoots()` ou
`findPiecesRoot()` vão retornar algo — sempre trate o caso vazio/nulo. Se a funcionalidade
só faz sentido no frame com a árvore, gate-eie com `detectSgpeStructure().ok` (ver
`handleSearchInProcessRequest` como exemplo).

### 4.6 Escopo e privacidade — não regrida isso

O compromisso de privacidade do projeto (documentado em `store-assets/` e
`privacy-policy.html`) é: **acesso só a `sgpe.sea.sc.gov.br`, nada é enviado a
terceiros, processamento 100% local**. Qualquer funcionalidade nova precisa respeitar
isso. Em particular:
- Não adicione telemetria, analytics ou qualquer `fetch`/`XMLHttpRequest` pra fora do
  domínio do SGPe.
- Se a funcionalidade envolver dados de outras abas/páginas (como o menu de contexto, que
  lê `info.selectionText` de qualquer aba), leia só o mínimo necessário e nunca envie esse
  dado pra lugar nenhum além da própria extensão local.

### 4.7 Antes de finalizar

- Rode `node --check content-script.js` e `node --check background.js` (sintaxe válida) e
  valide o `manifest.json` como JSON antes de considerar a mudança pronta.
- Não há testes automatizados nem ambiente de dev/preview rodável fora do SGPe real — a
  validação funcional depende de carregar a extensão descompactada no Chrome
  (`chrome://extensions`) e testar contra o site real. Deixe claro para o usuário quando uma
  mudança não pôde ser testada ao vivo por você.
- Não crie arquivos de release (`.zip`) a menos que pedido explicitamente.

### 4.8 Controle de versão (git)

- Esta pasta é um repositório git público: https://github.com/izzie8dad/buscador-sgpe
  (branch `main`). O identidade de commit configurada localmente neste repo é
  `izzie8dad <izzie8dad@users.noreply.github.com>` — não altere para o nome/e-mail real do
  usuário sem pedido explícito (decisão consciente para não expor dados pessoais no
  histórico público).
- `.claude/` e `*.zip` estão no `.gitignore` — nunca force a inclusão desses.
- Depois de qualquer mudança de código já validada (ver 4.7) e com o bump de versão feito
  (4.1), **ofereça** ao usuário criar um commit (nunca commit automaticamente sem pedir —
  regra geral do ambiente) com uma mensagem curta explicando o "porquê" da mudança.
- Ao publicar uma nova versão (manifest.json version mudou), ofereça também criar uma tag
  anotada `vX.Y.Z` (`git tag -a vX.Y.Z -m "..."`) e enviá-la (`git push origin vX.Y.Z`)
  junto com o commit, mantendo o histórico de tags alinhado ao changelog do README.md.

## 5. Onde NÃO mexer sem necessidade clara

- `vendor/pdf.min.js`, `vendor/pdf.worker.min.js`, `vendor/LICENSE-pdf.js.txt` — biblioteca
  de terceiros embutida, atualize só a versão exata quando houver motivo real (ex.:
  segurança), nunca edite o conteúdo.
- `icons/` — ativos de imagem, não regenere sem pedido.
- Outras pastas/zips no diretório pai (`sgpe-page-finder-extension-1.20.8`, `*.zip`) — não
  fazem parte da pasta ativa (ver seção 2).
