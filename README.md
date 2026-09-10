# SGPe - Buscador de paginas 1.25.5

Extensao Chrome Manifest V3 que adiciona um buscador de paginas e documentos a Pasta Digital
(Aba Pecas) do SGPe - o sistema de Processo Eletronico do Governo do Estado de Santa Catarina.

## O que e e para quem e util

O SGPe e usado por servidores publicos catarinenses para tramitar processos administrativos.
Processos grandes acumulam centenas ou milhares de paginas espalhadas entre varias pecas
(documentos) e apensados/juntados (outros processos anexados), e a interface nativa nao tem
uma forma rapida de pular direto para uma pagina especifica.

Esta extensao - nao-oficial, independente e sem qualquer vinculo com o Governo de SC -
adiciona:

- **Busca por numero de pagina**, abrindo direto a peca certa mesmo em processos com
  apensados ou com numeracao de pagina irregular (lacunas, reinicios por peca);
- **Busca por nome de peca**;
- **Busca por palavra-chave** no texto de todas as pecas de um processo, via `pdf.js`
  embutido, 100% local;
- **Item no menu de contexto do Chrome** para buscar uma pagina a partir de qualquer texto
  selecionado em qualquer aba (ex.: uma referencia de pagina lida num PDF aberto em outra
  janela).

E util para qualquer servidor(a) com acesso ao SGPe que lide com processos longos com
frequencia. O codigo e aberto justamente para que outros servidores e desenvolvedores possam
reportar problemas e contribuir com melhorias - veja "Contribuindo" no fim deste arquivo.

## Privacidade

Processamento 100% local. A unica comunicacao de rede feita pela extensao e um fetch
same-origin para `sgpe.sea.sc.gov.br` durante a busca por palavra-chave (para ler o conteudo
das pecas do proprio processo aberto) - nenhum dado e enviado a terceiros. Detalhes completos
em [`privacy-policy.html`](privacy-policy.html).

## Mudancas desta versao (1.25.5)

- **`getProcessLi()` pegava o ancestral de processo mais distante na árvore, em vez do mais
  próximo.** Um apensado/processo juntado pode ter *outros* apensados juntados aninhados
  dentro dele (Juntada de processos dentro de Juntada de processos - visto ao vivo num
  processo real: um apensado com **5 outros apensados aninhados** dentro dele, de anos
  diferentes). Como a função subia por todos os ancestrais e ficava com o último encontrado
  (o mais externo), todos esses apensados aninhados eram tratados como se fossem um único
  processo - suas peças caíam num só grupo de numeração local (contagem de página somada de
  todos juntos) e todos exibiam o número do apensado mais externo, mascarando a identidade de
  cada um.

  Corrigido pra retornar o ancestral mais próximo (primeiro encontrado subindo a árvore).
  Confirmado ao vivo, inspecionando a árvore real de um processo com essa estrutura: peças que
  antes cairiam todas sob "SDR23 00008059/2014" agora resolvem cada uma pro seu próprio
  processo (`SDR23 00009095/2014`, `SOL 00000104/2015`, `SOL 00004386/2014`,
  `SDR23 00009375/2014`, `SDR23 00000147/2015`) - cada apensado aninhado passa a ter sua
  própria numeração local (sem herdar o deslocamento dos demais) e aparece como entrada
  própria na lista suspensa "Nº do Processo".

## Mudancas da versao 1.25.4

Dois problemas encontrados/corrigidos:

- **Número com ponto de milhar no menu de contexto (ex.: "1.947") só pegava a parte antes do
  ponto ("1").** `extractPageNumberFromSelection()` usava `/\d+/`, que para na primeira
  sequência de dígitos. Agora tenta primeiro um padrão de milhar (grupos de exatamente 3
  dígitos separados por ponto, ex.: "1.947", "12.345.678") e só cai para dígitos simples
  quando essa forma não bate - o ponto é removido antes de converter para número.

