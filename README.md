# SGPe - Buscador de páginas 1.25.5

Extensão Chrome Manifest V3 que adiciona um buscador de páginas e documentos à Pasta Digital
(Aba Peças) do SGPe - o sistema de Processo Eletrônico do Governo do Estado de Santa Catarina.

## O que é e para quem é útil

O SGPe é usado por servidores públicos catarinenses para tramitar processos administrativos.
Processos grandes acumulam centenas ou milhares de páginas espalhadas entre várias peças
(documentos) e apensados/juntados (outros processos anexados), e a interface nativa não tem
uma forma rápida de pular direto para uma página específica.

Esta extensão - não oficial, independente e sem qualquer vínculo com o Governo de SC -
adiciona:

- **Busca por número de página**, abrindo direto a peça certa mesmo em processos com
  apensados ou com numeração de página irregular (lacunas, reinícios por peça);
- **Busca por nome de peça**;
- **Busca por palavra-chave** no texto de todas as peças de um processo, via `pdf.js`
  embutido, 100% local;
- **Item no menu de contexto do Chrome** para buscar uma página a partir de qualquer texto
  selecionado em qualquer aba (ex.: uma referência de página lida num PDF aberto em outra
  janela).

É útil para qualquer servidor(a) com acesso ao SGPe que lide com processos longos com
frequência. O código é aberto justamente para que outros servidores e desenvolvedores possam
reportar problemas e contribuir com melhorias - veja "Contribuindo" no fim deste arquivo.

## Privacidade

Processamento 100% local. A única comunicação de rede feita pela extensão é um fetch
same-origin para `sgpe.sea.sc.gov.br` durante a busca por palavra-chave (para ler o conteúdo
das peças do próprio processo aberto) - nenhum dado é enviado a terceiros. Detalhes completos
em [`privacy-policy.html`](privacy-policy.html).

## Mudanças desta versão (1.25.5)

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

## Mudanças da versão 1.25.4

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

## Mudanças da versão 1.25.3

Dois bugs reportados ao testar a 1.25.2:

- **Resultado fantasma ao buscar por número de página num processo filtrado (ex.: pelo menu de
  contexto num apensado).** `findPageMatches()` cruzava a numeração real da peça (`data-p` do
  próprio SGPe) E a numeração local/sequencial (a mesma dos rótulos "Página 0001..." que a
  extensão mostra) ao mesmo tempo, com "ou". O SGPe pode reiniciar a numeração real por peça -
  uma peça de 1 página pode ter `data-p` "1-1" mesmo sem ser a primeira do processo -, então
  bastava outra peça do MESMO processo coincidir nesse número real pra aparecer como uma segunda
  opção onde só devia haver uma (ex.: "Autuação (1-1)" e "Documento (1-1, local 93-93)" pra uma
  busca por página 1, sendo que só a primeira é de fato a página 1 na numeração que o usuário vê).
  Corrigido priorizando a numeração local (garantidamente sem sobreposição dentro de um mesmo
  processo/apensado) - só cai pra numeração real se nenhuma peça cobrir a página localmente.

- **"Limpar" deixava a árvore nativa do SGPe travada** (o +/- do toggler clicava e virava
  visualmente, mas o conteúdo aninhado parava de abrir em cliques reais seguintes, exigindo
  recarregar a página). Causa: `closeAllOpenTreeNodes()` percorria **todos** os nós `li.i` da
  árvore inteira (podem ser milhares num processo grande - ver nota de performance na 1.24.0
  abaixo) e, pra cada um que estivesse aberto, disparava um clique sintético real no toggler do
  SGPe (`dispatchClick()`) pra manter o estado interno do widget do SGPe sincronizado - tudo num
  loop síncrono, sem pausa entre os cliques. Isso dessincronizava o próprio estado interno da
  árvore do SGPe. Trocado por `closePreviousAutoExpandedNodes()` (já existente, usada em outro
  lugar do código com o mesmo propósito): fecha só os poucos nós que a **extensão mesma** abriu
  automaticamente numa busca, nunca os que o usuário abriu na mão navegando a árvore - evita o
  loop de cliques sintéticos em massa e, de quebra, passa a respeitar a navegação manual do
  usuário ao limpar a busca.

