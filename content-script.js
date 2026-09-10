// ==UserScript==
// @name         SGPe - Buscador de paginas
// @namespace    codex.sgpe
// @version      1.25.5
// @description  Caixa flutuante para abrir uma pagina global na Pasta Digital do SGPe, com busca por palavra-chave no texto nativo das pecas (sem OCR).
// @match        https://sgpe.sea.sc.gov.br/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// elaborado para auxiliar análises de checklists referenciados nos processos do Portal de Processos Eletrônicos do Estado de Santa Catarina (SGPe) - idealização Daniel Rohden Speck (CONIN FCC)
// v1.22.0: carrega vendor/pdf.min.js sob demanda (so quando a busca por palavra-chave e usada),
// em vez de embutido no manifest.json - ver README.md.
// v1.23.0: corrige aviso falso de "Buscador indisponivel" que ainda aparecia em telas como
// Inserir Peca e Encaminhamento apos alguns segundos - ver README.md.
// v1.24.0: corrige travamento de ~15s da UI ao abrir o painel em processos grandes
// (getRootLabel repetido por peca) e separa processo principal de apensados na busca por
// palavra-chave, com padrao conforme o custo dos apensados - ver README.md.
// v1.25.0: campo "No do Processo" vira lista suspensa pra restringir buscas a um unico
// processo/apensado da arvore (opcional, buscas continuam cobrindo tudo por padrao); novo item
// "Buscar no processo" no menu de contexto do botao direito, pra abrir direto a pagina de um
// numero selecionado em qualquer texto do SGPe - ver README.md.
// v1.25.1: corrige o filtro de processo (1.25.0) nao "travar" a busca - trocada a identidade
// por referencia de elemento DOM (instavel, a arvore do SGPe recria nos periodicamente) por
// numero do processo; menu de contexto "Buscar no processo" passa a aparecer em QUALQUER aba/
// janela (nao so no SGPe, ja que o numero costuma ser lido num PDF em outra aba) e mira sempre
// a aba do SGPe ativa no momento, restringindo a busca ao processo mae - ver README.md.
// v1.25.2: processo mae vira o padrao do campo "No do Processo" (antes era "Todos os
// processos"); busca pelo menu de contexto passa a acompanhar a situacao ativa do widget, com
// excecao de "Todos os processos" (convertida pro processo mae); status abaixo do campo de
// pagina vira "Total de X paginas em Y processo(s)."; lista suspensa vira controle proprio
// (nao <select> nativo) pra mostrar a contagem de paginas de cada processo, em fonte reduzida,
// embaixo do numero - ver README.md.
// v1.25.3: corrige dois bugs. (1) findPageMatches() cruzava numeracao real (data-p) E local ao
// mesmo tempo - o SGPe pode reiniciar a numeracao real por peca, o que criava um resultado
// fantasma (2 opcoes onde so devia haver 1) mesmo dentro de um unico processo filtrado; agora
// prioriza a numeracao local (sem sobreposicao dentro do processo), so cai pra real se nenhuma
// peca cobrir a pagina localmente. (2) "Limpar" travava a arvore nativa do SGPe (os +/- clicavam
// mas o conteudo parava de abrir, exigindo recarregar a pagina) - closeAllOpenTreeNodes()
// percorria TODOS os nos da arvore inteira (milhares num processo grande) disparando um clique
// sintetico real no toggler do SGPe pra cada um aberto, num loop sincrono sem pausa;
// dessincronizava o estado interno do widget de arvore do SGPe. Trocado por
// closePreviousAutoExpandedNodes(), que so fecha os poucos nos que a extensao mesma abriu numa
// busca (nunca os que o usuario abriu na mao) - ver README.md.
// v1.25.4: corrige dois problemas. (1) extractPageNumberFromSelection() (menu de contexto) so
// pegava o numero a esquerda do ponto de milhar (ex.: "1.947" virava so "1") - agora reconhece
// numeros com pontos de milhar (grupos de exatamente 3 digitos) e remove os pontos antes de
// converter. (2) findPageMatches() tinha voltado a abrir a peca errada (deslocada) em processos
// com lacuna de paginacao real (ex.: faltam as paginas 2-3-4) - a 1.25.3 tinha trocado a
// prioridade pra numeracao local, que diverge da real justamente a partir de uma lacuna dessas,
// abrindo peca errada pra QUALQUER pagina real depois dela. Corrigido: numeracao real volta a
// ser prioridade sempre que so 1 peca a cobre (o caso comum); a numeracao local so desempata
// quando MAIS DE UMA peca coincide no mesmo numero real (o caso que a 1.25.3 resolvia) - ver
// README.md.
// v1.25.5: corrige getProcessLi() - pegava o ancestral "li.i" de processo MAIS DISTANTE em vez
// do mais proximo. Um apensado pode ter outros apensados juntados aninhados dentro dele
// (Juntada de processos dentro de Juntada de processos), e isso fazia TODOS os apensados
// aninhados de um mesmo apensado "pai" serem tratados como um unico grupo - numeracao local
// somada de todos juntos e rotulo sempre o do apensado mais externo, em vez de cada um manter
// sua propria identidade. Confirmado ao vivo num processo real com 5 apensados aninhados
// dentro de 1 apensado: cada um agora resolve pro seu proprio numero de processo, em vez de
// todos caírem no numero do apensado externo - ver README.md.