- **`findPageMatches()` voltava a abrir a peça errada (deslocada) em processos com lacuna na
  numeração real de página** (ex.: faltam as páginas 2, 3 e 4 no meio do processo -
  confirmado ao vivo com o usuário, comparando os `data-p` reais do SGPe com o comportamento
  da extensão). A correção da 1.25.3 (duplicidade - ver abaixo) tinha trocado a prioridade
  geral para a numeração local/sequencial, que diverge da real exatamente a partir de uma
  lacuna dessas - qualquer página real digitada depois da lacuna acabava abrindo uma peça
  totalmente diferente, só porque o número batia por coincidência com a posição local de
  outra peça (reportado como "abre 3 páginas para frente" a partir da página 37 num processo
  de teste, onde a lacuna desloca a numeração local em exatamente 3). Corrigido com uma regra
  mais precisa: a numeração **real** volta a ser a prioridade sempre que só uma peça a cobre
  (o caso comum - inclusive confirmado que resolve o exemplo relatado, página 171). A
  numeração **local** só entra pra desempatar quando **mais de uma** peça coincide no mesmo
  número real (o caso que a 1.25.3 resolvia, causado pelo SGPe reiniciar a numeração real por
  peça em alguns casos) - se a numeração local não desempatar sozinha, sobra a lista de
  peças empatadas mesmo (o seletor de escolha já existente cobre esse caso). Validado por
  simulação com os dados reais (`data-p`) de um processo de teste com essa lacuna: página 36,
  37 e 171 abrem corretamente, e o caso de duplicidade original continua com 1 resultado só.

## Mudancas da versao 1.25.3

Dois bugs reportados ao testar a 1.25.2:

- **Resultado fantasma ao buscar por numero de pagina num processo filtrado (ex.: pelo menu de
  contexto num apensado).** `findPageMatches()` cruzava a numeracao real da peca (`data-p` do
  proprio SGPe) E a numeracao local/sequencial (a mesma dos rotulos "Pagina 0001..." que a
  extensao mostra) ao mesmo tempo, com "ou". O SGPe pode reiniciar a numeracao real por peca -
  uma peca de 1 pagina pode ter `data-p` "1-1" mesmo sem ser a primeira do processo -, entao
  bastava outra peca do MESMO processo coincidir nesse numero real pra aparecer como uma segunda
  opcao onde so devia haver uma (ex.: "Autuação (1-1)" e "Documento (1-1, local 93-93)" pra uma
  busca por pagina 1, sendo que so a primeira e de fato a pagina 1 na numeracao que o usuario ve).
  Corrigido priorizando a numeracao local (garantidamente sem sobreposicao dentro de um mesmo
  processo/apensado) - so cai pra numeracao real se nenhuma peca cobrir a pagina localmente.

- **"Limpar" deixava a arvore nativa do SGPe travada** (o +/- do toggler clicava e virava
  visualmente, mas o conteudo aninhado parava de abrir em cliques reais seguintes, exigindo
  recarregar a pagina). Causa: `closeAllOpenTreeNodes()` percorria **todos** os nos `li.i` da
  arvore inteira (podem ser milhares num processo grande - ver nota de performance na 1.24.0
  abaixo) e, pra cada um que estivesse aberto, disparava um clique sintetico real no toggler do
  SGPe (`dispatchClick()`) pra manter o estado interno do widget do SGPe sincronizado - tudo num
  loop sincrono, sem pausa entre os cliques. Isso dessincronizava o proprio estado interno da
  arvore do SGPe. Trocado por `closePreviousAutoExpandedNodes()` (ja existente, usada em outro
  lugar do codigo com o mesmo proposito): fecha so os poucos nos que a **extensao mesma** abriu
  automaticamente numa busca, nunca os que o usuario abriu na mao navegando a arvore - evita o
  loop de cliques sinteticos em massa e, de quebra, passa a respeitar a navegacao manual do
  usuario ao limpar a busca.

## Mudancas da versao 1.25.2