## Mudanças da versão 1.25.2

Ajustes de regra pedidos após testar a 1.25.1:

- **Processo mãe vira o padrão do campo "Nº do Processo"** (antes o padrão era "Todos os
  processos"). Antes de qualquer clique na árvore, ou depois de "Limpar", o campo começa
  restringindo a busca (número de página e nome de peça) só ao processo principal - "Todos os
  processos" continua disponível na lista, agora como uma escolha manual explícita e persistente
  (não volta sozinha ao clicar em algo na árvore).

- **Busca pelo menu de contexto passa a acompanhar a situação ativa do widget.** Antes ela
  sempre forçava o processo mãe, ignorando o que estivesse selecionado no campo. Agora usa
  exatamente o que estiver ativo no momento do clique com o botão direito (mãe, um apensado
  específico, ou "Todos os processos") - com uma exceção: se a situação ativa for "Todos os
  processos" (escolha manual explícita), a busca converte pra só o processo mãe, já que esse
  gatilho costuma começar de um número lido fora da árvore (ex.: um PDF aberto em outra aba),
  sem relação com a escolha anterior de buscar em tudo.

- **Novo texto de status: "Total de X páginas em Y processo(s)."**, abaixo do campo de número
  de página - substitui o "Indexadas X peças, páginas 1-Y" anterior. Soma as páginas e conta os
  processos (principal + cada apensado) na árvore inteira, independente do processo ativo no
  momento no widget.

- **Lista suspensa do campo "Nº do Processo" agora mostra a contagem de páginas de cada
  processo**, numa segunda linha em fonte reduzida, abaixo do número. Como um `<option>` nativo
  de HTML não suporta duas linhas/tamanhos de fonte diferentes, o campo deixou de ser um
  `<select>` nativo e virou um controle próprio (mesmo visual e comportamento de clique).

## Mudanças da versão 1.25.1

Correções reportadas ao testar a 1.25.0 ao vivo:

- **O filtro de processo (select "Nº do Processo") não travava a busca de fato.** A identidade
  de cada opção era guardada por referência de elemento DOM (`root`/`processLi`). A árvore de
  peças do SGPe recria esses nós periodicamente (a mesma `MutationObserver` que a extensão já
  observa `childList`/`attributes` prova isso), então a referência guardada ficava obsoleta
  poucos segundos depois de escolhida e o filtro se auto-desligava silenciosamente na próxima
  atualização do painel (`refreshProcessSelect()`, chamada a cada ~2s). Corrigido trocando a
  identidade para o número do processo (texto), estável entre essas recriações.

- **O item "Buscar no processo" do menu de contexto só aparecia clicando na própria janela da
  aba do processo.** Na prática o número costuma ser lido num PDF aberto numa aba/janela
  separada, com a Pasta Digital do processo aberta em outra - a restrição `documentUrlPatterns`
  ao domínio do SGPe deixava a funcionalidade inútil nesse uso real. O item passa a aparecer em
  qualquer aba/janela do navegador; ao clicar, o `background.js` localiza a aba do SGPe que
  estiver ativa (`chrome.tabs.query({active: true, url: 'https://sgpe.sea.sc.gov.br/*'})` - só a
  aba ativa de cada janela, nunca uma aba do SGPe em segundo plano) e a traz para frente, em vez
  de mirar a aba (não SGPe) onde o clique aconteceu.

- **Nova exceção: busca pelo menu de contexto mira sempre o processo mãe.** Como a seleção agora
  quase sempre vem de fora da árvore (sem relação com qual apensado estava selecionado antes),
  esse gatilho força o filtro de processo para a referência (mãe) - nunca "todos os processos"
  nem um apensado específico -, refletindo a escolha no próprio select.

- **Lista suspensa marca o processo mãe com "(mãe)"**, no mesmo padrão que já marcava os
  apensados com "(apensado)".

## Mudanças da versão 1.25.0

- **Restringir buscas a um processo específico.** O campo "Nº do Processo" (antes só leitura,
  informativo) virou uma lista suspensa com o processo principal e cada apensado/juntado
  encontrado na árvore. Escolher uma opção restringe a busca por número de página, por nome de
  peça e por palavra-chave a esse processo; a opção padrão "Todos os processos" mantém o
  comportamento de sempre (busca na árvore inteira). É uma funcionalidade a mais, nunca
  ativada automaticamente por clique na árvore - só muda quando o usuário mexe no select. O
  campo fica sempre com fundo cinza claro, pra se diferenciar dos campos de texto livre.

- **Novo item "Buscar no processo" no menu de contexto (botão direito).** Selecionando um
  número em qualquer texto de uma página do SGPe (ex.: uma referência a "página 44" num
  checklist) e clicando com o botão direito, aparece essa opção no menu do Chrome; ao clicar,
  a extensão abre direto essa página na árvore de peças, com o mesmo comportamento da busca por
  número de página da caixa flutuante (inclusive respeitando o filtro de processo acima, se
  estiver ativo). A ação é sempre restrita à ÚNICA aba ativa em que o clique aconteceu - mesmo
  com outras janelas/abas com outros processos do SGPe abertas, porém inativas -, porque o
  Chrome já entrega o `tab` exato do clique via `chrome.contextMenus.onClicked`, sem varredura
  de outras abas. Requer a nova permissão `contextMenus` (justificativa em
  `store-assets/justificativa-permissao-contextmenus.txt`).

## Mudanças da versão 1.24.0

- **UI travava ~15s ao abrir o painel em processos grandes (corrigido).** Este era o problema
  mais grave, e não tinha a ver com a quantidade de peças: `getPiecesFromRoot()` roda o `map`
  sobre TODOS os `li.i` da árvore (inclusive os nós de página, descartados só no filtro do
  final) e chamava `getProcessLabel()` em cada um. Em 945 desses nós isso caía no
  `getRootLabel()`, que a cada chamada faz três `querySelector` de atributo (sem índice) no
  documento inteiro **e serializa os ~146KB do `body.textContent`** pra rodar uma regex -
  ~14ms por chamada, sempre devolvendo o mesmo resultado. Medido no SOL 00002054/2016 (9316
  nós na árvore): **15.537ms pra expandir o painel**. Como o rótulo é o mesmo pra todas as
  peças da mesma leitura, agora ele é calculado no máximo uma vez por leitura (e só se alguma
  peça precisar dele): **caiu para ~600ms**. O mesmo caminho também rodava no `updateStatus()`
  periódico, então a página inteira ficava pesada nesses processos, não só ao expandir.

- **Busca por palavra-chave agora separa processo principal de processos apensados/juntados.**
  Medindo ao vivo o SOL 00002054/2016: das 367 peças / ~8900 páginas que a busca percorria, só
  81 peças / 1137 páginas eram do processo principal - **os apensados respondiam por ~87% do
  custo** (SOL 00003110/2013 e SDR18 00005003/2013, +286 peças). Buscar tudo levava ~4 minutos;
  só no principal, ~50 segundos (medido, 420 ocorrências em 12 peças).
  - **O padrão acompanha o custo dos apensados**, em vez de ser fixo: eles entram na busca
    quando somam até ~30s a mais (não vale perder resultados por poucos segundos) e ficam de
    fora quando pesam a ponto de inviabilizar a busca. Validado nos dois casos reais: no
    SCC 00000842/2024 os apensados custam +4-5s e entram sozinhos; no SOL 00002054/2016 custam
    +205-236s e ficam de fora.
  - O checkbox "Incluir processos apensados/juntados" permite inverter a decisão a qualquer
    momento, e **depois de um toque manual a escolha do usuário passa a mandar** (não volta
    a ser sobrescrita pelo automático). O checkbox só aparece quando a pasta tem apensados.
  - A estimativa mostrada ao expandir a seção separa os dois custos, ex.: "Processo principal:
    81 peças (1137 páginas), ~30s-34s. Apensados (SDR18 00005003/2013, SOL 00003110/2013):
    +286 peças (+7803 páginas), +~205s-236s."
  - A separação reaproveita `getProcessLi()`, que já existia: peça sem nenhum `li.i` de processo
    acima dela na árvore = processo principal; peças de apensados ficam sempre aninhadas dentro
    do item de juntada.
  - **Só a busca por palavra-chave mudou.** A busca por número de página e por nome da peça
    continua enxergando o processo inteiro, apensados incluídos.

- **Estimativa de tempo mais honesta.** Antes ela multiplicava a quantidade de peças por um
  chute fixo de 12 páginas/peça; no processo acima isso dava 4644 páginas contra 7507 reais
  (~40% de erro). Agora usa a contagem real de páginas dos intervalos do `data-p`, caindo no
  chute antigo só quando a árvore não expõe os intervalos.

- **Não há aviso repetido depois da busca** sobre peças de apensados não pesquisadas - a
  informação aparece só antes de buscar, junto do checkbox.

Todos os números acima foram medidos ao vivo, com a extensão carregada, nos processos reais
SOL 00002054/2016 (pesado, com apensados grandes) e SCC 00000842/2024 (leve).

## Mudanças da versão 1.23.0

- **Estrutura da árvore de peças (`#visoes-0-itens`, `ul.g-i > li.i`, atributo `data-p` com
  `nuPaginaInicial`/`nuPaginaFinal`) verificada ao vivo num processo real (SCC 00000842/2024,
  Aba Peças) e confirmada sem mudanças** - os seletores em `SGPE_SELECTORS` continuam batendo
  normalmente (146 peças com intervalo de página detectadas). O que de fato mudou/quebrava era
  o aviso de indisponibilidade (próximo item), não a detecção da árvore em si.

- **Corrigido de vez o aviso falso de "Buscador indisponível" em "Inserir Peça" e
  "Encaminhamento".** A tentativa anterior (1.21.0) só reconhecia essas telas pela URL/texto
  do próprio frame que navega pra fora da árvore (`frameNPasta`), mas o SGPe usa frames
  aninhados: o frame do topo e o frameset intermediário nunca têm a árvore, nem em operação
  normal, e dependiam de um sinal compartilhado de "estrutura saudável" que expira 10s depois
  que o frame de baixo sai da tela de peças. Passado esse tempo, o aviso disparava mesmo
  assim - reproduzido ao vivo em ambas as telas, inclusive Encaminhamento (que parecia corrigido
  antes mas nunca foi). Duas causas, duas correções:
  - O allowlist de paths que o script roda (`ALLOWED_PATH_PREFIXES`) não incluía `/ecmcpa`
    (Inserir Peça) nem `/CpavEncaminhamento` (Encaminhamento) - o script nem chegava a rodar
    nessas telas pra se reconhecer como "tela alternativa conhecida". Adicionados os dois
    prefixos.
  - Agora, quando o frame que de fato navegou pra a tela alternativa se reconhece como tal
    (`isKnownAlternateSgpeScreen()`, table `KNOWN_ALTERNATE_SGPE_SCREENS` - fácil de estender
    com novas telas), ele marca um sinal compartilhado (`markKnownAlternateScreenActive()`)
    que os frames irmãos/pais também respeitam, em vez de cada frame depender só da própria
    URL/texto (que nunca muda pra eles).

- **Aviso falso também podia aparecer ao voltar do Encaminhamento pra tela de Peças (`Voltar`),
  ficando preso na tela "Processo Digital".** O frame do topo (`/cpav/visualizarDocumentosProcesso.do`)
  nunca tem a árvore em nenhuma aba, mas sua própria URL continua parecendo "Pasta Digital"
  (`itemAba=aba_pecas` fica fixo) mesmo quando o conteúdo interno mudou pra outra coisa - então
  ele podia disparar o aviso sozinho, sem depender de qual aba interna estava ativa. Os três
  frames "casca" que nunca têm a árvore em nenhuma aba (frame do topo, frameset e frame da
  barra de abas) foram adicionados a `KNOWN_ALTERNATE_SGPE_SCREENS`, pra nunca disparar o aviso
  por conta própria - só o frame que de fato deveria ter a árvore (`frameNPasta`, na aba Peças)
  continua avaliando e avisando de verdade. Testado ao vivo clicando entre as abas
  Processo/Peças/Tramitações do mesmo processo (a maioria navega pra uma URL totalmente
  diferente e não aciona o aviso por conta disso; o caso do `Voltar` era o único que ficava
  preso na URL da aba Peças com conteúdo de outra tela).

- **Aviso de "Buscador indisponível" não dispara mais na tela "Inserir Peça".** (1.21.0) Essa
  tela do SGPe (`/ecmcpa/abrirNovoCadDocumento.do`) navega o mesmo frame do widget pra fora da
  árvore de peças de propósito - antes isso era detectado como estrutura quebrada e mostrava o
  aviso por engano. Reconhecida via URL e via o título "Inserir Peça" na tela.

- **Nova funcionalidade: busca por palavra-chave no texto das peças.** Dentro do painel
  expandido (nunca na caixa mini, para não pesar o uso padrão), uma nova seção colapsável
  "Busca por palavra-chave (todas as peças)" permite buscar um termo em todas as peças do
  processo aberto.
- A busca lê apenas o **texto nativo** de cada PDF - **não usa OCR**. Peças digitalizadas
  (imagem, sem texto nativo) são sinalizadas separadamente como "digitalizadas, não
  pesquisadas", nunca confundidas com "termo não encontrado".
- O `pdf.js` (Mozilla, Apache 2.0) vem **embutido na própria extensão** (`vendor/pdf.min.js` +
  `vendor/pdf.worker.min.js`), em vez de depender do `pdf.js` que o SGPe carrega na página.
  Tentamos ler o `pdf.js` da própria página numa versão anterior, mas isso nunca funciona de
  verdade: o mecanismo de "isolated world" dos content scripts do Chrome filtra propriedades
  customizadas (como `pdfjsLib`) em qualquer janela lida pelo content script, mesmo de outro
  frame via `window.frames[i]` - confirmado comparando uma leitura via console real (main
  world, achou) com uma leitura via content script real (isolated world, nunca achou), no
  mesmo estado de página.
- **`vendor/pdf.min.js` é carregado sob demanda**, só quando o usuário clica em "Buscar" pela
  primeira vez naquele frame - não mais embutido no `manifest.json` (`content_scripts`), que
  injetava a biblioteca inteira (~320KB) em TODO frame do SGPe, mesmo sem o usuário abrir a
  busca. Medições de performance (DevTools trace, abertura de página e navegação entre peças)
  mostraram que isso quase dobrava o heap JS da página (~225MB -> ~400MB) só pela injeção
  estática, com custo de CPU próprio de apenas ~160ms por vez. Agora um `background.js`
  (service worker) injeta `vendor/pdf.min.js` via `chrome.scripting.executeScript` no mesmo
  frame e isolated world do content script que pediu, na primeira busca; buscas seguintes no
  mesmo frame reusam o `pdfjsLib` já carregado.
- Antes de rodar, mostra uma estimativa de tempo baseada na quantidade de peças do processo
  e em taxas medidas em processos reais (~33-38 páginas/segundo). O tempo real é ajustado
  ao vivo conforme a busca avança.
- Busca é feita peça por peça, sequencialmente (sem paralelismo), com botão de cancelar que
  interrompe de fato as requisições em andamento.
- Peças que não são PDF (ex.: planilhas na árvore) são ignoradas com aviso próprio, sem
  travar o restante da busca.
- **Resultados por peça, com grifado no visualizador nativo do SGPe.** Cada linha de resultado
  mostra "NOME DA PEÇA (N ocorrências)" - sem listar página a página, pra rolagem mais leve em
  processos grandes. Clicar na peça abre ela na página da primeira ocorrência e aciona a barra
  de busca nativa do próprio visualizador PDF do SGPe (`#findInput`, com "Destacar tudo"
  ativado), que grifa todas as ocorrências na tela - o usuário navega entre elas com os botões
  Anterior/Próximo do próprio SGPe. Isso é manipulação de DOM (input, eventos, classes), então
  não esbarra na mesma barreira de isolated world que afetava a leitura do `pdfjsLib`. O campo
  de busca é sempre limpo antes de receber o termo (mesmo se o valor "parecer" igual ao de uma
  busca anterior), pra garantir que o pdf.js trate como busca nova e realce de novo - sem essa
  limpeza, clicar em peças diferentes em sequência podia deixar de grifar a partir da segunda.
- A contagem total de ocorrências fica fixa (`position: sticky`) no topo da área de rolagem
  dos resultados.
- O painel expandido se ajusta sozinho ao conteúdo (mais resultados = painel mais alto, até um
  teto baseado na altura da tela; a partir daí a área de resultados rola internamente) - sem
  precisar arrastar nada. O teto agora leva em conta a posição real do topo do painel (não um
  valor fixo), sempre deixando uma margem de respiro no rodapé do navegador. As janelas de
  rolagem (resultados e listas de peças digitalizadas/ignoradas/com erro) têm altura menor
  de propósito, pra nunca exigir arrastar o widget ou dar zoom out pra ver o rodapé.

## Instalação local

1. Baixe/clone este repositório.
2. Abra `chrome://extensions`.
3. **Remova ou desative qualquer outra cópia desta extensão antes de carregar esta** - todas
   usam a mesma variável de guarda (`window.__codexSgpePageFinderInstalled`); com duas ativas,
   só a que carregar primeiro instala, mascarando silenciosamente as demais.
4. Ative `Modo do desenvolvedor`.
5. Clique em `Carregar sem compactação`.
6. Selecione a pasta deste repositório.
7. Recarregue a aba do SGPe.

## Contribuindo

Sugestões, relatos de bugs e pull requests são bem-vindos. O projeto é ES5 puro, sem etapa de
build (um único content script injetado direto no SGPe) - veja
[`INSTRUCOES.md`](INSTRUCOES.md) para a arquitetura do `content-script.js` e as convenções de
versionamento/changelog seguidas a cada mudança.

## Como testar a busca por palavra-chave

1. Abra um processo real na Pasta Digital (Aba Peças) do SGPe.
2. Expanda o painel do widget (botão `+` na caixa mini).
3. Clique em "Busca por palavra-chave (todas as peças)" para expandir a seção - a estimativa
   de tempo aparece na hora. Se o processo tiver apensados/juntados, a estimativa separa o
   custo do processo principal do custo dos apensados, e aparece o checkbox "Incluir processos
   apensados/juntados" (desmarcado por padrão).
4. Digite um termo (mínimo 2 caracteres) e clique em "Buscar".
5. Acompanhe o progresso; clique em qualquer peça do resultado para abrir na primeira
   ocorrência e grifar todas as ocorrências via a busca nativa do visualizador do SGPe.
6. Para validar a separação principal/apensados, use um processo com juntadas (ex.:
   SOL 00002054/2016) e confira que o contador de progresso percorre só as peças do principal
   com o checkbox desmarcado, e o total com ele marcado.
