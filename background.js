// Menu de contexto "Buscar no processo": aparece ao selecionar texto em QUALQUER pagina/aba/
// janela do navegador (sem documentUrlPatterns) - na pratica o numero de pagina costuma ser
// lido fora do SGPe (ex.: um PDF aberto numa aba/janela separada), entao restringir o item so
// ao dominio do SGPe deixava a funcionalidade inutil nesse uso real.
//
// Como a selecao quase nunca acontece na propria aba do SGPe, o alvo da busca NAO e a aba do
// clique (tab, abaixo) - e sim a aba do SGPe que estiver ATIVA em sua janela no momento do
// clique. "Ativa" aqui replica a mesma restricao pedida originalmente (so a unica aba
// aberta/ativa, nunca uma aba do SGPe em segundo plano/inativa): chrome.tabs.query({active:
// true, url: ...}) devolve so a aba ativa de CADA janela que bater com o padrao - uma aba do
// SGPe em outra aba da MESMA janela (nao ativa) nunca entra nesse resultado. Se houver mais de
// uma janela com uma aba do SGPe ativa ao mesmo tempo (raro), fica a do primeiro resultado.
var CONTEXT_MENU_SEARCH_ID = 'codex-sgpe-search-in-process';
var SGPE_URL_PATTERN = 'https://sgpe.sea.sc.gov.br/*';

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SEARCH_ID,
      title: 'Buscar no processo',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener(function (info) {
  if (info.menuItemId !== CONTEXT_MENU_SEARCH_ID) return;

  chrome.tabs.query({ active: true, url: SGPE_URL_PATTERN }, function (tabs) {
    var target = tabs && tabs[0];
    if (!target || typeof target.id !== 'number') return; // nenhuma aba do SGPe ativa no momento

    chrome.tabs.sendMessage(target.id, {
      type: 'codex-sgpe-search-in-process',
      selectionText: info.selectionText || ''
    }, function () {
      // Sem callback de origem esperando resposta - so consome o lastError (ex.: frame sem o
      // content script pronto ainda) pra nao poluir o console com "Unchecked runtime.lastError".
      void chrome.runtime.lastError;
    });

    // Traz a aba/janela do processo pra frente, pra o usuario ver o resultado sem precisar
    // trocar de aba manualmente - ele estava olhando outra janela (o PDF) no momento do clique.
    chrome.tabs.update(target.id, { active: true });
    if (typeof target.windowId === 'number') {
      chrome.windows.update(target.windowId, { focused: true });
    }
  });
});

// Injeta vendor/pdf.min.js sob demanda no frame que pediu, so quando a busca por
// palavra-chave e realmente usada - antes ele ia embutido no manifest.json e carregava em
// TODO frame do SGPe, mesmo sem o usuario abrir a busca (medicoes mostraram quase o dobro de
// heap JS so por isso). Injetado via chrome.scripting no mesmo isolated world do content
// script daquele frame, entao "pdfjsLib" fica visivel do mesmo jeito que ficava antes.
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== 'codex-sgpe-load-pdfjs') return false;
  if (!sender.tab || typeof sender.tab.id !== 'number') {
    sendResponse({ ok: false, error: 'Remetente sem aba valida.' });
    return false;
  }

  chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
    files: ['vendor/pdf.min.js']
  }).then(function () {
    sendResponse({ ok: true });
  }, function (error) {
    sendResponse({ ok: false, error: (error && error.message) || String(error) });
  });

  return true; // resposta assincrona
});