Ajustes de regra pedidos apos testar a 1.25.1:

- **Processo mae vira o padrao do campo "No do Processo"** (antes o padrao era "Todos os
  processos"). Antes de qualquer clique na arvore, ou depois de "Limpar", o campo comeca
  restringindo a busca (numero de pagina e nome de peca) so ao processo principal - "Todos os
  processos" continua disponivel na lista, agora como uma escolha manual explicita e persistente
  (nao volta sozinha ao clicar em algo na arvore).

- **Busca pelo menu de contexto passa a acompanhar a situacao ativa do widget.** Antes ela
  sempre forcava o processo mae, ignorando o que estivesse selecionado no campo. Agora usa
  exatamente o que estiver ativo no momento do clique com o botao direito (mae, um apensado
  especifico, ou "Todos os processos") - com uma excecao: se a situacao ativa for "Todos os
  processos" (escolha manual explicita), a busca converte pra so o processo mae, ja que esse
  gatilho costuma comecar de um numero lido fora da arvore (ex.: um PDF aberto em outra aba),
  sem relacao com a escolha anterior de buscar em tudo.

- **Novo texto de status: "Total de X páginas em Y processo(s)."**, abaixo do campo de numero
  de pagina - substitui o "Indexadas X pecas, paginas 1-Y" anterior. Soma as paginas e conta os
  processos (principal + cada apensado) na arvore inteira, independente do processo ativo no
  momento no widget.

- **Lista suspensa do campo "No do Processo" agora mostra a contagem de paginas de cada
  processo**, numa segunda linha em fonte reduzida, abaixo do numero. Como um `<option>` nativo
  de HTML nao suporta duas linhas/tamanhos de fonte diferentes, o campo deixou de ser um
  `<select>` nativo e virou um controle proprio (mesmo visual e comportamento de clique).

## Mudancas da versao 1.25.1

Correcoes reportadas ao testar a 1.25.0 ao vivo:

- **O filtro de processo (select "No do Processo") nao travava a busca de fato.** A identidade
  de cada opcao era guardada por referencia de elemento DOM (`root`/`processLi`). A arvore de
  pecas do SGPe recria esses nos periodicamente (a mesma `MutationObserver` que a extensao ja
  observa `childList`/`attributes` prova isso), entao a referencia guardada ficava obsoleta
  poucos segundos depois de escolhida e o filtro se auto-desligava silenciosamente na proxima
  atualizacao do painel (`refreshProcessSelect()`, chamada a cada ~2s). Corrigido trocando a
  identidade para o numero do processo (texto), estavel entre essas recriacoes.

- **O item "Buscar no processo" do menu de contexto so aparecia clicando na propria janela da
  aba do processo.** Na pratica o numero costuma ser lido num PDF aberto numa aba/janela
  separada, com a Pasta Digital do processo aberta em outra - a restricao `documentUrlPatterns`
  ao dominio do SGPe deixava a funcionalidade inutil nesse uso real. O item passa a aparecer em
  qualquer aba/janela do navegador; ao clicar, o `background.js` localiza a aba do SGPe que
  estiver ativa (`chrome.tabs.query({active: true, url: 'https://sgpe.sea.sc.gov.br/*'})` - so a
  aba ativa de cada janela, nunca uma aba do SGPe em segundo plano) e a traz para frente, em vez
  de mirar a aba (nao-SGPe) onde o clique aconteceu.

- **Nova excecao: busca pelo menu de contexto mira sempre o processo mae.** Como a selecao agora
  quase sempre vem de fora da arvore (sem relacao com qual apensado estava selecionado antes),
  esse gatilho forca o filtro de processo para a referencia (mae) - nunca "todos os processos"
  nem um apensado especifico -, refletindo a escolha no proprio select.

- **Lista suspensa marca o processo mae com "(mãe)"**, no mesmo padrao que ja marcava os
  apensados com "(apensado)".

## Mudancas da versao 1.25.0

- **Restringir buscas a um processo especifico.** O campo "No do Processo" (antes so leitura,
  informativo) virou uma lista suspensa com o processo principal e cada apensado/juntado
  encontrado na arvore. Escolher uma opcao restringe a busca por numero de pagina, por nome de
  peca e por palavra-chave a esse processo; a opcao padrao "Todos os processos" mantem o
  comportamento de sempre (busca na arvore inteira). E uma funcionalidade a mais, nunca
  ativada automaticamente por clique na arvore - so muda quando o usuario mexe no select. O
  campo fica sempre com fundo cinza claro, pra se diferenciar dos campos de texto livre.

- **Novo item "Buscar no processo" no menu de contexto (botao direito).** Selecionando um
  numero em qualquer texto de uma pagina do SGPe (ex.: uma referencia a "pagina 44" num
  checklist) e clicando com o botao direito, aparece essa opcao no menu do Chrome; ao clicar,
  a extensao abre direto essa pagina na arvore de pecas, com o mesmo comportamento da busca por
  numero de pagina da caixa flutuante (inclusive respeitando o filtro de processo acima, se
  estiver ativo). A acao e sempre restrita a UNICA aba ativa em que o clique aconteceu - mesmo
  com outras janelas/abas com outros processos do SGPe abertas, porem inativas -, porque o
  Chrome ja entrega o `tab` exato do clique via `chrome.contextMenus.onClicked`, sem varredura
  de outras abas. Requer a nova permissao `contextMenus` (justificativa em
  `store-assets/justificativa-permissao-contextmenus.txt`).

## Mudancas da versao 1.24.0

- **UI travava ~15s ao abrir o painel em processos grandes (corrigido).** Este era o problema
  mais grave, e nao tinha a ver com a quantidade de pecas: `getPiecesFromRoot()` roda o `map`
  sobre TODOS os `li.i` da arvore (inclusive os nos de pagina, descartados so no filtro do
  final) e chamava `getProcessLabel()` em cada um. Em 945 desses nos isso caia no
  `getRootLabel()`, que a cada chamada faz tres `querySelector` de atributo (sem indice) no
  documento inteiro **e serializa os ~146KB do `body.textContent`** pra rodar uma regex -
  ~14ms por chamada, sempre devolvendo o mesmo resultado. Medido no SOL 00002054/2016 (9316
  nos na arvore): **15.537ms pra expandir o painel**. Como o rotulo e o mesmo pra todas as
  pecas da mesma leitura, agora ele e calculado no maximo uma vez por leitura (e so se alguma
  peca precisar dele): **caiu para ~600ms**. O mesmo caminho tambem rodava no `updateStatus()`
  periodico, entao a pagina inteira ficava pesada nesses processos, nao so ao expandir.

- **Busca por palavra-chave agora separa processo principal de processos apensados/juntados.**
  Medindo ao vivo o SOL 00002054/2016: das 367 pecas / ~8900 paginas que a busca percorria, so
  81 pecas / 1137 paginas eram do processo principal - **os apensados respondiam por ~87% do
  custo** (SOL 00003110/2013 e SDR18 00005003/2013, +286 pecas). Buscar tudo levava ~4 minutos;
  so no principal, ~50 segundos (medido, 420 ocorrencias em 12 pecas).
  - **O padrao acompanha o custo dos apensados**, em vez de ser fixo: eles entram na busca
    quando somam ate ~30s a mais (nao vale perder resultados por poucos segundos) e ficam de
    fora quando pesam a ponto de inviabilizar a busca. Validado nos dois casos reais: no
    SCC 00000842/2024 os apensados custam +4-5s e entram sozinhos; no SOL 00002054/2016 custam
    +205-236s e ficam de fora.
  - O checkbox "Incluir processos apensados/juntados" permite inverter a decisao a qualquer
    momento, e **depois de um toque manual a escolha do usuario passa a mandar** (nao volta
    a ser sobrescrita pelo automatico). O checkbox so aparece quando a pasta tem apensados.
  - A estimativa mostrada ao expandir a secao separa os dois custos, ex.: "Processo principal:
    81 pecas (1137 paginas), ~30s-34s. Apensados (SDR18 00005003/2013, SOL 00003110/2013):
    +286 pecas (+7803 paginas), +~205s-236s."
  - A separacao reaproveita `getProcessLi()`, que ja existia: peca sem nenhum `li.i` de processo
    acima dela na arvore = processo principal; pecas de apensados ficam sempre aninhadas dentro
    do item de juntada.
  - **So a busca por palavra-chave mudou.** A busca por numero de pagina e por nome da peca
    continua enxergando o processo inteiro, apensados incluidos.

- **Estimativa de tempo mais honesta.** Antes ela multiplicava a quantidade de pecas por um
  chute fixo de 12 paginas/peca; no processo acima isso dava 4644 paginas contra 7507 reais
  (~40% de erro). Agora usa a contagem real de paginas dos intervalos do `data-p`, caindo no
  chute antigo so quando a arvore nao expoe os intervalos.

- **Nao ha aviso repetido depois da busca** sobre pecas de apensados nao pesquisadas - a
  informacao aparece so antes de buscar, junto do checkbox.

Todos os numeros acima foram medidos ao vivo, com a extensao carregada, nos processos reais
SOL 00002054/2016 (pesado, com apensados grandes) e SCC 00000842/2024 (leve).

## Mudancas da versao 1.23.0

- **Estrutura da arvore de pecas (`#visoes-0-itens`, `ul.g-i > li.i`, atributo `data-p` com
  `nuPaginaInicial`/`nuPaginaFinal`) verificada ao vivo num processo real (SCC 00000842/2024,
  Aba Pecas) e confirmada sem mudancas** - os seletores em `SGPE_SELECTORS` continuam batendo
  normalmente (146 pecas com intervalo de pagina detectadas). O que de fato mudou/quebrava era
  o aviso de indisponibilidade (proximo item), nao a deteccao da arvore em si.

- **Corrigido de vez o aviso falso de "Buscador indisponivel" em "Inserir Peca" e
  "Encaminhamento".** A tentativa anterior (1.21.0) so reconhecia essas telas pela URL/texto
  do proprio frame que navega pra fora da arvore (`frameNPasta`), mas o SGPe usa frames
  aninhados: o frame do topo e o frameset intermediario nunca tem a arvore, nem em operacao
  normal, e dependiam de um sinal compartilhado de "estrutura saudavel" que expira 10s depois
  que o frame de baixo sai da tela de pecas. Passado esse tempo, o aviso disparava mesmo
  assim - reproduzido ao vivo em ambas as telas, inclusive Encaminhamento (que parecia corrigido
  antes mas nunca foi). Duas causas, duas correcoes:
  - O allowlist de paths que o script roda (`ALLOWED_PATH_PREFIXES`) nao incluia `/ecmcpa`
    (Inserir Peca) nem `/CpavEncaminhamento` (Encaminhamento) - o script nem chegava a rodar
    nessas telas pra se reconhecer como "tela alternativa conhecida". Adicionados os dois
    prefixos.
  - Agora, quando o frame que de fato navegou pra a tela alternativa se reconhece como tal
    (`isKnownAlternateSgpeScreen()`, table `KNOWN_ALTERNATE_SGPE_SCREENS` - facil de estender
    com novas telas), ele marca um sinal compartilhado (`markKnownAlternateScreenActive()`)
    que os frames irmaos/pais tambem respeitam, em vez de cada frame depender so da propria
    URL/texto (que nunca muda pra eles).

- **Aviso falso tambem podia aparecer ao voltar do Encaminhamento pra tela de Peças (`Voltar`),
  ficando preso na tela "Processo Digital".** O frame do topo (`/cpav/visualizarDocumentosProcesso.do`)
  nunca tem a arvore em nenhuma aba, mas sua propria URL continua parecendo "Pasta Digital"
  (`itemAba=aba_pecas` fica fixo) mesmo quando o conteudo interno mudou pra outra coisa - entao
  ele podia disparar o aviso sozinho, sem depender de qual aba interna estava ativa. Os tres
  frames "casca" que nunca tem a arvore em nenhuma aba (frame do topo, frameset e frame da
  barra de abas) foram adicionados a `KNOWN_ALTERNATE_SGPE_SCREENS`, pra nunca disparar o aviso
  por conta propria - so o frame que de fato deveria ter a arvore (`frameNPasta`, na aba Peças)
  continua avaliando e avisando de verdade. Testado ao vivo clicando entre as abas
  Processo/Peças/Tramitações do mesmo processo (a maioria navega pra uma URL totalmente
  diferente e nao aciona o aviso por conta disso; o caso do `Voltar` era o unico que ficava
  preso na URL da aba Peças com conteudo de outra tela).

- **Aviso de "Buscador indisponivel" nao dispara mais na tela "Inserir Peca".** (1.21.0) Essa
  tela do SGPe (`/ecmcpa/abrirNovoCadDocumento.do`) navega o mesmo frame do widget pra fora da
  arvore de pecas de proposito - antes isso era detectado como estrutura quebrada e mostrava o
  aviso por engano. Reconhecida via URL e via o titulo "Inserir Peca" na tela.

- **Nova funcionalidade: busca por palavra-chave no texto das pecas.** Dentro do painel
  expandido (nunca na caixa mini, para nao pesar o uso padrao), uma nova secao colapsavel
  "Busca por palavra-chave (todas as peças)" permite buscar um termo em todas as pecas do
  processo aberto.
- A busca le apenas o **texto nativo** de cada PDF - **nao usa OCR**. Pecas digitalizadas
  (imagem, sem texto nativo) sao sinalizadas separadamente como "digitalizadas, nao
  pesquisadas", nunca confundidas com "termo nao encontrado".
- O `pdf.js` (Mozilla, Apache 2.0) vem **embutido na propria extensao** (`vendor/pdf.min.js` +
  `vendor/pdf.worker.min.js`), em vez de depender do `pdf.js` que o SGPe carrega na pagina.
  Tentamos ler o `pdf.js` da propria pagina numa versao anterior, mas isso nunca funciona de
  verdade: o mecanismo de "isolated world" dos content scripts do Chrome filtra propriedades
  customizadas (como `pdfjsLib`) em qualquer janela lida pelo content script, mesmo de outro
  frame via `window.frames[i]` - confirmado comparando uma leitura via console real (main
  world, achou) com uma leitura via content script real (isolated world, nunca achou), no
  mesmo estado de pagina.
- **`vendor/pdf.min.js` e carregado sob demanda**, so quando o usuario clica em "Buscar" pela
  primeira vez naquele frame - nao mais embutido no `manifest.json` (`content_scripts`), que
  injetava a biblioteca inteira (~320KB) em TODO frame do SGPe, mesmo sem o usuario abrir a
  busca. Medicoes de performance (DevTools trace, abertura de pagina e navegacao entre pecas)
  mostraram que isso quase dobrava o heap JS da pagina (~225MB -> ~400MB) so pela injecao
  estatica, com custo de CPU proprio de apenas ~160ms por vez. Agora um `background.js`
  (service worker) injeta `vendor/pdf.min.js` via `chrome.scripting.executeScript` no mesmo
  frame e isolated world do content script que pediu, na primeira busca; buscas seguintes no
  mesmo frame reusam o `pdfjsLib` ja carregado.
- Antes de rodar, mostra uma estimativa de tempo baseada na quantidade de pecas do processo
  e em taxas medidas em processos reais (~33-38 paginas/segundo). O tempo real e ajustado
  ao vivo conforme a busca avanca.
- Busca e feita peca por peca, sequencialmente (sem paralelismo), com botao de cancelar que
  interrompe de fato as requisicoes em andamento.
- Pecas que nao sao PDF (ex.: planilhas na arvore) sao ignoradas com aviso proprio, sem
  travar o restante da busca.
- **Resultados por peca, com grifado no visualizador nativo do SGPe.** Cada linha de resultado
  mostra "NOME DA PECA (N ocorrencias)" - sem listar pagina a pagina, pra rolagem mais leve em
  processos grandes. Clicar na peca abre ela na pagina da primeira ocorrencia e aciona a barra
  de busca nativa do proprio visualizador PDF do SGPe (`#findInput`, com "Destacar tudo"
  ativado), que grifa todas as ocorrencias na tela - o usuario navega entre elas com os botoes
  Anterior/Proximo do proprio SGPe. Isso e manipulacao de DOM (input, eventos, classes), entao
  nao esbarra na mesma barreira de isolated world que afetava a leitura do `pdfjsLib`. O campo
  de busca e sempre limpo antes de receber o termo (mesmo se o valor "parecer" igual ao de uma
  busca anterior), pra garantir que o pdf.js trate como busca nova e realce de novo - sem essa
  limpeza, clicar em pecas diferentes em sequencia podia deixar de grifar a partir da segunda.
- A contagem total de ocorrencias fica fixa (`position: sticky`) no topo da area de rolagem
  dos resultados.
- O painel expandido se ajusta sozinho ao conteudo (mais resultados = painel mais alto, ate um
  teto baseado na altura da tela; a partir dai a area de resultados rola internamente) - sem
  precisar arrastar nada. O teto agora leva em conta a posicao real do topo do painel (nao um
  valor fixo), sempre deixando uma margem de respiro no rodape do navegador. As janelas de
  rolagem (resultados e listas de pecas digitalizadas/ignoradas/com erro) tem altura menor
  de proposito, pra nunca exigir arrastar o widget ou dar zoom out pra ver o rodape.

## Instalacao local

1. Baixe/clone este repositorio.
2. Abra `chrome://extensions`.
3. **Remova ou desative qualquer outra copia desta extensao antes de carregar esta** - todas
   usam a mesma variavel de guarda (`window.__codexSgpePageFinderInstalled`); com duas ativas,
   so a que carregar primeiro instala, mascarando silenciosamente as demais.
4. Ative `Modo do desenvolvedor`.
5. Clique em `Carregar sem compactacao`.
6. Selecione a pasta deste repositorio.
7. Recarregue a aba do SGPe.

## Contribuindo

Sugestoes, relatos de bugs e pull requests sao bem-vindos. O projeto e ES5 puro, sem etapa de
build (um unico content script injetado direto no SGPe) - veja
[`INSTRUCOES.md`](INSTRUCOES.md) para a arquitetura do `content-script.js` e as convencoes de
versionamento/changelog seguidas a cada mudanca.

## Como testar a busca por palavra-chave

1. Abra um processo real na Pasta Digital (Aba Pecas) do SGPe.
2. Expanda o painel do widget (botao `+` na caixa mini).
3. Clique em "Busca por palavra-chave (todas as peças)" para expandir a secao - a estimativa
   de tempo aparece na hora. Se o processo tiver apensados/juntados, a estimativa separa o
   custo do processo principal do custo dos apensados, e aparece o checkbox "Incluir processos
   apensados/juntados" (desmarcado por padrao).
4. Digite um termo (minimo 2 caracteres) e clique em "Buscar".
5. Acompanhe o progresso; clique em qualquer peca do resultado para abrir na primeira
   ocorrencia e grifar todas as ocorrencias via a busca nativa do visualizador do SGPe.
6. Para validar a separacao principal/apensados, use um processo com juntadas (ex.:
   SOL 00002054/2016) e confira que o contador de progresso percorre so as pecas do principal
   com o checkbox desmarcado, e o total com ele marcado.