(function () {
  'use strict';

  var EXTENSION_VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
  var TOOL_ID = 'codex-sgpe-page-finder';
  var STORAGE_KEY = 'codex-sgpe-page-finder-position-v6';
  var WIDGET_BOTTOM_MARGIN_PX = 40;
  var CLOSED_ATTR = 'data-codex-sgpe-page-finder-closed';
  var WARNING_MUTED_ATTR = 'data-codex-sgpe-page-finder-warning-muted';
  var WARNING_DISMISSED_UNTIL_ATTR = 'data-codex-sgpe-page-finder-warning-dismissed-until';
  var ALTERNATE_SCREEN_MARK_ATTR = 'data-codex-sgpe-page-finder-alternate-screen-at';
  var HIGHLIGHT_CLASS = 'codex-sgpe-page-highlight';
  var ALLOWED_HOST = 'sgpe.sea.sc.gov.br';
  // /ecmcpa (Inserir Peca) e /CpavEncaminhamento (Encaminhamento) precisam estar aqui mesmo
  // sem arvore de pecas propria - e so rodando nessas telas que isKnownAlternateSgpeScreen()
  // consegue marcar o sinal compartilhado que suprime o aviso falso nos frames irmaos.
  var ALLOWED_PATH_PREFIXES = ['/sgpe', '/cpav', '/cpavPasta', '/ecmcpa', '/CpavEncaminhamento'];
  var SGPE_SELECTORS = {
    roots: '#visoes-0-itens, [id^="visoes-"][id$="-itens"]',
    pieceItems: 'ul.g-i > li.i',
    pieceItemsWithPageRange: 'ul.g-i > li.i[data-p*="nuPaginaInicial"]',
    name: ':scope > .i-nm.linkPecas, :scope > .i-nm',
    directName: ':scope > .i-nm',
    toggler: ':scope > .tg'
  };
  var statusEl;
  var inputEl;
  var choiceEl;
  var pieceInputEl;
  var processInputEl;
  var processDisplayEl;
  var processMenuEl;
  var processDropdownOpen = false;
  var refreshTimer;
  var structureWarningTimer;
  var firstStructureWarningAt = 0;
  var STRUCTURE_WARNING_DELAY_MS = 6000;
  var STRUCTURE_HEALTHY_GRACE_MS = 10000;
  var pieceSearchTimer;
  var pendingChoiceMode = '';
  var pendingChoicePage = null;
  var pendingChoiceQuery = '';
  var pendingChoiceMatches = [];
  var selectedPiecesRoot = null;
  var selectedProcessLi = null;
  var autoExpandedTreeNodes = [];
  var manualTreeMode = false;
  var suppressTreeClickSync = false;
  var userClosed = false;

  // ---- Filtro manual de processo (restringe as buscas a um unico processo/apensado) ----
  // Duas fontes possiveis pro "processo ativo" (getEffectiveProcessFilter()):
  // (1) escolha manual explicita no controle "No do Processo" (manualProcessFilterActive ===
  //     true) - fica travada ate o usuario escolher outra opcao, nunca e sobrescrita por clique
  //     na arvore. Inclui a escolha explicita "Todos os processos" (manualProcessFilter ===
  //     null com a flag true), que e um estado real e persistente - sem restricao nenhuma -,
  //     diferente do modo automatico abaixo.
  // (2) modo automatico (manualProcessFilterActive === false), que acompanha o processo do
  //     ultimo clique/abertura na arvore (setViewedProcess()) e comeca, antes de qualquer
  //     clique, no processo mae (lastViewedProcessMain inicia true) - esse e o padrao do campo.
  //
  // Excecao: o gatilho do menu de contexto "Buscar no processo" sempre acompanha essa mesma
  // situacao ativa, exceto quando ela e "Todos os processos" (escolha manual explicita) - nesse
  // caso a busca e convertida pra so o processo mae. Ver handleSearchInProcessRequest().
  //
  // Identidade por rotulo (numero do processo) + flag "main", nao por referencia de elemento
  // DOM (root/processLi) - a arvore do SGPe recria nos periodicamente (a mesma
  // MutationObserver que essa extensao ja observa prova isso), entao guardar uma referencia de
  // elemento fazia o filtro "cair" sozinho pouco depois de escolhido. Numero do processo e
  // estavel entre essas recriacoes.
  var manualProcessFilterActive = false;
  var manualProcessFilter = null; // { label, main } ou null quando manual = "Todos os processos"
  var lastViewedProcessLabel = '';
  var lastViewedProcessMain = true; // padrao antes de qualquer clique na arvore: processo mae
  var processSelectOptions = []; // [{ label, main, pages }]
  // ---- fim: filtro manual de processo ----

  // ---- Busca por palavra-chave (texto nativo do PDF via pdf.js) ----
  // Taxas medidas manualmente em processos reais do SGPe (sequencial, sem OCR):
  // 178 pecas / 1509 paginas em 44.8s (~33.7 pag/s); 14 pecas / 227 paginas em 5.97s (~38 pag/s).
  var PDF_SEARCH_RATE_MIN_PPS = 33;
  var PDF_SEARCH_RATE_MAX_PPS = 38;
  var PDF_SEARCH_FALLBACK_PAGES_PER_PIECE = 12; // estimativa grosseira pre-busca, baixa confianca
  var KEYWORD_MIN_QUERY_LENGTH = 2;
  // Ate quantos segundos a mais os processos apensados podem custar pra entrarem na busca por
  // padrao. Medido em processos reais: num deles os apensados somam ~5s (nao faz sentido perder
  // esses resultados pra economizar isso), noutro somam ~236s (inviabiliza a busca).
  var KEYWORD_JOINED_AUTO_INCLUDE_MAX_SECONDS = 30;

  var keywordSearchState = null;
  var keywordSearchStarting = false;
  var keywordSectionExpanded = false;
  var keywordIncludeJoinedTouched = false;

  var keywordSectionEl;
  var keywordToggleBtn;
  var keywordInputEl;
  var keywordSearchBtn;
  var keywordCancelBtn;
  var keywordEstimateEl;
  var keywordIncludeJoinedEl;
  var keywordIncludeJoinedRow;
  var keywordProgressEl;
  var keywordProgressBarEl;
  var keywordResultsEl;
  var keywordSummaryEl;
  // ---- fim: estado da busca por palavra-chave ----

  if (
    location.protocol !== 'https:' ||
    location.hostname !== ALLOWED_HOST ||
    !ALLOWED_PATH_PREFIXES.some(function (prefix) { return location.pathname.indexOf(prefix) === 0; })
  ) return;

  if (window.__codexSgpePageFinderInstalled) return;
  window.__codexSgpePageFinderInstalled = true;
  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function stripDiacritics(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeSearchText(text) {
    return stripDiacritics(clean(text));
  }

  function parseParams(value) {
    var params = {};
    String(value || '').split('&').forEach(function (part) {
      var idx = part.indexOf('=');
      if (idx === -1) return;
      var key = decodeURIComponent(part.slice(0, idx));
      var val = decodeURIComponent(part.slice(idx + 1).replace(/\+/g, ' '));
      params[key] = val;
    });
    return params;
  }

  function pageLabel(page) {
    return 'Pagina ' + String(page).padStart(4, '0');
  }

  function parsePieceRange(li) {
    var params = parseParams(li && li.getAttribute('data-p'));
    var start = Number(params.nuPaginaInicial);
    var end = Number(params.nuPaginaFinal);
    var fallbackRange = !Number.isFinite(start) || !Number.isFinite(end)
      ? parsePageRangeFromText(getDirectName(li && li.querySelector(':scope > .i-nm.linkPecas, :scope > .i-nm')))
      : null;

    if (fallbackRange) {
      start = fallbackRange.start;
      end = fallbackRange.end;
    }

    return {
      params: params,
      start: start,
      end: end,
      valid: Number.isFinite(start) && Number.isFinite(end) && start >= 1 && end >= start
    };
  }

  function parsePageRangeFromText(text) {
    var value = normalizeSearchText(text);
    var match = value.match(/\bpaginas?\s*0*(\d{1,5})\s*(?:a|ate|-)\s*0*(\d{1,5})\b/);
    if (!match) return null;

    var start = Number(match[1]);
    var end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) return null;

    return { start: start, end: end };
  }

  function detectSgpeStructure() {
    var roots = Array.prototype.slice.call(document.querySelectorAll(SGPE_SELECTORS.roots));
    var pieceItems = roots.reduce(function (count, root) {
      return count + root.querySelectorAll(SGPE_SELECTORS.pieceItems).length;
    }, 0);
    var rangedPieces = roots.reduce(function (count, root) {
      return count + root.querySelectorAll(SGPE_SELECTORS.pieceItemsWithPageRange).length;
    }, 0);

    return {
      ok: roots.length > 0 && rangedPieces > 0,
      rootsFound: roots.length,
      piecesFound: pieceItems,
      rangedPiecesFound: rangedPieces,
      hasDataP: rangedPieces > 0,
      frameUrl: location.href
    };
  }

  function isLikelyDigitalFolderContext() {
    var path = location.pathname || '';
    var text = clean(document.body && document.body.innerText).slice(0, 3000);

    return path.indexOf('/cpavPasta') === 0 ||
      path.indexOf('/cpav') === 0 && /visualizarDocumentosProcesso|pasta.?digital|aba_pecas/i.test(location.href) ||
      path.indexOf('/sgpe') !== 0 && /Pasta Digital|Pe(c|ç)as do Processo Digital|Selecionar todos|aba Pe(c|ç)as/i.test(text);
  }

  // Algumas acoes da Pasta Digital (ex.: "Inserir Peca", "Encaminhamento") navegam
  // temporariamente o frame que contem a arvore pra fora dela - a arvore some de proposito
  // nessas telas, nao por estrutura quebrada. Cada entrada aqui e uma tela conhecida; para
  // reconhecer uma tela nova encontrada numa varredura, basta acrescentar um objeto
  // (pathPrefix e/ou textPattern), sem mexer na logica de deteccao.
  //
  // As tres ultimas entradas sao os frames "casca" do Processo Digital (o frame do topo, o
  // frameset e o frame da barra de abas "Processo | Pecas | Tramitacoes | ...") - eles NUNCA
  // tem a arvore, em nenhuma aba, e o proprio sinal de "parece Pasta Digital" (URL com
  // aba_pecas) fica sempre positivo neles independente de qual aba interna esta ativa. Sem
  // essas entradas, trocar pra qualquer aba que nao seja "Pecas" (Processo, Tramitacoes,
  // Tarefas, Juncoes/Vinculacoes, Volumes, Dados Adicionais) dispara o aviso falso, porque so
  // esses frames casca enxergam a URL "tipo Pasta Digital" - o frame de conteudo de cada aba
  // tem uma URL propria que nao bate com esse padrao.
  var KNOWN_ALTERNATE_SGPE_SCREENS = [
    { label: 'Inserir Peca - formulario', pathPrefix: '/ecmcpa/abrirNovoCadDocumento.do' },
    { label: 'Inserir Peca - titulo da tela', textPattern: /Inserir\s+Pe(c|ç)a/i },
    { label: 'Encaminhamento - formulario', pathPrefix: '/CpavEncaminhamento/' },
    { label: 'Encaminhamento - titulo da tela', textPattern: /Encaminhamento\s+de\s+Processos\/Documentos/i },
    { label: 'Frame casca - topo', pathPrefix: '/cpav/visualizarDocumentosProcesso.do' },
    { label: 'Frame casca - frameset', pathPrefix: '/cpav/cpavVisualizacaoDocumentosProcessoFrameset.jsp' },
    { label: 'Frame casca - barra de abas', pathPrefix: '/cpav/visualizarDocumentosProcessoTitulo.do' }
  ];

  function isKnownAlternateSgpeScreen() {
    var path = location.pathname || '';
    var text = clean(document.body && document.body.innerText).slice(0, 500);

    return KNOWN_ALTERNATE_SGPE_SCREENS.some(function (screen) {
      return (screen.pathPrefix && path.indexOf(screen.pathPrefix) === 0) ||
        (screen.textPattern && screen.textPattern.test(text));
    });
  }

  function getWarningDocument() {
    try {
      if (window.top && window.top.document && window.top.document.body) return window.top.document;
    } catch (error) {}
    return document;
  }

  function getStructureWarningElement() {
    var warningDocument = getWarningDocument();
    return warningDocument.getElementById(TOOL_ID + '-structure-warning');
  }

  function getSharedWarningRoot() {
    var warningDocument = getWarningDocument();
    return warningDocument.documentElement || warningDocument.body || document.documentElement;
  }

  function readStructureHealthyAt() {
    var root = getSharedWarningRoot();
    return Number(root && root.getAttribute('data-codex-sgpe-page-finder-healthy-at')) || 0;
  }

  function markStructureHealthy() {
    var root = getSharedWarningRoot();
    if (root) root.setAttribute('data-codex-sgpe-page-finder-healthy-at', String(Date.now()));
  }

  function hasRecentlyHealthyStructure() {
    var healthyAt = readStructureHealthyAt();
    return healthyAt && Date.now() - healthyAt < STRUCTURE_HEALTHY_GRACE_MS;
  }

  // Frames irmaos/pais do frame que contem a arvore (o frame do topo, o frameset) nunca tem a
  // arvore, mesmo em operacao normal - eles dependiam so da propria URL/texto (que nunca muda
  // pra "Inserir Peca"/"Encaminhamento", so o frame de baixo navega) e do sinal de "saudavel"
  // recente, que para de ser renovado assim que o frame de baixo sai da arvore. Esse marcador
  // compartilhado deixa o frame que de fato reconheceu a tela alternativa avisar os outros.
  function readKnownAlternateScreenMarkedAt() {
    var root = getSharedWarningRoot();
    return Number(root && root.getAttribute(ALTERNATE_SCREEN_MARK_ATTR)) || 0;
  }

  function markKnownAlternateScreenActive() {
    var root = getSharedWarningRoot();
    if (root) root.setAttribute(ALTERNATE_SCREEN_MARK_ATTR, String(Date.now()));
  }

  function hasRecentlyConfirmedAlternateScreen() {
    var markedAt = readKnownAlternateScreenMarkedAt();
    return markedAt && Date.now() - markedAt < STRUCTURE_HEALTHY_GRACE_MS;
  }

  function isStructureWarningMuted() {
    var root = getSharedWarningRoot();
    return !!(root && root.getAttribute(WARNING_MUTED_ATTR) === 'true');
  }

  function isStructureWarningDismissed() {
    var root = getSharedWarningRoot();
    var dismissedUntil = Number(root && root.getAttribute(WARNING_DISMISSED_UNTIL_ATTR)) || 0;
    return dismissedUntil && Date.now() < dismissedUntil;
  }

  function dismissStructureWarning(minutes) {
    var root = getSharedWarningRoot();
    if (root) root.setAttribute(WARNING_DISMISSED_UNTIL_ATTR, String(Date.now() + minutes * 60 * 1000));
    clearStructureWarning();
  }

  function muteStructureWarning() {
    var root = getSharedWarningRoot();
    if (root) root.setAttribute(WARNING_MUTED_ATTR, 'true');
    clearStructureWarning();
  }

  function readUserClosed() {
    var root = getSharedWarningRoot();
    return userClosed || !!(root && root.getAttribute(CLOSED_ATTR) === 'true');
  }

  function setUserClosed(value) {
    userClosed = !!value;
    var root = getSharedWarningRoot();
    if (root) {
      if (value) root.setAttribute(CLOSED_ATTR, 'true');
      else root.removeAttribute(CLOSED_ATTR);
    }
  }

  function scheduleStructureWarning(diagnostic) {
    if (readUserClosed()) return;
    if (isStructureWarningMuted() || isStructureWarningDismissed()) return;
    if (!document.body || document.getElementById(TOOL_ID) || getStructureWarningElement() || hasRecentlyHealthyStructure() || hasRecentlyConfirmedAlternateScreen()) return;
    if (!isLikelyDigitalFolderContext()) return;
    if (isKnownAlternateSgpeScreen()) return;

    if (!firstStructureWarningAt) firstStructureWarningAt = Date.now();
    window.clearTimeout(structureWarningTimer);
    structureWarningTimer = window.setTimeout(function () {
      if (readUserClosed()) return;
      if (isStructureWarningMuted() || isStructureWarningDismissed()) return;
      var latestDiagnostic = detectSgpeStructure();
      if (latestDiagnostic.ok || document.getElementById(TOOL_ID) || getStructureWarningElement() || hasRecentlyHealthyStructure() || hasRecentlyConfirmedAlternateScreen()) return;
      showStructureWarning(latestDiagnostic);
    }, Math.max(800, STRUCTURE_WARNING_DELAY_MS - (Date.now() - firstStructureWarningAt)));
  }

  function showStructureWarning(diagnostic) {
    if (readUserClosed()) return;
    if (isStructureWarningMuted() || isStructureWarningDismissed()) return;
    var warningDocument = getWarningDocument();
    if (!warningDocument.body || getStructureWarningElement() || hasRecentlyHealthyStructure() || hasRecentlyConfirmedAlternateScreen()) return;
    if (!isLikelyDigitalFolderContext()) return;
    if (isKnownAlternateSgpeScreen()) return;

    var warning = makeEl('div', {
      id: TOOL_ID + '-structure-warning',
      title: 'Estrutura esperada nao encontrada. Diagnostico: raizes=' +
        (diagnostic && diagnostic.rootsFound) + ', pecas=' +
        (diagnostic && diagnostic.piecesFound) + ', intervalos=' +
        (diagnostic && diagnostic.rangedPiecesFound) + ', url=' + location.href,
      style: {
        position: 'fixed',
        top: '35px',
        left: '263px',
        zIndex: 2147483647,
        width: '305px',
        padding: '10px 10px 9px',
        background: '#fff7ed',
        border: '1px solid #f97316',
        borderRadius: '4px',
        boxShadow: '0 2px 9px rgba(0,0,0,.18)',
        font: '12px Arial, sans-serif',
        color: '#7c2d12'
      }
    });

    var title = makeEl('div', {
      style: {
        fontWeight: '700',
        marginBottom: '5px',
        paddingRight: '22px'
      }
    }, 'Buscador SGPe indisponivel nesta tela');

    var close = makeEl('button', {
      type: 'button',
      title: 'Fechar aviso por 5 minutos',
      style: {
        position: 'absolute',
        top: '5px',
        right: '6px',
        border: '0',
        background: 'transparent',
        color: '#7c2d12',
        cursor: 'pointer',
        fontSize: '14px',
        lineHeight: '14px',
        padding: '2px'
      }
    }, 'x');

    var body = makeEl('div', {
      style: {
        marginBottom: '8px'
      }
    }, 'A estrutura da Pasta Digital (Aba Pecas) parece ter mudado. A extensao precisa ser atualizada antes de continuar usando o buscador.');

    var help = makeEl('div', {
      style: {
        marginBottom: '8px',
        color: '#9a3412'
      }
    }, 'Se preferir nao receber novos avisos, desative a extensao em chrome://extensions.');

    var actions = makeEl('div', {
      style: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '6px'
      }
    });

    var mute = makeEl('button', {
      type: 'button',
      title: 'Silenciar avisos ate recarregar a pagina',
      style: {
        border: '1px solid #fdba74',
        borderRadius: '3px',
        background: '#ffedd5',
        color: '#7c2d12',
        cursor: 'pointer',
        fontSize: '11px',
        padding: '4px 6px'
      }
    }, 'Nao avisar nesta sessao');

    close.addEventListener('click', function () {
      dismissStructureWarning(5);
    });

    mute.addEventListener('click', function () {
      muteStructureWarning();
    });

    actions.appendChild(mute);
    warning.appendChild(close);
    warning.appendChild(title);
    warning.appendChild(body);
    warning.appendChild(help);
    warning.appendChild(actions);
    warningDocument.body.appendChild(warning);
  }

  function clearStructureWarning() {
    window.clearTimeout(structureWarningTimer);
    firstStructureWarningAt = 0;
    var warning = getStructureWarningElement();
    if (warning) warning.remove();
  }

  function suspendScriptAfterClose() {
    setUserClosed(true);
    window.clearTimeout(refreshTimer);
    window.clearTimeout(pieceSearchTimer);
    clearStructureWarning();
    clearPageChoices();
    clearTreeHighlight();
    cancelKeywordSearch();
    statusEl = null;
    inputEl = null;
    choiceEl = null;
    pieceInputEl = null;
    processInputEl = null;
    processDisplayEl = null;
    processMenuEl = null;
    processDropdownOpen = false;
    keywordSectionEl = null;
    keywordToggleBtn = null;
    keywordInputEl = null;
    keywordSearchBtn = null;
    keywordCancelBtn = null;
    keywordEstimateEl = null;
    keywordIncludeJoinedEl = null;
    keywordIncludeJoinedRow = null;
    keywordProgressEl = null;
    keywordProgressBarEl = null;
    keywordResultsEl = null;
    keywordSummaryEl = null;
  }

  function isPiecesTabClickTarget(target) {
    if (!target || !target.closest) return false;
    if (target.closest('#' + TOOL_ID + ', #' + TOOL_ID + '-structure-warning')) return false;
    if (target.closest('#visoes-0-itens, [id^="visoes-"][id$="-itens"], ul.g-i, li.i, .i-nm')) return false;

    var current = target.closest('a, button, [role="tab"], [aria-controls], [href], [data-target], [data-url], [data-src], li');
    while (current && current !== document.documentElement) {
      var raw = [
        current.getAttribute && current.getAttribute('href'),
        current.getAttribute && current.getAttribute('data-target'),
        current.getAttribute && current.getAttribute('data-url'),
        current.getAttribute && current.getAttribute('data-src'),
        current.getAttribute && current.getAttribute('data-action'),
        current.getAttribute && current.getAttribute('onclick'),
        current.getAttribute && current.getAttribute('id'),
        current.getAttribute && current.getAttribute('class'),
        current.getAttribute && current.getAttribute('aria-controls'),
        current.getAttribute && current.getAttribute('aria-label'),
        current.getAttribute && current.getAttribute('title'),
        clean(current.textContent)
      ].filter(Boolean).join(' ');
      var text = normalizeSearchText(raw);
      var label = normalizeSearchText(clean(current.textContent));
      var isTabControl = current.matches('a, button, [role="tab"], [aria-controls], [href], [data-target], [data-url], [data-src]') ||
        /\b(nav|tab|aba)\b/i.test(current.className || '');

      if (/aba[_\s-]*pecas|itemaba=aba_pecas|\/cpavpasta\/services\/pasta-digital\/getpastadigital/i.test(text)) return true;
      if (isTabControl && /^pecas(?:\s*\(\d+\))?$/.test(label)) return true;
      current = current.parentElement;
    }

    return false;
  }

  function resumeScriptAfterPiecesTabClick(event) {
    if (!readUserClosed()) return;
    if (!isPiecesTabClickTarget(event.target)) return;

    setUserClosed(false);
    window.setTimeout(function () {
      ensureUi();
      updateStatus();
    }, 500);
  }
  function extractProcessNumber(text) {
    var match = clean(text).match(/\b[A-Z]{2,10}\s+\d{1,8}\/\d{4}\b/);
    return match ? match[0] : '';
  }

  function isGenericRootLabel(text) {
    return /^(vis(ao|\u00e3o)|pe(c|\u00e7)as?|pasta digital|documentos?)\b/i.test(clean(text));
  }

  function getRootLabel(root) {
    if (!root) return '';

    var id = root.id || '';
    var match = id.match(/^visoes-(\d+)-itens$/);
    if (match) {
      var index = match[1];
      var candidates = [
        document.getElementById('visoes-' + index),
        document.querySelector('[href="#' + id + '"], [aria-controls="' + id + '"]'),
        document.querySelector('[data-target="#' + id + '"], [data-target="' + id + '"]')
      ];

      for (var i = 0; i < candidates.length; i += 1) {
        var label = clean(candidates[i] && candidates[i].textContent);
        var processNumber = extractProcessNumber(label);
        if (processNumber) return processNumber;
        if (label && !/^\d+$/.test(label) && !isGenericRootLabel(label)) return label;
      }

      var heading = document.querySelector('h1, h2, h3, .titulo, .cabecalho, .processo');
      var documentProcessNumber = extractProcessNumber(document.title) ||
        extractProcessNumber(heading && heading.textContent) ||
        extractProcessNumber(document.body && document.body.textContent);

      return documentProcessNumber || 'Processo/visao ' + (Number(index) + 1);
    }

    var rootLabel = clean(root.getAttribute('aria-label') || root.getAttribute('title'));
    return extractProcessNumber(rootLabel) || (isGenericRootLabel(rootLabel) ? '' : rootLabel) || 'Processo atual';
  }

  function isPieceLi(li) {
    return parsePieceRange(li).valid;
  }

  // Retorna o ancestral "li.i" de processo MAIS PROXIMO (nao o mais distante) - um apensado
  // pode ter outros apensados juntados aninhados dentro dele (Juntada de processos dentro de
  // Juntada de processos), e cada nivel e um processo logico proprio, com seu proprio numero.
  // Pegar o mais distante fazia todos os apensados aninhados dentro de um mesmo apensado "pai"
  // serem tratados como um unico grupo (numeracao local somada de todos juntos, rotulo sempre
  // o do apensado mais externo) em vez de cada um manter sua propria identidade.
  function getProcessLi(pieceLi, root) {
    var current = pieceLi && pieceLi.parentElement && pieceLi.parentElement.closest('li.i');

    while (current && root && root.contains(current)) {
      if (!isPieceLi(current)) return current;
      current = current.parentElement && current.parentElement.closest('li.i');
    }

    return null;
  }

  // resolveRootLabel permite reaproveitar um getRootLabel() ja calculado - ver o comentario em
  // getPiecesFromRoot(), onde repetir essa chamada por peca custava segundos de UI travada.
  function getProcessLabel(root, processLi, resolveRootLabel) {
    if (processLi) {
      var nameEl = processLi.querySelector(':scope > .i-nm.linkPecas, :scope > .i-nm');
      var name = getDirectName(nameEl);
      if (name) return extractProcessNumber(name) || name;
    }

    return resolveRootLabel ? resolveRootLabel() : getRootLabel(root);
  }

  function getDirectName(nameEl) {
    if (!nameEl) return '';
    var pieces = [];
    nameEl.childNodes.forEach(function (node) {
      if (node.nodeType === Node.TEXT_NODE) pieces.push(node.textContent);
    });
    return clean(pieces.join(' ')) ||
      clean(nameEl.textContent).replace(/Setor:.*/, '').replace(/Pagina\s+\d+.*/, '');
  }

  function getPiecesRoots() {
    return Array.prototype.slice.call(
      document.querySelectorAll('#visoes-0-itens, [id^="visoes-"][id$="-itens"]')
    ).filter(function (root) {
      return root.querySelector('ul.g-i > li.i[data-p*="nuPaginaInicial"]');
    });
  }

  function findPiecesRoot() {
    var roots = getPiecesRoots();

    if (
      selectedPiecesRoot &&
      document.documentElement.contains(selectedPiecesRoot) &&
      selectedPiecesRoot.querySelector('ul.g-i > li.i[data-p*="nuPaginaInicial"]') &&
      window.getComputedStyle(selectedPiecesRoot).display !== 'none' &&
      window.getComputedStyle(selectedPiecesRoot).visibility !== 'hidden' &&
      selectedPiecesRoot.getClientRects().length > 0
    ) {
      return selectedPiecesRoot;
    }

    return roots.find(function (root) {
      var style = window.getComputedStyle(root);
      return style.display !== 'none' && style.visibility !== 'hidden' && root.getClientRects().length > 0;
    }) || roots[0] || null;
  }

  function getPiecesFromRoot(root, useSelectedProcess) {
    if (!root) return [];
    var activeProcessLi = (
      useSelectedProcess &&
      selectedProcessLi &&
      document.documentElement.contains(selectedProcessLi) &&
      root.contains(selectedProcessLi)
    ) ? selectedProcessLi : null;

    // getRootLabel() varre o documento inteiro (querySelector de atributo, sem indice) e ainda
    // serializa o body todo pra rodar uma regex - ~14ms por chamada numa pasta grande. Como o
    // map abaixo roda em TODOS os li.i da arvore (inclusive os de pagina, que so sao descartados
    // no filter do final), num processo com muitos apensados isso chegava a ~945 chamadas: ~13s
    // de UI travada a cada leitura da arvore, tanto ao expandir o painel quanto no updateStatus
    // periodico. O rotulo e o mesmo pra todas as pecas desta leitura, entao e calculado no
    // maximo uma vez - e so se alguma peca realmente precisar dele.
    var rootLabelCache;
    function resolveRootLabel() {
      if (rootLabelCache === undefined) rootLabelCache = getRootLabel(root);
      return rootLabelCache;
    }

    var pieces = Array.prototype.slice.call(root.querySelectorAll('ul.g-i > li.i'))
      .filter(function (li) {
        return !activeProcessLi || activeProcessLi.contains(li);
      })
      .map(function (li) {
        var range = parsePieceRange(li);
        var params = range.params;
        var start = range.start;
        var end = range.end;
        var nameEl = li.querySelector(':scope > .i-nm.linkPecas, :scope > .i-nm');
        var processLi = getProcessLi(li, root);
        var pageItems = Array.prototype.slice.call(li.querySelectorAll(':scope > ul.g-i > li.i'))
          .map(function (pageLi) {
            return {
              li: pageLi,
              nameEl: pageLi.querySelector(':scope > .i-nm'),
              params: parseParams(pageLi.getAttribute('data-p'))
            };
          });

        return {
          li: li,
          root: root,
          processLi: processLi,
          nameEl: nameEl,
          name: getDirectName(nameEl),
          process: getProcessLabel(root, processLi, resolveRootLabel),
          start: start,
          end: end,
          localStart: start,
          localEnd: end,
          cdDocumento: params.cdDocumento || '',
          pageItems: pageItems
        };
      })
      .filter(function (piece) {
        return piece.name && Number.isFinite(piece.start) && Number.isFinite(piece.end);
      });

    var groups = [];
    pieces.forEach(function (piece) {
      var group = groups.find(function (candidate) {
        return candidate.root === piece.root && candidate.processLi === piece.processLi;
      });

      if (!group) {
        group = { root: piece.root, processLi: piece.processLi, nextPage: 1 };
        groups.push(group);
      }

      var pageCount = Math.max(1, piece.end - piece.start + 1);
      piece.localStart = group.nextPage;
      piece.localEnd = group.nextPage + pageCount - 1;
      group.nextPage = piece.localEnd + 1;
    });

    return pieces;
  }

  function getPieces() {
    return getPiecesFromRoot(findPiecesRoot(), true);
  }

  // Uma peca do processo principal nao tem nenhum "li.i" de processo acima dela na arvore -
  // processos apensados/juntados ficam aninhados dentro de um item proprio ("Juntada de
  // processos"), entao suas pecas sempre tem processLi preenchido por getProcessLi().
  function isMainProcessPiece(piece) {
    return !piece.processLi;
  }

  function splitPiecesByProcessOrigin(pieces) {
    var main = [];
    var joined = [];
    pieces.forEach(function (piece) {
      (isMainProcessPiece(piece) ? main : joined).push(piece);
    });
    return { main: main, joined: joined };
  }

  function countPages(pieces) {
    return pieces.reduce(function (total, piece) {
      return total + Math.max(1, piece.end - piece.start + 1);
    }, 0);
  }

  function listJoinedProcessLabels(joinedPieces) {
    var labels = [];
    joinedPieces.forEach(function (piece) {
      var label = piece.process;
      if (label && labels.indexOf(label) === -1) labels.push(label);
    });
    return labels;
  }

  function getAllPieces() {
    return getPiecesRoots().reduce(function (pieces, root) {
      return pieces.concat(getPiecesFromRoot(root, false));
    }, []);
  }

  // ---- Busca por palavra-chave: leitura das pecas ----
  // pdfjsLib roda no MESMO isolated world deste content script - ao contrario do pdf.js que a
  // propria pagina do SGPe carrega, que fica inacessivel por causa da barreira de seguranca do
  // isolated world (essa barreira filtra propriedades customizadas como "pdfjsLib" em QUALQUER
  // referencia de janela lida pelo content script, mesmo de outro frame via window.frames[i] -
  // confirmado comparando leitura via console real (main world, achou o pdf.js) com leitura via
  // content script real (isolated world, nunca achou), com a mesma peca ja aberta e renderizada
  // na tela nos dois casos). Por isso a busca nao depende de nenhuma peca ja estar aberta no
  // visualizador do SGPe.
  //
  // vendor/pdf.min.js NAO vai mais no manifest.json (content_scripts) porque isso carregava a
  // biblioteca inteira em TODO frame do SGPe, mesmo sem o usuario abrir a busca (medido: quase
  // dobrava o heap JS da pagina so por isso). Em vez disso, e injetado sob demanda pelo
  // background.js (chrome.scripting.executeScript) so quando a busca e realmente usada, no
  // mesmo isolated world deste frame - por isso "pdfjsLib" fica visivel do mesmo jeito.
  var pdfjsLibReadyPromise = null;

  function ensurePdfJsLoaded() {
    if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
      return Promise.resolve();
    }
    if (pdfjsLibReadyPromise) return pdfjsLibReadyPromise;

    pdfjsLibReadyPromise = new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({ type: 'codex-sgpe-load-pdfjs' }, function (response) {
        if (chrome.runtime.lastError) {
          pdfjsLibReadyPromise = null;
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          pdfjsLibReadyPromise = null;
          reject(new Error((response && response.error) || 'Nao foi possivel carregar o leitor de PDF.'));
          return;
        }
        if (typeof pdfjsLib === 'undefined' || !pdfjsLib.GlobalWorkerOptions) {
          pdfjsLibReadyPromise = null;
          reject(new Error('pdf.js nao ficou disponivel apos a injecao.'));
          return;
        }
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.js');
        resolve();
      });
    });

    return pdfjsLibReadyPromise;
  }

  function fetchPieceFileId(piece, signal) {
    var rawParams = (piece.li && piece.li.getAttribute('data-p')) || '';
    var url = '/cpavPasta/services/pasta-digital/getArquivo' +
      '?pastaType=br.com.softplan.sider.cpav.pasta.pastas.PastaProcessos' +
      '&t=' + Date.now() +
      '&visaoType=br.com.softplan.sider.cpav.pasta.view.documento.VisaoDocumentos' +
      '&' + rawParams;

    return fetch(url, { credentials: 'include', signal: signal }).then(function (response) {
      if (!response.ok) throw new Error('Falha ao obter referencia do arquivo (HTTP ' + response.status + ').');
      return response.text();
    }).then(function (html) {
      var parsed = new DOMParser().parseFromString(html, 'text/html');
      var input = parsed.getElementById('fileID');
      if (!input || !input.value) throw new Error('Referencia de arquivo (fileID) nao encontrada na resposta.');
      return input.value;
    });
  }

  function fetchPieceArrayBuffer(piece, signal) {
    return fetchPieceFileId(piece, signal).then(function (fileId) {
      var url = '/cpavPasta/services/pasta-digital/arquivo?f=' + encodeURIComponent(fileId);
      return fetch(url, { credentials: 'include', signal: signal });
    }).then(function (response) {
      if (!response.ok) throw new Error('Falha ao baixar o PDF da peca (HTTP ' + response.status + ').');
      return response.arrayBuffer();
    });
  }

  function extractPieceText(piece, signal) {
    return fetchPieceArrayBuffer(piece, signal).then(function (buffer) {
      var loadingTask = pdfjsLib.getDocument({ data: buffer });
      return loadingTask.promise.then(function (doc) {
        var pages = [];
        var chain = Promise.resolve();
        for (var i = 1; i <= doc.numPages; i += 1) {
          (function (pageNumber) {
            chain = chain.then(function () {
              return doc.getPage(pageNumber).then(function (page) {
                return page.getTextContent();
              }).then(function (content) {
                var pageText = content.items.map(function (item) { return item.str; }).join(' ');
                pages.push(pageText);
              });
            });
          })(i);
        }

        return chain.then(function () {
          var totalChars = pages.reduce(function (sum, text) { return sum + clean(text).length; }, 0);
          var pageCount = doc.numPages;
          if (doc.destroy) doc.destroy();

          if (totalChars === 0) {
            return { status: 'scanned', pageCount: pageCount };
          }
          return { status: 'ok', pages: pages, pageCount: pageCount };
        }, function (error) {
          if (doc.destroy) doc.destroy();
          throw error;
        });
      });
    }).catch(function (error) {
      if (error && error.name === 'AbortError') throw error;
      var name = error && error.name;
      var message = (error && error.message) || String(error);
      if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) {
        return { status: 'not-pdf', message: message };
      }
      return { status: 'error', message: message };
    });
  }

  // pageCount vem dos intervalos reais do data-p quando disponivel; o fallback por peca so
  // entra quando a arvore nao expoe os intervalos (estimativa grosseira, baixa confianca).
  function estimateSearchDuration(pieceCount, pageCount) {
    var estimatedPages = pageCount > 0 ? pageCount : pieceCount * PDF_SEARCH_FALLBACK_PAGES_PER_PIECE;
    return {
      minSeconds: estimatedPages / PDF_SEARCH_RATE_MAX_PPS,
      maxSeconds: estimatedPages / PDF_SEARCH_RATE_MIN_PPS
    };
  }

  // ---- Busca por palavra-chave: orquestrador ----
  function runKeywordSearch(rawQuery) {
    var needle = normalizeSearchText(rawQuery);
    if (needle.length < KEYWORD_MIN_QUERY_LENGTH) {
      renderKeywordValidationMessage('Digite pelo menos ' + KEYWORD_MIN_QUERY_LENGTH + ' caracteres para buscar.');
      return;
    }
    if (keywordSearchStarting || (keywordSearchState && keywordSearchState.running)) return;

    // Por padrao a busca cobre so o processo principal - em processos com apensados, as pecas
    // juntadas costumam responder pela maior parte do custo (medido: 85% num caso real), o que
    // inviabilizava a busca. Os apensados entram so por opt-in explicito no checkbox. Com o
    // filtro manual de processo ativo, esse criterio principal/apensado deixa de fazer sentido
    // (o usuario ja escolheu explicitamente UM processo) - busca so as pecas dele, direto.
    var pieces;
    if (manualProcessFilterActive && manualProcessFilter) {
      pieces = applyExplicitProcessFilter(getPiecesFromRoot(findPiecesRoot(), false));
    } else {
      var split = splitPiecesByProcessOrigin(getPiecesFromRoot(findPiecesRoot(), false));
      pieces = (keywordIncludeJoinedEl && keywordIncludeJoinedEl.checked)
        ? split.main.concat(split.joined)
        : split.main;
    }

    if (!pieces.length) {
      renderKeywordValidationMessage('Nenhuma peca encontrada nesta pasta digital.');
      return;
    }

    keywordSearchStarting = true;
    renderKeywordValidationMessage('Carregando leitor de PDF…');
    ensurePdfJsLoaded().then(function () {
      keywordSearchStarting = false;
      startKeywordSearch(rawQuery, needle, pieces);
    }, function (error) {
      keywordSearchStarting = false;
      renderKeywordValidationMessage('Falha ao carregar o leitor de PDF: ' + ((error && error.message) || String(error)));
    });
  }

  function startKeywordSearch(rawQuery, needle, pieces) {
    var abortController = new AbortController();
    keywordSearchState = {
      running: true,
      cancelRequested: false,
      abortController: abortController,
      startedAt: Date.now(),
      piecesTotal: pieces.length,
      piecesDone: 0,
      pagesDone: 0,
      needle: needle,
      queryLabel: clean(rawQuery),
      matches: [],
      scanned: [],
      notPdf: [],
      errors: []
    };
    renderKeywordProgress();

    var chain = Promise.resolve();
    pieces.forEach(function (piece) {
      chain = chain.then(function () {
        if (!keywordSearchState || keywordSearchState.cancelRequested) return;

        return extractPieceText(piece, abortController.signal).then(function (result) {
          if (!keywordSearchState) return;

          if (result.status === 'ok') {
            result.pages.forEach(function (pageText, index) {
              if (normalizeSearchText(pageText).indexOf(needle) === -1) return;
              keywordSearchState.matches.push({
                piece: piece,
                page: piece.start + index
              });
            });
          } else if (result.status === 'scanned') {
            keywordSearchState.scanned.push(piece);
          } else if (result.status === 'not-pdf') {
            keywordSearchState.notPdf.push(piece);
          } else if (result.status === 'error') {
            keywordSearchState.errors.push({ piece: piece, message: result.message });
          }

          keywordSearchState.piecesDone += 1;
          keywordSearchState.pagesDone += result.pageCount || 0;
          renderKeywordProgress();
        }, function (error) {
          if (!keywordSearchState) return;
          if (error && error.name === 'AbortError') return;
          keywordSearchState.errors.push({ piece: piece, message: (error && error.message) || String(error) });
          keywordSearchState.piecesDone += 1;
          renderKeywordProgress();
        });
      });
    });

    chain.then(function () {
      if (!keywordSearchState) return;
      keywordSearchState.running = false;
      renderKeywordResults();
    });
  }

  function cancelKeywordSearch() {
    if (!keywordSearchState || !keywordSearchState.running) return;
    keywordSearchState.cancelRequested = true;
    keywordSearchState.running = false;
    if (keywordSearchState.abortController) keywordSearchState.abortController.abort();
    renderKeywordResults();
  }
  // ---- fim: logica da busca por palavra-chave ----

  function findPageElement(piece, page) {
    var internalPage = page - piece.start + 1;
    for (var i = 0; i < piece.pageItems.length; i += 1) {
      var item = piece.pageItems[i];
      if (Number(item.params.pagina) === internalPage) {
        return item.nameEl;
      }
    }
    return piece.nameEl;
  }

  function dispatchClick(target) {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function clearTreeHighlight() {
    var previous = document.querySelectorAll('.' + HIGHLIGHT_CLASS);
    Array.prototype.forEach.call(previous, function (el) {
      el.classList.remove(HIGHLIGHT_CLASS);
      el.style.outline = '';
      el.style.backgroundColor = '';
    });
  }

  function isTreeNodeCollapsed(li) {
    var nestedList = li && li.querySelector(':scope > ul.g-i');
    var toggler = li && li.querySelector(':scope > .tg');

    return !!(
      (nestedList && (nestedList.classList.contains('g-i-hidden') || nestedList.style.display === 'none')) ||
      (toggler && toggler.classList.contains('tg-e'))
    );
  }

  function expandTreeNode(li, remember) {
    var nestedList = li && li.querySelector(':scope > ul.g-i');
    var toggler = li && li.querySelector(':scope > .tg');
    var wasCollapsed = isTreeNodeCollapsed(li);

    if (remember && wasCollapsed && autoExpandedTreeNodes.indexOf(li) === -1) {
      autoExpandedTreeNodes.push(li);
    }

    if (nestedList) {
      nestedList.classList.remove('g-i-hidden');
      nestedList.style.display = '';
    }
    if (toggler && toggler.classList.contains('tg-e')) {
      dispatchClick(toggler);
    }
    if (toggler) {
      toggler.classList.remove('tg-e');
      toggler.classList.add('tg-c');
      toggler.setAttribute('aria-expanded', 'true');
      if (clean(toggler.textContent) === '+') toggler.textContent = '-';
    }
  }

  function collapseTreeNode(li) {
    var nestedList = li && li.querySelector(':scope > ul.g-i');
    var toggler = li && li.querySelector(':scope > .tg');

    if (nestedList) {
      nestedList.classList.add('g-i-hidden');
      nestedList.style.display = 'none';
    }
    if (toggler && toggler.classList.contains('tg-c')) {
      dispatchClick(toggler);
    }
    if (toggler) {
      toggler.classList.remove('tg-c');
      toggler.classList.add('tg-e');
      toggler.setAttribute('aria-expanded', 'false');
      if (clean(toggler.textContent) === '-') toggler.textContent = '+';
    }
  }

  function closePreviousAutoExpandedNodes(keepNodes) {
    var keep = keepNodes || [];

    suppressTreeClickSync = true;
    try {
      autoExpandedTreeNodes.slice().reverse().forEach(function (node) {
        if (!node || !document.documentElement.contains(node) || keep.indexOf(node) !== -1) return;
        collapseTreeNode(node);
      });
    } finally {
      suppressTreeClickSync = false;
    }

    autoExpandedTreeNodes = autoExpandedTreeNodes.filter(function (node) {
      return node && document.documentElement.contains(node) && keep.indexOf(node) !== -1;
    });
  }

  function highlightTreePosition(target) {
    if (!target) return;

    clearTreeHighlight();

    var li = target.closest('li.i');
    var ancestors = [];
    var current = li && li.parentElement && li.parentElement.closest('li.i');

    while (current) {
      ancestors.push(current);
      current = current.parentElement && current.parentElement.closest('li.i');
    }

    if (!manualTreeMode) {
      closePreviousAutoExpandedNodes(ancestors.concat(li ? [li] : []));
    }

    suppressTreeClickSync = true;
    try {
      ancestors.reverse().forEach(function (ancestor) {
        expandTreeNode(ancestor, true);
      });

      expandTreeNode(li, true);
    } finally {
      suppressTreeClickSync = false;
    }

    target.classList.add(HIGHLIGHT_CLASS);
    target.style.outline = '2px solid #d97706';
    target.style.backgroundColor = '#fff3c4';
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }

  // pieceMatchesProcessFilter/applyProcessFilter: usados por toda busca "geral" (numero de
  // pagina, nome de peca, palavra-chave) pra respeitar o filtro manual de processo quando
  // ativo. Comparacao por referencia de elemento (root/processLi), nao por rotulo - dois
  // processos podem ter o mesmo rotulo visivel em telas raras, mas nunca o mesmo elemento.
  function pieceMatchesProcessFilter(piece, filter) {
    if (!filter) return true;
    if (filter.main) return isMainProcessPiece(piece);
    return !isMainProcessPiece(piece) && (piece.process || 'Processo atual') === filter.label;
  }

  // "Situacao ativa no widget": trava manual se houver (inclusive a escolha explicita "Todos os
  // processos", que retorna null = sem filtro); senao o modo automatico, cujo padrao antes de
  // qualquer clique na arvore e o processo mae (ver comentario acima de manualProcessFilterActive).
  // Usado pela busca por numero de pagina/nome de peca e pelo menu de contexto - a busca por
  // palavra-chave usa applyExplicitProcessFilter() abaixo, que preserva sua propria heuristica
  // de custo (checkbox "incluir apensados") quando nao ha trava manual.
  function getEffectiveProcessFilter() {
    if (manualProcessFilterActive) return manualProcessFilter;
    return { label: lastViewedProcessLabel, main: lastViewedProcessMain };
  }

  function applyProcessFilter(pieces) {
    var filter = getEffectiveProcessFilter();
    if (!filter) return pieces;
    return pieces.filter(function (piece) {
      return pieceMatchesProcessFilter(piece, filter);
    });
  }

  // So filtra quando ha uma trava MANUAL explicita a um processo especifico (nunca no modo
  // automatico, nem na escolha explicita "Todos os processos") - preserva o comportamento
  // pre-existente da busca por palavra-chave (processo principal por padrao, apensados so via
  // checkbox) quando o usuario nao mexeu no seletor de processo.
  function applyExplicitProcessFilter(pieces) {
    if (!manualProcessFilterActive || !manualProcessFilter) return pieces;
    return pieces.filter(function (piece) {
      return pieceMatchesProcessFilter(piece, manualProcessFilter);
    });
  }

  // A numeracao REAL (data-p do proprio SGPe - o numero impresso/fisico da pagina, o que o
  // usuario de fato digita) e a prioridade sempre que so 1 peca a cobrir: e o caso comum, e o
  // unico que resolvePiecePage() tambem prioriza (ve o comentario logo abaixo). Processos com
  // lacunas de paginacao real (ex.: faltam as paginas 2-3-4 no meio do processo) fazem a
  // numeracao local (sequencial, sem lacunas, calculada por esta extensao) DIVERGIR da real a
  // partir da lacuna - usar local como prioridade geral abria peca errada pra qualquer pagina
  // real depois da lacuna, so porque o numero digitado batia por coincidencia com a posicao
  // local de OUTRA peca.
  //
  // A numeracao local so entra pra desempatar quando MAIS DE UMA peca tem o MESMO numero real
  // (o SGPe pode reiniciar a numeracao real por peca - ex.: duas pecas de 1 pagina podem ambas
  // ter data-p "1-1" mesmo uma delas nao sendo a primeira do processo): dentre as pecas
  // empatadas por numero real, a que TAMBEM bate pela posicao local (sem sobreposicao dentro
  // do processo/apensado) e a peca certa. Se a numeracao local nao desempatar sozinha, sobra o
  // empate real mesmo (o picker de escolha ja existente cobre esse caso).
  function findPageMatches(page) {
    var candidates = applyProcessFilter(getAllPieces());
    var realMatches = candidates.filter(function (candidate) {
      return page >= candidate.start && page <= candidate.end;
    });

    if (realMatches.length === 1) return realMatches;

    if (realMatches.length > 1) {
      var disambiguated = realMatches.filter(function (candidate) {
        return page >= candidate.localStart && page <= candidate.localEnd;
      });
      return disambiguated.length === 1 ? disambiguated : realMatches;
    }

    // Nenhuma peca cobre a pagina pela numeracao real (dados incomuns/malformados) - cai para
    // a numeracao local como rede de seguranca.
    return candidates.filter(function (candidate) {
      return page >= candidate.localStart && page <= candidate.localEnd;
    });
  }

  function resolvePiecePage(piece, page) {
    if (page >= piece.start && page <= piece.end) return page;
    if (page >= piece.localStart && page <= piece.localEnd) {
      return piece.start + page - piece.localStart;
    }
    return page;
  }

  function findPieceNameMatches(query) {
    var needle = normalizeSearchText(query);
    if (needle.length < 2) return [];

    return applyProcessFilter(getAllPieces()).filter(function (piece) {
      return normalizeSearchText(piece.name).indexOf(needle) !== -1 ||
        normalizeSearchText(piece.process).indexOf(needle) !== -1;
    }).slice(0, 30);
  }

  function openPageInPiece(page, piece) {
    if (!piece) {
      throw new Error('Pagina nao encontrada na lista de pecas carregada.');
    }
    if (!piece.root || !document.documentElement.contains(piece.root)) {
      throw new Error('A arvore de pecas mudou. Atualize a Pasta Digital (Aba Pecas) e tente novamente.');
    }
    if (!piece.li || !piece.root.contains(piece.li)) {
      throw new Error('A peca encontrada nao esta mais disponivel na arvore carregada.');
    }

    var currentRange = parsePieceRange(piece.li);
    if (!currentRange.valid || currentRange.start !== piece.start || currentRange.end !== piece.end) {
      throw new Error('Os intervalos da peca mudaram desde a indexacao. Tente novamente.');
    }

    var resolvedPage = resolvePiecePage(piece, page);
    if (resolvedPage < piece.start || resolvedPage > piece.end) {
      throw new Error('Pagina fora do intervalo atual da peca selecionada.');
    }

    selectedPiecesRoot = piece.root || selectedPiecesRoot;
    selectedProcessLi = piece.processLi || null;

    var target = findPageElement(piece, resolvedPage);
    if (!target || !piece.li.contains(target)) {
      throw new Error('Peca encontrada, mas o elemento clicavel nao foi localizado com seguranca.');
    }

    suppressTreeClickSync = true;
    try {
      dispatchClick(target);
    } finally {
      suppressTreeClickSync = false;
    }
    if (!document.documentElement.contains(target)) {
      throw new Error('O clique foi enviado, mas a arvore foi atualizada antes da confirmacao visual.');
    }
    highlightTreePosition(target);
    return piece;
  }
  function openPage(page) {
    var pieces = getPieces();
    var piece = pieces.find(function (candidate) {
      return page >= candidate.start && page <= candidate.end;
    });

    return openPageInPiece(page, piece);
  }

  function describePageMatch(piece) {
    var localRange = piece.localStart === piece.start && piece.localEnd === piece.end
      ? ''
      : ', local ' + piece.localStart + '-' + piece.localEnd;

    return (piece.process || 'Processo atual') + ' - ' + piece.name +
      ' (' + piece.start + '-' + piece.end + localRange + ')';
  }

  function setFieldValue(field, value) {
    if (!field) return;
    field.value = value || '';
    field.title = value || '';
  }

  function setText(el, value) {
    if (!el) return;
    el.textContent = value || '';
    el.title = value || '';
  }

  // ---- Controle "No do Processo": exibicao do processo em vista + filtro manual ----
  // Nao e mais um <select> nativo - um <option> nao suporta duas linhas com tamanhos de fonte
  // diferentes (nome do processo + contagem de paginas menor embaixo), entao o campo virou um
  // controle proprio (processInputEl = botao/exibicao, processMenuEl = lista suspensa custom).
  //
  // setViewedProcess() registra qual processo esta "em vista" (ultimo clicado/aberto), so pra
  // exibicao no modo automatico - nao mexe na trava manual. Ver o comentario acima da declaracao
  // de manualProcessFilterActive pra o modelo completo (trava manual vs. modo automatico,
  // padrao = processo mae).
  function setViewedProcess(label, isMain) {
    lastViewedProcessLabel = label || '';
    lastViewedProcessMain = !!isMain;
    if (!manualProcessFilterActive) updateProcessDisplay();
  }

  function findProcessOptionIndex(label, main) {
    return processSelectOptions.findIndex(function (opt) {
      return main ? opt.main : (!opt.main && opt.label === label);
    });
  }

  // Texto mostrado no botao do controle - reflete a trava manual se houver (inclusive "Todos os
  // processos"), senao o processo em vista no modo automatico.
  function updateProcessDisplay() {
    if (!processInputEl || !processDisplayEl) return;

    var filter = getEffectiveProcessFilter();
    if (!filter) {
      processDisplayEl.textContent = 'Todos os processos';
      processInputEl.title = 'Todos os processos';
    } else {
      var idx = findProcessOptionIndex(filter.label, filter.main);
      var opt = idx === -1 ? null : processSelectOptions[idx];
      var label = opt ? opt.label : (filter.label || 'Processo atual');
      processDisplayEl.textContent = label + (filter.main ? ' (mãe)' : ' (apensado)');
      processInputEl.title = label;
    }

    if (processMenuEl) renderProcessMenu();
  }

  function updateProcessFieldStyle() {
    if (!processInputEl) return;
    // Sempre cinza claro (independente do estado) pra diferenciar este campo dos demais campos
    // de busca (editaveis, fundo branco/#fafafa) - ele e um seletor/filtro, nao um texto livre.
    processInputEl.style.background = '#e5e7eb';
    processInputEl.style.borderColor = '#6b7280';
  }

  function openProcessMenu() {
    if (!processMenuEl || !processInputEl) return;
    renderProcessMenu();
    var rect = processInputEl.getBoundingClientRect();
    processMenuEl.style.left = rect.left + 'px';
    processMenuEl.style.width = rect.width + 'px';
    processMenuEl.style.top = (rect.bottom + 2) + 'px';
    processMenuEl.style.display = '';
    processDropdownOpen = true;
  }

  function closeProcessMenu() {
    if (!processMenuEl) return;
    processMenuEl.style.display = 'none';
    processDropdownOpen = false;
  }

  function selectProcessOption(idx) {
    var option = idx >= 0 ? processSelectOptions[idx] : null;

    closeProcessMenu();
    clearPageChoices();

    manualProcessFilterActive = true;
    if (!option) {
      // "Todos os processos": escolha manual explicita e persistente (diferente do modo
      // automatico, que tem o processo mae como padrao) - fica sem filtro ate o usuario trocar.
      manualProcessFilter = null;
      updateProcessDisplay();
      setText(statusEl, 'Buscas em todos os processos da árvore.');
      return;
    }

    manualProcessFilter = { label: option.label, main: option.main };
    updateProcessDisplay();
    setText(statusEl, 'Buscas restritas ao processo ' + option.label +
      (option.main ? ' (mãe).' : '.'));
  }

  // Renderiza a lista suspensa custom: "Todos os processos" + uma linha por processo, cada uma
  // com o numero do processo e, embaixo, em fonte reduzida, a contagem de paginas dele.
  function renderProcessMenu() {
    if (!processMenuEl) return;
    processMenuEl.innerHTML = '';

    var filter = getEffectiveProcessFilter();
    var activeIdx = filter ? findProcessOptionIndex(filter.label, filter.main) : -1;

    function makeRow(isActive) {
      return makeEl('div', {
        style: {
          padding: '5px 6px',
          cursor: 'pointer',
          borderBottom: '1px solid #eee',
          background: isActive ? '#e5e7eb' : '#fff'
        }
      });
    }

    var allRow = makeRow(!filter);
    allRow.appendChild(makeEl('div', { style: { fontSize: '12px' } }, 'Todos os processos'));
    allRow.addEventListener('click', function (event) {
      event.stopPropagation();
      selectProcessOption(-1);
    });
    processMenuEl.appendChild(allRow);

    processSelectOptions.forEach(function (opt, idx) {
      var row = makeRow(idx === activeIdx);
      row.appendChild(makeEl('div', { style: { fontSize: '12px' } },
        opt.label + (opt.main ? ' (mãe)' : ' (apensado)')));
      row.appendChild(makeEl('div', { style: { fontSize: '10px', color: '#666', marginTop: '1px' } },
        opt.pages + ' páginas'));
      row.addEventListener('click', function (event) {
        event.stopPropagation();
        selectProcessOption(idx);
      });
      processMenuEl.appendChild(row);
    });
  }

  // Reconstroi as opcoes do controle a partir da arvore atual (processo principal/mae de cada
  // "visao" + cada apensado/juntado com pecas, cada um com a soma de paginas das suas pecas).
  // Roda com frequencia (junto de updateStatus, ver chamadas abaixo) porque a arvore muda com a
  // navegacao do usuario.
  //
  // Identidade por rotulo (numero do processo) + flag "main", nao por referencia de elemento
  // DOM - a arvore do SGPe recria nos periodicamente (a mesma MutationObserver que essa
  // extensao ja observa prova isso), entao guardar uma referencia de elemento fazia o filtro
  // manual "cair" sozinho pouco depois de escolhido, mesmo com o processo continuando visivel
  // na tela. Numero do processo e estavel entre essas recriacoes.
  function refreshProcessSelect() {
    if (!processInputEl) return;

    var options = [];
    var mainOption = null;
    var joinedByLabel = {};

    getAllPieces().forEach(function (piece) {
      var pages = Math.max(1, piece.end - piece.start + 1);
      if (isMainProcessPiece(piece)) {
        if (!mainOption) {
          mainOption = { label: piece.process || 'Processo atual', main: true, pages: 0 };
          options.push(mainOption);
        }
        mainOption.pages += pages;
        return;
      }
      var label = piece.process || 'Processo atual';
      var opt = joinedByLabel[label];
      if (!opt) {
        opt = { label: label, main: false, pages: 0 };
        joinedByLabel[label] = opt;
        options.push(opt);
      }
      opt.pages += pages;
    });

    processSelectOptions = options;

    if (manualProcessFilterActive && manualProcessFilter) {
      var idx = findProcessOptionIndex(manualProcessFilter.label, manualProcessFilter.main);

      if (idx === -1) {
        // O processo escolhido nao esta mais na arvore (mudou de tela/processo) - volta pro
        // modo automatico (padrao: processo mae).
        manualProcessFilterActive = false;
        manualProcessFilter = null;
      } else {
        manualProcessFilter.label = options[idx].label;
      }
    }

    updateProcessDisplay();
    updateProcessFieldStyle();
  }
  // ---- fim: controle "No do Processo" ----

  function finishOpenPage(page, piece) {
    clearPageChoices();
    piece = openPageInPiece(page, piece);
    setFieldValue(inputEl, String(page));
    setFieldValue(pieceInputEl, piece.name);
    setViewedProcess(piece.process || '', isMainProcessPiece(piece));
    setText(statusEl, 'Aberta: ' + pageLabel(page) + ' - ' + piece.name +
      ' (' + piece.start + '-' + piece.end + ')');
    return piece;
  }

  function getTreeSelection(target) {
    if (!target || !target.closest) return null;

    var root = target.closest('#visoes-0-itens, [id^="visoes-"][id$="-itens"]') || findPiecesRoot();
    var nameEl = target.closest('.i-nm');
    var li = nameEl ? nameEl.closest('li.i') : target.closest('li.i');
    if (!root || !li || !root.contains(li)) return null;

    selectedPiecesRoot = root;

    var parentLi = li.parentElement && li.parentElement.closest('li.i');
    var pieceLi = isPieceLi(li) ? li : null;

    if (!pieceLi && parentLi && root.contains(parentLi) && isPieceLi(parentLi)) {
      pieceLi = parentLi;
    }

    if (!pieceLi) {
      if (!isPieceLi(li)) selectedProcessLi = li;
      return null;
    }

    var processLi = getProcessLi(pieceLi, root);
    selectedProcessLi = processLi;
    var pieceRange = parsePieceRange(pieceLi);
    var start = pieceRange.start;
    var end = pieceRange.end;
    var pieceNameEl = pieceLi.querySelector(':scope > .i-nm.linkPecas, :scope > .i-nm');
    var pieceName = getDirectName(pieceNameEl);
    var page = start;

    if (!pieceName || !Number.isFinite(start) || !Number.isFinite(end)) return null;

    if (pieceLi !== li) {
      var pageParams = parseParams(li.getAttribute('data-p'));
      var internalPage = Number(pageParams.pagina);
      if (Number.isFinite(internalPage)) page = start + internalPage - 1;
    }

    return {
      name: pieceName,
      process: getProcessLabel(root, processLi),
      processLi: processLi,
      page: page,
      start: start,
      end: end
    };
  }

  function updateSearchFields(selection) {
    if (!selection) return;
    if (inputEl && Number.isFinite(selection.page)) setFieldValue(inputEl, String(selection.page));
    setFieldValue(pieceInputEl, selection.name);
    setViewedProcess(selection.process || '', !selection.processLi);
  }

  function clearPageChoices() {
    pendingChoiceMode = '';
    pendingChoicePage = null;
    pendingChoiceQuery = '';
    pendingChoiceMatches = [];
    if (!choiceEl) return;
    choiceEl.innerHTML = '';
    choiceEl.style.display = 'none';
    choiceEl.title = '';
    choiceEl.style.background = '#fff';
    choiceEl.style.borderColor = '#999';
  }

  function clearWidgetState() {
    window.clearTimeout(pieceSearchTimer);
    clearPageChoices();
    // closePreviousAutoExpandedNodes() (nao closeAllOpenTreeNodes()) - so fecha os nos que a
    // PROPRIA extensao abriu automaticamente numa busca, nunca os que o usuario abriu na mao
    // navegando a arvore. closeAllOpenTreeNodes() percorria TODOS os li.i da arvore inteira
    // (podem ser milhares num processo grande - ver nota de performance no README) e disparava
    // um clique sintetico real no toggler do SGPe pra cada um que estivesse aberto, tudo num
    // loop sincrono sem pausa - isso dessincronizava o estado interno do proprio widget de
    // arvore do SGPe (o +/- do toggler virava sozinho, mas o conteudo aninhado parava de abrir
    // em cliques reais seguintes, exigindo recarregar a pagina).
    closePreviousAutoExpandedNodes();
    clearTreeHighlight();
    selectedProcessLi = null;
    manualTreeMode = false;
    manualProcessFilterActive = false;
    manualProcessFilter = null;
    lastViewedProcessLabel = '';
    lastViewedProcessMain = true;
    setFieldValue(inputEl, '');
    setFieldValue(pieceInputEl, '');
    refreshProcessSelect();
    updateStatus();
  }

  function showChoices(mode, page, query, matches, placeholderText) {
    if (!choiceEl) return;
    pendingChoiceMode = mode;
    pendingChoicePage = page;
    pendingChoiceQuery = query || '';
    pendingChoiceMatches = matches.slice();
    choiceEl.innerHTML = '';

    var placeholder = makeEl('option', { value: '' }, placeholderText);
    choiceEl.appendChild(placeholder);

    matches.forEach(function (piece, index) {
      var description = describePageMatch(piece);
      choiceEl.appendChild(makeEl('option', { value: String(index), title: description }, description));
    });

    choiceEl.style.display = '';
    choiceEl.title = placeholderText;
    choiceEl.style.background = mode === 'page' || mode === 'piece' ? '#e5e7eb' : '#fff';
    choiceEl.style.borderColor = mode === 'page' || mode === 'piece' ? '#6b7280' : '#999';
  }

  function showPageChoices(page, matches) {
    showChoices('page', page, '', matches, 'Escolha o processo/pe\u00e7a...');
  }

  function showPieceChoices(query, matches) {
    showChoices('piece', null, query, matches, 'Escolha a pe\u00e7a...');
  }

  // ---- Busca por palavra-chave: renderizacao ----
  function renderKeywordValidationMessage(message) {
    if (!keywordSummaryEl) return;
    keywordSummaryEl.textContent = message;
    keywordSummaryEl.style.color = '#7c2d12';
    if (keywordResultsEl) keywordResultsEl.innerHTML = '';
    if (keywordProgressEl) keywordProgressEl.textContent = '';
    if (keywordProgressBarEl) keywordProgressBarEl.style.width = '0%';
  }

  function formatEstimateRange(estimate) {
    return '~' + Math.round(estimate.minSeconds) + 's\u2013' + Math.round(estimate.maxSeconds) + 's';
  }

  function renderKeywordEstimate() {
    if (!keywordEstimateEl) return;
    var pieces = applyExplicitProcessFilter(getPiecesFromRoot(findPiecesRoot(), false));
    if (!pieces.length) {
      keywordEstimateEl.textContent = manualProcessFilterActive
        ? 'Nenhuma pe\u00e7a encontrada no processo selecionado.'
        : 'Nenhuma pe\u00e7a encontrada nesta pasta digital.';
      if (keywordIncludeJoinedRow) keywordIncludeJoinedRow.style.display = 'none';
      return;
    }

    // Filtro manual de processo ativo: o usuario ja escolheu explicitamente UM processo, entao
    // a distincao principal/apensado (e o checkbox que a controla) deixa de fazer sentido -
    // mostra so a estimativa das pecas desse processo.
    if (manualProcessFilterActive) {
      if (keywordIncludeJoinedRow) keywordIncludeJoinedRow.style.display = 'none';
      var filteredPages = countPages(pieces);
      var filteredEstimate = estimateSearchDuration(pieces.length, filteredPages);
      keywordEstimateEl.textContent =
        '\u2248 ' + pieces.length + ' pe\u00e7as (' + filteredPages + ' p\u00e1ginas) no processo ' +
        (manualProcessFilter && manualProcessFilter.label) + '. Tempo estimado: ' +
        formatEstimateRange(filteredEstimate) + '. Tempo real \u00e9 ajustado durante a busca.';
      return;
    }

    var split = splitPiecesByProcessOrigin(pieces);
    var mainPages = countPages(split.main);
    var mainEstimate = estimateSearchDuration(split.main.length, mainPages);

    // Sem processos apensados a secao fica igual a de antes: uma linha so, sem checkbox.
    if (!split.joined.length) {
      if (keywordIncludeJoinedRow) keywordIncludeJoinedRow.style.display = 'none';
      keywordEstimateEl.textContent =
        '\u2248 ' + split.main.length + ' pe\u00e7as (' + mainPages + ' p\u00e1ginas) nesta pasta. Tempo estimado: ' +
        formatEstimateRange(mainEstimate) + ' (baseado em ' + PDF_SEARCH_RATE_MIN_PPS + '\u2013' +
        PDF_SEARCH_RATE_MAX_PPS + ' p\u00e1ginas/seg medidas). Tempo real \u00e9 ajustado durante a busca.';
      return;
    }

    var joinedPages = countPages(split.joined);
    var joinedEstimate = estimateSearchDuration(split.joined.length, joinedPages);

    if (keywordIncludeJoinedRow) keywordIncludeJoinedRow.style.display = '';

    // Enquanto o usuario nao mexer no checkbox, o padrao acompanha o custo dos apensados:
    // inclui quando sao baratos (nao vale perder resultados por poucos segundos) e deixa de
    // fora quando pesam a ponto de inviabilizar a busca. Depois de um toque manual, a escolha
    // do usuario manda - inclusive se ele voltar a expandir a secao.
    if (keywordIncludeJoinedEl && !keywordIncludeJoinedTouched) {
      keywordIncludeJoinedEl.checked = joinedEstimate.maxSeconds <= KEYWORD_JOINED_AUTO_INCLUDE_MAX_SECONDS;
    }
    var includeJoined = !!(keywordIncludeJoinedEl && keywordIncludeJoinedEl.checked);

    keywordEstimateEl.textContent =
      'Processo principal: ' + split.main.length + ' pe\u00e7as (' + mainPages + ' p\u00e1ginas), ' +
      formatEstimateRange(mainEstimate) + '. Apensados (' + listJoinedProcessLabels(split.joined).join(', ') +
      '): +' + split.joined.length + ' pe\u00e7as (+' + joinedPages + ' p\u00e1ginas), +' +
      formatEstimateRange(joinedEstimate) + '. ' +
      (includeJoined
        ? 'Buscando nos dois.'
        : 'Buscando s\u00f3 no principal \u2014 marque a op\u00e7\u00e3o abaixo para incluir os apensados.') +
      ' Tempo real \u00e9 ajustado durante a busca.';
  }

  function renderKeywordProgress() {
    if (!keywordSearchState) return;
    if (keywordSearchBtn) keywordSearchBtn.style.display = keywordSearchState.running ? 'none' : '';
    if (keywordCancelBtn) keywordCancelBtn.style.display = keywordSearchState.running ? '' : 'none';
    if (!keywordProgressEl) return;

    var elapsedSeconds = (Date.now() - keywordSearchState.startedAt) / 1000;
    var rate = keywordSearchState.pagesDone > 0 && elapsedSeconds > 0
      ? keywordSearchState.pagesDone / elapsedSeconds
      : PDF_SEARCH_RATE_MIN_PPS;
    var piecesRestantes = keywordSearchState.piecesTotal - keywordSearchState.piecesDone;
    var paginasPorPecaMedia = keywordSearchState.piecesDone > 0
      ? keywordSearchState.pagesDone / keywordSearchState.piecesDone
      : PDF_SEARCH_FALLBACK_PAGES_PER_PIECE;
    var secondsRestantes = Math.max(0, Math.round((piecesRestantes * paginasPorPecaMedia) / rate));

    keywordProgressEl.textContent = 'Verificando pe\u00e7a ' + keywordSearchState.piecesDone + '/' +
      keywordSearchState.piecesTotal + '\u2026 (' + keywordSearchState.pagesDone +
      ' p\u00e1ginas lidas' + (keywordSearchState.running ? ', ~' + secondsRestantes + 's restantes)' : ')');

    if (keywordProgressBarEl) {
      var pct = keywordSearchState.piecesTotal > 0
        ? Math.round((keywordSearchState.piecesDone / keywordSearchState.piecesTotal) * 100)
        : 0;
      keywordProgressBarEl.style.width = pct + '%';
    }
  }

  // ---- Busca por palavra-chave: grifar no visualizador nativo do SGPe ----
  // O SGPe ja tem uma barra de busca propria no visualizador de cada peca (#findInput, igual
  // a de qualquer leitor de PDF), com grifado de todas as ocorrencias ja pronto. Em vez de
  // reimplementar grifado, a extensao abre a peca na pagina da primeira ocorrencia e aciona
  // essa busca nativa. Isso e manipulacao de DOM (valor de input, eventos, classes) - ao
  // contrario de ler "pdfjsLib" da pagina, isso NAO esbarra na barreira do isolated world.
  var FIND_READY_TIMEOUT_MS = 10000;
  var FIND_READY_POLL_MS = 250;

  // excludeDoc: quando abrimos uma peca nova, o visualizador da peca ANTERIOR costuma ainda
  // estar no DOM por um instante (a navegacao do iframe e assincrona) - sem excluir esse
  // documento antigo, o primeiro poll acha ele imediatamente (ja tem findInput + textLayer de
  // antes) e grifa no lugar errado, num documento que ja vai ser substituido. So aceitar um
  // documento DIFERENTE do anterior garante esperar a peca nova de verdade carregar.
  function findNativeFindBarDocument(win, depth, excludeDoc) {
    if (!win || depth > 8) return null;
    try {
      var doc = win.document;
      if (doc && doc !== excludeDoc && doc.getElementById('findInput') && doc.querySelector('.textLayer span')) {
        return doc;
      }
    } catch (error) {}

    var frames;
    try { frames = win.frames; } catch (error) { return null; }
    for (var i = 0; i < frames.length; i += 1) {
      var found = findNativeFindBarDocument(frames[i], depth + 1, excludeDoc);
      if (found) return found;
    }
    return null;
  }

  function waitForNativeFindBar(timeoutMs, excludeDoc) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + timeoutMs;
      (function poll() {
        var doc = findNativeFindBarDocument(window, 0, excludeDoc);
        if (doc) { resolve(doc); return; }
        if (Date.now() >= deadline) { resolve(null); return; }
        window.setTimeout(poll, FIND_READY_POLL_MS);
      })();
    });
  }

  function triggerNativeFind(doc, term) {
    var findbar = doc.getElementById('findbar');
    if (findbar) findbar.classList.remove('hidden');

    var highlightAll = doc.getElementById('findHighlightAll');
    if (highlightAll && !highlightAll.checked) {
      highlightAll.checked = true;
      highlightAll.dispatchEvent(new Event('change', { bubbles: true }));
    }

    var input = doc.getElementById('findInput');
    if (!input) return false;
    input.focus();
    // Limpa antes de preencher: o controlador de busca do pdf.js so reage quando o valor do
    // campo muda. Se o mesmo visualizador/documento for reaproveitado entre pecas (ou o
    // usuario clicar em outro resultado com o mesmo termo), definir o valor direto pro termo
    // final pode "nao parecer" uma mudanca pro campo e nao disparar um novo destaque -
    // limpar primeiro garante que o evento seguinte seja sempre tratado como busca nova.
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = term;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function openPieceAndHighlight(piece, page, term) {
    // Snapshot do documento do visualizador ANTES de navegar, pra poder ignora-lo na espera
    // (ver comentario em findNativeFindBarDocument) - se nao houver peca aberta ainda, e null
    // e o primeiro documento encontrado ja e aceito normalmente.
    var previousDoc = findNativeFindBarDocument(window, 0, null);

    try {
      finishOpenPage(page, piece);
    } catch (error) {
      console.log('[SGPe busca] falha ao abrir a peca para grifar:', error);
      if (statusEl) setText(statusEl, error.message);
      return;
    }

    waitForNativeFindBar(FIND_READY_TIMEOUT_MS, previousDoc).then(function (doc) {
      if (!doc) {
        console.log('[SGPe busca] nao foi possivel localizar a barra de busca nativa a tempo de grifar automaticamente.');
        return;
      }
      console.log('[SGPe busca] grifando termo no documento encontrado:', doc.location && doc.location.pathname);
      triggerNativeFind(doc, term);
    });
  }
  // ---- fim: grifar no visualizador nativo ----

  function renderKeywordPieceRow(group, term) {
    var firstPage = group.pages.reduce(function (min, page) { return Math.min(min, page); }, group.pages[0]);
    var row = makeEl('div', {
      style: {
        padding: '4px 5px',
        marginBottom: '3px',
        border: '1px solid #ddd',
        borderRadius: '3px',
        background: '#fafafa',
        cursor: 'pointer'
      },
      title: 'Abrir e grifar em ' + group.piece.name
    });

    row.appendChild(makeEl('div', {
      style: { fontWeight: '700', color: '#111' }
    }, group.piece.name + ' (' + group.pages.length + ' ocorr\u00eancia' + (group.pages.length === 1 ? '' : 's') + ')'));

    row.addEventListener('click', function () {
      openPieceAndHighlight(group.piece, firstPage, term);
    });

    return row;
  }

  function pageRangeLabel(piece) {
    var pad = function (n) { return String(n).padStart(4, '0'); };
    return 'p. ' + pad(piece.start) + '\u2013' + pad(piece.end);
  }

  // Lista colapsavel (toggle +/-, comeca fechada) com rolagem propria, pra nao deixar o
  // usuario perdido quando ha muitas pecas digitalizadas/ignoradas/com erro. Cada item mostra
  // o intervalo de paginas da peca ao lado do nome.
  function renderKeywordIssueList(title, items, colorText) {
    if (!items.length) return null;
    var wrapper = makeEl('div', { style: { marginTop: '6px', fontSize: '11px', color: colorText || '#555' } });

    var headerRow = makeEl('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer'
      },
      title: 'Expandir/recolher lista'
    });
    headerRow.appendChild(makeEl('div', { style: { fontWeight: '700' } }, items.length + ' ' + title));
    var toggleBtn = makeEl('button', {
      type: 'button',
      style: {
        padding: '1px 6px',
        border: '1px solid #aaa',
        borderRadius: '3px',
        background: '#f7f7f7',
        cursor: 'pointer',
        fontSize: '11px',
        color: '#333'
      }
    }, '+');
    headerRow.appendChild(toggleBtn);
    wrapper.appendChild(headerRow);

    var list = makeEl('div', {
      style: {
        marginTop: '3px',
        padding: '4px 6px',
        border: '1px solid #e5e5e5',
        borderRadius: '3px',
        maxHeight: '110px',
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'none'
      }
    });
    items.forEach(function (item) {
      var piece = item.piece || item;
      var label = piece.name + ' (' + pageRangeLabel(piece) + ')' + (item.message ? ' \u2014 ' + item.message : '');
      list.appendChild(makeEl('div', { style: { marginBottom: '2px', wordBreak: 'break-word' } }, label));
    });
    wrapper.appendChild(list);

    headerRow.addEventListener('click', function () {
      var expandido = list.style.display !== 'none';
      list.style.display = expandido ? 'none' : '';
      toggleBtn.textContent = expandido ? '+' : '-';
    });

    return wrapper;
  }

  function renderKeywordResults() {
    if (!keywordResultsEl || !keywordSummaryEl || !keywordSearchState) return;
    keywordResultsEl.innerHTML = '';
    keywordSummaryEl.innerHTML = '';
    keywordSummaryEl.style.color = '#333';

    var state = keywordSearchState;
    renderKeywordProgress();

    if (state.cancelRequested) {
      keywordResultsEl.appendChild(makeEl('div', { style: { color: '#7c2d12', marginBottom: '4px' } }, 'Busca cancelada.'));
    }

    var byPiece = [];
    state.matches.forEach(function (match) {
      var group = byPiece.filter(function (g) { return g.piece === match.piece; })[0];
      if (!group) {
        group = { piece: match.piece, pages: [] };
        byPiece.push(group);
      }
      group.pages.push(match.page);
    });

    if (byPiece.length) {
      // sticky: fica fixo no topo da area de rolagem enquanto o usuario navega pelos
      // resultados, pra sempre saber quantas ocorrencias no total sem precisar rolar de volta.
      keywordResultsEl.appendChild(makeEl('div', {
        style: {
          position: 'sticky',
          top: '0',
          background: '#fff',
          paddingBottom: '4px',
          fontWeight: '700',
          color: '#111'
        }
      }, state.matches.length + ' ocorr\u00eancia' + (state.matches.length === 1 ? '' : 's') +
        ' de \u201c' + state.queryLabel + '\u201d em ' + byPiece.length +
        ' pe\u00e7a' + (byPiece.length === 1 ? '' : 's') + ':'));

      byPiece.forEach(function (group) {
        keywordResultsEl.appendChild(renderKeywordPieceRow(group, state.queryLabel));
      });
    } else if (!state.cancelRequested) {
      keywordResultsEl.appendChild(makeEl('div', { style: { color: '#333' } },
        'Nenhuma ocorr\u00eancia encontrada nas ' + state.pagesDone + ' p\u00e1ginas verificadas.'));
    }

    var scannedList = renderKeywordIssueList('pe\u00e7as digitalizadas, n\u00e3o pesquisadas', state.scanned, '#555');
    if (scannedList) keywordSummaryEl.appendChild(scannedList);

    var notPdfList = renderKeywordIssueList('pe\u00e7as ignoradas (n\u00e3o s\u00e3o PDF)', state.notPdf, '#555');
    if (notPdfList) keywordSummaryEl.appendChild(notPdfList);

    var errorList = renderKeywordIssueList('pe\u00e7as com erro ao verificar', state.errors, '#7c2d12');
    if (errorList) keywordSummaryEl.appendChild(errorList);
  }
  // ---- fim: renderizacao da busca por palavra-chave ----

  function openSelectedChoice() {
    var index = choiceEl && choiceEl.value === '' ? NaN : Number(choiceEl && choiceEl.value);
    var piece = Number.isInteger(index) ? pendingChoiceMatches[index] : null;
    var page = pendingChoiceMode === 'page' ? pendingChoicePage : piece && piece.start;

    if (!piece || !Number.isInteger(page)) return false;

    finishOpenPage(page, piece);
    return true;
  }

  // Extraida do handler de submit do formulario "Buscar pelo nº da Página" pra ser reaproveitada
  // pelo gatilho do menu de contexto "Buscar no processo" (ver handleSearchInProcessRequest) -
  // mesma logica de abrir direto quando ha 1 so resultado, ou pedir escolha quando ha varios.
  function attemptOpenPage(page) {
    try {
      if (!Number.isInteger(page) || page < 1) {
        throw new Error('Informe um número de página válido.');
      }

      var matches = findPageMatches(page);
      var selectedValue = choiceEl && choiceEl.style.display !== 'none' ? choiceEl.value : '';
      var selectedIndex = selectedValue === '' ? NaN : Number(selectedValue);
      var piece = null;

      if (!matches.length) {
        throw new Error(getEffectiveProcessFilter()
          ? 'Página não encontrada no processo selecionado.'
          : 'Página não encontrada na lista de peças carregada.');
      }

      if (matches.length > 1 && pendingChoicePage !== page) {
        showPageChoices(page, matches);
        setText(statusEl, 'Página encontrada em ' + matches.length +
          ' processos/peças. Clique em uma opção para abrir.');
        return;
      }

      if (matches.length > 1) {
        if (!Number.isInteger(selectedIndex) || !matches[selectedIndex]) {
          showPageChoices(page, matches);
          setText(statusEl, 'Clique no processo/peça para abrir esta página.');
          return;
        }
        piece = matches[selectedIndex];
      } else {
        piece = matches[0];
      }

      finishOpenPage(page, piece);
    } catch (error) {
      setText(statusEl, error.message);
    }
  }

  function handleTreeClick(event) {
    if (readUserClosed()) return;
    if (suppressTreeClickSync) return;

    var selection = getTreeSelection(event.target);
    if (!selection) return;

    clearPageChoices();
    clearTreeHighlight();
    updateSearchFields(selection);
    if (statusEl) {
      setText(statusEl, 'Selecionada: ' + pageLabel(selection.page) + ' - ' + selection.name +
        ' (' + selection.start + '-' + selection.end + ')');
    }
  }

  function handleManualTreeToggle(event) {
    if (readUserClosed()) return;
    if (suppressTreeClickSync) return;

    var toggler = event.target && event.target.closest && event.target.closest('.tg');
    var root = toggler && toggler.closest && toggler.closest('#visoes-0-itens, [id^="visoes-"][id$="-itens"]');
    if (!toggler || !root) return;

    manualTreeMode = true;
    autoExpandedTreeNodes = [];
  }

  function makeEl(tag, attrs, text) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'style') {
        Object.assign(el.style, attrs[key]);
      } else {
        el.setAttribute(key, attrs[key]);
      }
    });
    if (text) el.textContent = text;
    return el;
  }

  function makeSearchIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'block';

    var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '10.5');
    circle.setAttribute('cy', '10.5');
    circle.setAttribute('r', '6.5');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '2');

    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '15.5');
    line.setAttribute('y1', '15.5');
    line.setAttribute('x2', '21');
    line.setAttribute('y2', '21');
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');

    svg.appendChild(circle);
    svg.appendChild(line);
    return svg;
  }

  function readSavedPosition() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function savePosition(left, top) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: left, top: top }));
  }

  function makeDraggable(box, handle) {
    var startX = 0;
    var startY = 0;
    var startLeft = 0;
    var startTop = 0;

    handle.addEventListener('mousedown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = box.offsetLeft;
      startTop = box.offsetTop;

      function move(moveEvent) {
        var left = Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, startLeft + moveEvent.clientX - startX));
        var minTop = 0;
        var top = Math.max(minTop, Math.min(window.innerHeight - box.offsetHeight - 8, startTop + moveEvent.clientY - startY));
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.right = 'auto';
      }

      function stop() {
        savePosition(box.offsetLeft, box.offsetTop);
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', stop);
      }

      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', stop);
    });
  }

  function updateStatus() {
    if (readUserClosed()) return;
    refreshProcessSelect();
    if (!statusEl) return;
    if (pendingChoiceMode) return;
    // Soma de todos os processos da arvore (principal + apensados), nao so o processo ativo no
    // widget - processSelectOptions ja vem de refreshProcessSelect() logo acima, com a
    // contagem de paginas de cada processo pronta.
    var totalPages = processSelectOptions.reduce(function (sum, opt) { return sum + opt.pages; }, 0);
    var processCount = processSelectOptions.length;

    setText(statusEl, processCount
      ? 'Total de ' + totalPages + ' páginas em ' + processCount + ' processo' +
        (processCount === 1 ? '' : 's') + '.'
      : 'Abra a Pasta Digital (Aba Pecas) para indexar.');
  }

  function scheduleStatusUpdate() {
    if (readUserClosed()) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(function () {
      if (readUserClosed()) return;
      ensureUi();
      updateStatus();
    }, 250);
  }

  function ensureUi() {
    if (!document.body) return;
    if (readUserClosed()) return;
    var diagnostic = detectSgpeStructure();
    if (!diagnostic.ok) {
      var existing = document.getElementById(TOOL_ID);
      if (existing) existing.remove();
      if (isKnownAlternateSgpeScreen()) {
        markKnownAlternateScreenActive();
        clearStructureWarning();
        return;
      }
      scheduleStructureWarning(diagnostic);
      return;
    }
    markStructureHealthy();
    clearStructureWarning();
    if (!document.getElementById(TOOL_ID)) installUi();
  }
  function installUi() {
    var existing = document.getElementById(TOOL_ID);
    if (existing) existing.remove();
    statusEl = null;
    inputEl = null;
    choiceEl = null;
    pieceInputEl = null;
    processInputEl = null;
    processDisplayEl = null;
    processMenuEl = null;
    processDropdownOpen = false;

    var saved = readSavedPosition();
    var box = makeEl('div', {
      id: TOOL_ID,
      style: {
        position: 'fixed',
        top: saved && Number.isFinite(saved.top) ? saved.top + 'px' : '166px',
        right: 'auto',
        left: saved && Number.isFinite(saved.left) ? saved.left + 'px' : '262px',
        zIndex: 2147483647,
        width: '69px',
        height: '69px',
        padding: '5px',
        background: '#fff',
        border: '1px solid #777',
        borderRadius: '0',
        boxShadow: '0 2px 9px rgba(0,0,0,.25)',
        font: '12px Arial, sans-serif',
        color: '#111',
        boxSizing: 'border-box'
      }
    });

    var handle = makeEl('div', {
      title: 'Arrastar',
      style: {
        position: 'absolute',
        left: '6px',
        top: '9px',
        width: '31px',
        height: '31px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'move',
        userSelect: 'none',
        color: '#111'
      }
    });
    var icon = makeSearchIcon();
    icon.setAttribute('width', '30');
    icon.setAttribute('height', '30');
    handle.appendChild(icon);

    var label = makeEl('div', {
      style: {
        position: 'absolute',
        left: '6px',
        bottom: '5px',
        width: '39px',
        fontSize: '9px',
        fontWeight: '700',
        lineHeight: '9px',
        whiteSpace: 'pre-line',
        color: '#111'
      }
    }, 'Buscador\nSGPe');

    var info = makeEl('button', {
      type: 'button',
      title: 'Buscador SGPe - N\u00c3O OFICIAL (vers\u00e3o ' + EXTENSION_VERSION + ')\nDesenvolvido por: Daniel Rohden Speck',
      style: {
        position: 'absolute',
        right: '4px',
        bottom: '4px',
        width: '14px',
        height: '14px',
        border: '1px solid #bbb',
        borderRadius: '50%',
        background: '#f8fafc',
        cursor: 'help',
        fontWeight: '700',
        fontSize: '9px',
        lineHeight: '12px',
        padding: '0'
      }
    }, 'i');

    var expand = makeEl('button', {
      type: 'button',
      title: 'Expandir buscador',
      style: {
        position: 'absolute',
        top: '5px',
        right: '21px',
        width: '10px',
        height: '10px',
        border: '1px solid #aaa',
        borderRadius: '2px',
        background: '#f7f7f7',
        cursor: 'pointer',
        fontSize: '9px',
        lineHeight: '7px',
        padding: '0'
      }
    }, '+');

    var close = makeEl('button', {
      type: 'button',
      title: 'Fechar',
      style: {
        position: 'absolute',
        top: '3px',
        right: '4px',
        width: '10px',
        height: '10px',
        border: '0',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: '10px',
        lineHeight: '9px',
        padding: '0'
      }
    }, 'x');

    box.appendChild(handle);
    box.appendChild(label);
    box.appendChild(info);
    box.appendChild(expand);
    box.appendChild(close);
    document.body.appendChild(box);
    makeDraggable(box, handle);

    expand.addEventListener('click', function () {
      box.remove();
      installExpandedUi();
    });

    close.addEventListener('click', function () {
      suspendScriptAfterClose();
      box.remove();
    });
  }

  // ---- Busca por palavra-chave: secao expansivel do painel ----
  // Vive somente dentro do painel expandido (nunca na caixa mini), para nao pesar o uso
  // padrao de quem so usa o "pular pra pagina". Comeca sempre recolhida a cada abertura.
  function buildKeywordSearchSection(box) {
    keywordSectionExpanded = false;
    keywordIncludeJoinedTouched = false;

    keywordSectionEl = makeEl('div', {
      style: {
        marginTop: '8px',
        paddingTop: '6px',
        borderTop: '1px solid #ddd',
        display: 'flex',
        flexDirection: 'column'
      }
    });

    var toggleRow = makeEl('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer'
      },
      title: 'Expandir/recolher busca por palavra-chave'
    });
    var toggleLabel = makeEl('div', {
      style: { fontSize: '11px', fontWeight: '700', color: '#333' }
    }, 'Busca por palavra-chave (todas as peças)');
    keywordToggleBtn = makeEl('button', {
      type: 'button',
      style: {
        padding: '2px 7px',
        border: '1px solid #aaa',
        borderRadius: '3px',
        background: '#f7f7f7',
        cursor: 'pointer',
        fontSize: '12px'
      }
    }, '+');
    toggleRow.appendChild(toggleLabel);
    toggleRow.appendChild(keywordToggleBtn);
    keywordSectionEl.appendChild(toggleRow);

    var content = makeEl('div', {
      style: {
        marginTop: '6px',
        display: 'none',
        flexDirection: 'column'
      }
    });

    keywordEstimateEl = makeEl('div', {
      style: { fontSize: '11px', color: '#7c2d12', marginBottom: '5px' }
    });
    content.appendChild(keywordEstimateEl);

    // So aparece quando a pasta tem processos apensados/juntados (renderKeywordEstimate cuida
    // da visibilidade) - em processo simples a secao fica identica a de antes.
    keywordIncludeJoinedRow = makeEl('label', {
      title: 'Inclui as peças dos processos apensados/juntados nesta busca (bem mais lento)',
      style: {
        display: 'none',
        alignItems: 'flex-start',
        gap: '5px',
        fontSize: '11px',
        marginBottom: '5px',
        cursor: 'pointer'
      }
    });
    keywordIncludeJoinedEl = makeEl('input', {
      type: 'checkbox',
      style: { margin: '1px 0 0', cursor: 'pointer' }
    });
    keywordIncludeJoinedRow.appendChild(keywordIncludeJoinedEl);
    keywordIncludeJoinedRow.appendChild(makeEl('span', {}, 'Incluir processos apensados/juntados'));
    content.appendChild(keywordIncludeJoinedRow);

    keywordIncludeJoinedEl.addEventListener('change', function () {
      keywordIncludeJoinedTouched = true;
      renderKeywordEstimate();
    });

    var form = makeEl('form', {
      style: { display: 'flex', gap: '5px', alignItems: 'center', marginBottom: '5px' }
    });
    keywordInputEl = makeEl('input', {
      type: 'text',
      placeholder: 'Ex.: contrato',
      title: 'Digite o termo a buscar no texto das peças',
      style: {
        flex: '1',
        minWidth: '0',
        boxSizing: 'border-box',
        padding: '5px',
        border: '1px solid #999',
        borderRadius: '3px',
        fontSize: '12px'
      }
    });
    keywordSearchBtn = makeEl('button', {
      type: 'submit',
      style: {
        padding: '5px 6px',
        border: '1px solid #777',
        borderRadius: '3px',
        background: '#eee',
        cursor: 'pointer',
        fontSize: '12px'
      }
    }, 'Buscar');
    keywordCancelBtn = makeEl('button', {
      type: 'button',
      style: {
        padding: '5px 6px',
        border: '1px solid #777',
        borderRadius: '3px',
        background: '#eee',
        cursor: 'pointer',
        fontSize: '12px',
        display: 'none'
      }
    }, 'Cancelar');
    form.appendChild(keywordInputEl);
    form.appendChild(keywordSearchBtn);
    form.appendChild(keywordCancelBtn);
    content.appendChild(form);

    keywordProgressEl = makeEl('div', {
      style: { fontSize: '11px', color: '#555', marginBottom: '2px' }
    });
    content.appendChild(keywordProgressEl);

    var progressBarTrack = makeEl('div', {
      style: {
        width: '100%',
        height: '4px',
        background: '#e5e7eb',
        borderRadius: '2px',
        overflow: 'hidden',
        marginBottom: '6px'
      }
    });
    keywordProgressBarEl = makeEl('div', {
      style: { width: '0%', height: '100%', background: '#6b7280' }
    });
    progressBarTrack.appendChild(keywordProgressBarEl);
    content.appendChild(progressBarTrack);

    // Resultados (ocorrencias) primeiro, avisos de pecas nao pesquisadas/com erro depois -
    // por isso keywordResultsEl e anexado ANTES de keywordSummaryEl no DOM.
    // Altura propositalmente baixa (menor que antes) e com rolagem interna, pra que o painel
    // inteiro nunca precise crescer a ponto do usuario ter que arrasta-lo ou dar zoom out pra
    // alcancar o rodape - especialmente quando ha muitas pecas digitalizadas listadas abaixo.
    keywordResultsEl = makeEl('div', {
      style: {
        maxHeight: '140px',
        overflowY: 'auto',
        overflowX: 'hidden',
        fontSize: '11px',
        marginTop: '4px'
      }
    });
    content.appendChild(keywordResultsEl);

    keywordSummaryEl = makeEl('div', { style: { fontSize: '11px', marginTop: '4px' } });
    content.appendChild(keywordSummaryEl);

    keywordSectionEl.appendChild(content);
    box.appendChild(keywordSectionEl);

    function setExpanded(expanded) {
      keywordSectionExpanded = expanded;
      content.style.display = expanded ? 'flex' : 'none';
      keywordToggleBtn.textContent = expanded ? '-' : '+';
      box.style.width = expanded ? '320px' : '202px';
      if (expanded) renderKeywordEstimate();
    }

    toggleRow.addEventListener('click', function () {
      setExpanded(!keywordSectionExpanded);
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      runKeywordSearch(keywordInputEl.value);
    });

    keywordCancelBtn.addEventListener('click', function () {
      cancelKeywordSearch();
    });
  }
  // ---- fim: secao expansivel da busca por palavra-chave ----

  function installExpandedUi() {
    var existing = document.getElementById(TOOL_ID);
    if (existing) existing.remove();

    var saved = readSavedPosition();
    var topPx = saved && Number.isFinite(saved.top) ? saved.top : 166;
    var boxStyle = {
      position: 'fixed',
      top: topPx + 'px',
      right: 'auto',
      left: saved && Number.isFinite(saved.left) ? saved.left + 'px' : '262px',
      zIndex: 2147483647,
      width: '202px',
      // Sem altura fixa: o painel se ajusta sozinho ao conteudo (cresce com mais resultados,
      // encolhe com menos). maxHeight e o teto de seguranca pra nunca passar do viewport -
      // calculado a partir da posicao REAL do topo (nao um valor fixo), pra sempre sobrar uma
      // margem de respiro no rodape da tela, nunca encostando na borda do navegador. Dai em
      // diante, keywordResultsEl e quem rola internamente (ver abaixo).
      maxHeight: 'calc(100vh - ' + (topPx + WIDGET_BOTTOM_MARGIN_PX) + 'px)',
      padding: '7px',
      background: '#fff',
      border: '1px solid #777',
      borderRadius: '4px',
      boxShadow: '0 2px 9px rgba(0,0,0,.25)',
      font: '12px Arial, sans-serif',
      color: '#111',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      overflowY: 'auto'
    };

    var box = makeEl('div', { id: TOOL_ID, style: boxStyle });
    var title = makeEl('div', {
      style: {
        fontWeight: '700',
        marginBottom: '6px',
        paddingRight: '42px',
        cursor: 'move',
        userSelect: 'none'
      }
    }, 'Buscar pelo n\u00ba da P\u00e1gina');

    var row = makeEl('form', {
      style: {
        display: 'flex',
        gap: '5px',
        alignItems: 'center',
        marginBottom: '6px'
      }
    });

    var pieceLabel = makeEl('div', {
      style: {
        marginTop: '6px',
        marginBottom: '3px',
        color: '#333',
        fontSize: '11px',
        fontWeight: '700'
      }
    }, 'Buscar pelo Nome da Pe\u00e7a');

    pieceInputEl = makeEl('input', {
      type: 'text',
      placeholder: 'Digite parte do nome da pe\u00e7a',
      title: 'Digite parte do nome da pe\u00e7a',
      style: {
        boxSizing: 'border-box',
        width: '100%',
        marginBottom: '5px',
        padding: '5px',
        border: '1px solid #bbb',
        borderRadius: '3px',
        fontSize: '12px',
        background: '#fafafa',
        color: '#333'
      }
    });

    var processLabel = makeEl('div', {
      style: {
        marginTop: '5px',
        marginBottom: '3px',
        color: '#333',
        fontSize: '11px'
      }
    }, 'N\u00ba do Processo (restringir busca):');

    // Controle custom (nao input/select nativo): alem de mostrar o processo ativo, permite
    // escolher um processo especifico da arvore (principal/mae ou apensado) pra restringir as
    // buscas so a ele - cada opcao mostra tambem a contagem de paginas, em fonte reduzida, o
    // que um <option> nativo nao suporta. Padrao: processo mae (ver comentario acima da
    // declaracao de manualProcessFilterActive); "Todos os processos" continua disponivel como
    // escolha manual. Fundo cinza claro sempre, pra diferenciar dos demais campos (editaveis,
    // fundo branco/#fafafa) - ver updateProcessFieldStyle().
    processInputEl = makeEl('div', {
      tabindex: '0',
      title: 'Restringir buscas a um processo especifico da arvore',
      style: {
        position: 'relative',
        boxSizing: 'border-box',
        width: '100%',
        padding: '5px',
        border: '1px solid #6b7280',
        borderRadius: '3px',
        fontSize: '12px',
        background: '#e5e7eb',
        color: '#333',
        cursor: 'pointer',
        userSelect: 'none'
      }
    });
    processDisplayEl = makeEl('span', {}, 'Processo mãe');
    processInputEl.appendChild(processDisplayEl);
    processInputEl.appendChild(makeEl('span', {
      style: { float: 'right', color: '#555' }
    }, '▾'));

    // position: fixed (nao absolute) pra escapar do overflowY: auto do painel (box) - senao a
    // lista suspensa ficaria cortada quando o campo esta perto do rodape do painel. Coordenadas
    // calculadas a partir do proprio campo em openProcessMenu(), toda vez que abre (o painel e
    // arrastavel, entao a posicao pode ter mudado desde a ultima abertura).
    processMenuEl = makeEl('div', {
      style: {
        position: 'fixed',
        background: '#fff',
        border: '1px solid #999',
        borderRadius: '3px',
        boxShadow: '0 2px 8px rgba(0,0,0,.2)',
        maxHeight: '160px',
        overflowY: 'auto',
        zIndex: '2147483647',
        display: 'none'
      }
    });
    processInputEl.appendChild(processMenuEl);

    inputEl = makeEl('input', {
      type: 'number',
      min: '1',
      placeholder: 'Ex.: 44',
      title: 'Digite o n\u00famero da p\u00e1gina',
      style: {
        flex: '1',
        minWidth: '0',
        padding: '5px',
        border: '1px solid #999',
        borderRadius: '3px',
        fontSize: '12px'
      }
    });

    choiceEl = makeEl('select', {
      style: {
        boxSizing: 'border-box',
        display: 'none',
        width: '100%',
        marginBottom: '6px',
        padding: '5px',
        border: '1px solid #999',
        borderRadius: '3px',
        fontSize: '12px',
        background: '#fff',
        color: '#111'
      }
    });

    var button = makeEl('button', {
      type: 'submit',
      style: {
        padding: '5px 6px',
        border: '1px solid #777',
        borderRadius: '3px',
        background: '#eee',
        cursor: 'pointer',
        fontSize: '12px'
      }
    }, 'Abrir');

    var clearButton = makeEl('button', {
      type: 'button',
      title: 'Limpar busca',
      style: {
        padding: '5px 6px',
        border: '1px solid #aaa',
        borderRadius: '3px',
        background: '#f7f7f7',
        cursor: 'pointer',
        fontSize: '12px'
      }
    }, 'Limpar');

    var close = makeEl('button', {
      type: 'button',
      title: 'Fechar',
      style: {
        position: 'absolute',
        top: '4px',
        right: '4px',
        border: '0',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: '13px',
        lineHeight: '13px'
      }
    }, 'x');

    var collapse = makeEl('button', {
      type: 'button',
      title: 'Recolher',
      style: {
        position: 'absolute',
        top: '4px',
        right: '24px',
        border: '0',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: '16px',
        lineHeight: '13px'
      }
    }, '-');

    statusEl = makeEl('div', {
      style: {
        minHeight: '26px',
        color: '#333'
      }
    });

    row.appendChild(inputEl);
    row.appendChild(button);
    row.appendChild(clearButton);
    box.appendChild(close);
    box.appendChild(collapse);
    box.appendChild(title);
    box.appendChild(row);
    box.appendChild(choiceEl);
    box.appendChild(statusEl);
    box.appendChild(pieceLabel);
    box.appendChild(pieceInputEl);
    box.appendChild(processLabel);
    box.appendChild(processInputEl);
    buildKeywordSearchSection(box);

    document.body.appendChild(box);
    makeDraggable(box, title);

    close.addEventListener('click', function () {
      suspendScriptAfterClose();
      box.remove();
    });

    collapse.addEventListener('click', function () {
      clearPageChoices();
      cancelKeywordSearch();
      box.remove();
      statusEl = null;
      inputEl = null;
      choiceEl = null;
      pieceInputEl = null;
      processInputEl = null;
    processDisplayEl = null;
    processMenuEl = null;
    processDropdownOpen = false;
      keywordSectionEl = null;
      keywordToggleBtn = null;
      keywordInputEl = null;
      keywordSearchBtn = null;
      keywordCancelBtn = null;
      keywordEstimateEl = null;
      keywordIncludeJoinedEl = null;
      keywordIncludeJoinedRow = null;
      keywordProgressEl = null;
      keywordProgressBarEl = null;
      keywordResultsEl = null;
      keywordSummaryEl = null;
      installUi();
    });

    inputEl.addEventListener('input', function () {
      clearPageChoices();
      selectedProcessLi = null;
    });

    clearButton.addEventListener('click', function () {
      clearWidgetState();
    });

    pieceInputEl.addEventListener('input', function () {
      window.clearTimeout(pieceSearchTimer);
      pieceInputEl.title = pieceInputEl.value;
      selectedProcessLi = null;
      pieceSearchTimer = window.setTimeout(function () {
        var query = pieceInputEl.value;
        var matches = findPieceNameMatches(query);

        clearPageChoices();

        if (normalizeSearchText(query).length < 2) {
          return;
        }

        if (!matches.length) {
          setText(statusEl, 'Nenhuma pe\u00e7a encontrada com esse texto.');
          return;
        }

        showPieceChoices(query, matches);
        setText(statusEl, 'Encontradas ' + matches.length + ' pe\u00e7as. Escolha uma para abrir.');
      }, 250);
    });

    processInputEl.addEventListener('click', function () {
      if (processDropdownOpen) closeProcessMenu(); else openProcessMenu();
    });

    processInputEl.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (processDropdownOpen) closeProcessMenu(); else openProcessMenu();
      } else if (event.key === 'Escape') {
        closeProcessMenu();
      }
    });

    choiceEl.addEventListener('change', function () {
      try {
        openSelectedChoice();
      } catch (error) {
        setText(statusEl, error.message);
      }
    });

    row.addEventListener('submit', function (event) {
      event.preventDefault();
      attemptOpenPage(Number(inputEl.value));
    });

    updateStatus();
  }

  // ---- Menu de contexto "Buscar no processo" (clique direito num número selecionado) ----
  // Disparado pelo background.js (chrome.contextMenus) a partir de QUALQUER aba/janela do
  // navegador, nao so do SGPe - na pratica o numero costuma ser lido fora dele (ex.: um PDF
  // aberto em outra aba/janela). O background ja resolve sozinho qual aba alvo: localiza a aba
  // do SGPe ATIVA (chrome.tabs.query({active: true, url: ...})) e manda so pra ela - nunca pra
  // uma aba do SGPe em segundo plano, mesmo que existam varias abertas em outras janelas.
  //
  // A extensao roda em todos os frames da pagina (all_frames: true) - so o frame que realmente
  // contem a árvore de peças (detectSgpeStructure().ok) deve reagir; os demais (frame do topo,
  // frameset, barra de abas) ignoram silenciosamente.
  // Tenta primeiro um numero com ponto de milhar (grupos de exatamente 3 digitos, ex.:
  // "1.947", "12.345.678") - so cai para digitos simples (ex.: "44") quando essa forma nao
  // bate, senao "1.25.3" (texto tipo versao) seria mal-interpretado como milhar. O ponto e
  // removido antes de converter pra numero.
  function extractPageNumberFromSelection(text) {
    var match = String(text || '').match(/\d{1,3}(?:\.\d{3})+|\d+/);
    if (!match) return NaN;
    return Number(match[0].replace(/\./g, ''));
  }

  function handleSearchInProcessRequest(selectionText) {
    if (!detectSgpeStructure().ok) return;
    if (readUserClosed()) setUserClosed(false);

    ensureUi();
    if (!inputEl) installExpandedUi();
    if (!inputEl) return;

    // A busca pelo menu de contexto sempre acompanha a situacao ativa no widget
    // (getEffectiveProcessFilter()) - com uma excecao: quando essa situacao e "Todos os
    // processos" (escolha manual explicita), e convertida pra so o processo mae, ja que esse
    // gatilho costuma comecar de um numero lido fora da arvore (ex.: um PDF aberto em outra
    // aba/janela), sem relacao com a escolha anterior de buscar em tudo.
    refreshProcessSelect();
    if (manualProcessFilterActive && !manualProcessFilter) {
      var mainIdx = findProcessOptionIndex('', true);
      if (mainIdx !== -1) {
        manualProcessFilter = { label: processSelectOptions[mainIdx].label, main: true };
        updateProcessDisplay();
      }
    }

    var page = extractPageNumberFromSelection(selectionText);
    if (!Number.isInteger(page) || page < 1) {
      setText(statusEl, 'Selecione um número de página válido antes de usar "Buscar no processo".');
      return;
    }

    setFieldValue(inputEl, String(page));
    attemptOpenPage(page);
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || message.type !== 'codex-sgpe-search-in-process') return false;
    handleSearchInProcessRequest(message.selectionText || '');
    return false;
  });
  // ---- fim: menu de contexto "Buscar no processo" ----

  // Fecha a lista suspensa do controle "No do Processo" ao clicar fora dela - registrado uma
  // unica vez aqui (nao dentro de installExpandedUi, que roda de novo a cada expandir/recolher).
  document.addEventListener('click', function (event) {
    if (!processDropdownOpen) return;
    if (processInputEl && processInputEl.contains(event.target)) return;
    closeProcessMenu();
  }, true);

  document.addEventListener('click', resumeScriptAfterPiecesTabClick, true);
  document.addEventListener('click', handleManualTreeToggle, true);
  document.addEventListener('click', handleTreeClick, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUi, { once: true });
  } else {
    ensureUi();
  }

  window.setInterval(function () {
    if (readUserClosed()) return;
    ensureUi();
    updateStatus();
  }, 2000);

  new MutationObserver(scheduleStatusUpdate).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id', 'class', 'style', 'data-p']
  });
})();


