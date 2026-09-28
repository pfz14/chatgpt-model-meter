(() => {
  'use strict';

  // ISOLATED world. Adds the model-route block to the existing quota widget; widget.js remains untouched.
  if (window.__YY_MUM_UI__) return;
  window.__YY_MUM_UI__ = true;

  const HOST_ID = 'yy-codex-usage-meter';
  const OUT = 'yy-mum-widget';
  const IN = 'yy-mum-model';
  const PREF_KEY = 'yyModelMeterPrefs';
  const DISPLAY_SETTINGS_KEY = 'yyCodexUsageMeterSettings';

  let block = null;
  let snapshot = null;
  let prefs = { open: false, debug: false };
  let showModelRoute = null;
  let languageSetting = 'auto';

  const el = (tag, cls, txt) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (txt != null) node.textContent = txt;
    return node;
  };
  const send = (type, extra) => window.postMessage({ source: OUT, type, ...extra }, '*');

  const I18N = {
    zh: {
      waitingSend: '等待发送', noMessages: '这个标签页还没发出过消息', notCaptured: '未捕获',
      waitingEvidence: '收集证据中…', waitingEvidenceHelp: '请求已经发出，仍在收集本轮的模型证据。流结束前判定可能继续变化。',
      noEffective: '无可信 effective', matchHelp: '可信 effective model 与 requested model 一致',
      routedHelp: '可信 effective model 明确与 requested model 不同',
      suspiciousHelp: '出现其他模型或相互冲突的证据，但目前不足以确认实际路由',
      unknownHelp: '没有足够的可信模型证据判断是否发生路由',
      surface: '产品线', requestTier: '请求档位', autoReasoning: '自动转推理', autoSwitcher: '自动切换器',
      switchRace: '切换竞速', search: '联网搜索', cluster: '集群', useCase: '用途', toolInvoked: '调用工具',
      toolName: '工具名', plan: '套餐', latency: '首字延迟', none: '无', yes: '是', no: '否',
      ui: '界面', effort: '强度', api: '接口', status: '状态', approxInline: '（按最近一次发送推断关联）',
      requestTitle: '本轮 requested / selected model', runTitle: '本轮可信 effective / authoritative model',
      surfaceTitle: '服务端遥测报告的产品线', empty: '发一条消息，这里会显示本轮模型证据。', thisTurn: '这一轮',
      debug: 'Debug / Raw Evidence', requested: 'Requested', effective: 'Effective', verdict: 'Verdict', reason: 'Reason',
      evidenceNone: '没有捕获到 model-related 字段', raw: 'raw', canonical: 'canonical', ignoredContext: '历史上下文，不参与本轮判定',
      sourceRequest: 'request', sourceResponse: 'response', sourceSse: 'SSE', sourceHeader: 'header',
      categoryRequested: 'requested / selected', categoryEffective: 'effective / authoritative', categoryAuxiliary: 'auxiliary', categoryUnknown: 'unknown', categoryAdjacent: '模型相关（不参与判定）', categorySubdispatch: '生图/子调用（不参与判定）',
      copyAll: '复制全部', copied: '已复制', copyFailed: '复制失败，请手动选中',
      events: '事件', noEvent: '未捕获事件名',
      stateSent: '已发送', stateStreaming: '流中，收集模型证据', stateHandoff: '已移交后台，收集模型证据',
      stateConfirmed: '已确认执行模型', stateInsufficient: '流已结束，证据不足', stateFailed: '请求失败'
    },
    en: {
      waitingSend: 'Waiting', noMessages: 'No message has been sent in this tab yet', notCaptured: 'Not captured',
      waitingEvidence: 'Collecting evidence…', waitingEvidenceHelp: 'The request was sent and model evidence is still being collected. The verdict may change before the stream ends.',
      noEffective: 'No authoritative model', matchHelp: 'Trusted effective model matches the requested model',
      routedHelp: 'Trusted effective model explicitly differs from the requested model',
      suspiciousHelp: 'Another model or conflicting evidence appeared, but there is not enough authoritative evidence to confirm routing',
      unknownHelp: 'There is not enough trusted model evidence to determine routing',
      surface: 'Surface', requestTier: 'Request tier', autoReasoning: 'Auto reasoning', autoSwitcher: 'Auto switcher',
      switchRace: 'Switch race', search: 'Web search', cluster: 'Cluster', useCase: 'Use case', toolInvoked: 'Tool invoked',
      toolName: 'Tool name', plan: 'Plan', latency: 'First-token latency', none: 'None', yes: 'Yes', no: 'No',
      ui: 'UI', effort: 'Effort', api: 'API', status: 'Status', approxInline: ' (associated with latest send)',
      requestTitle: 'Requested / selected model for this turn', runTitle: 'Trusted effective / authoritative model for this turn',
      surfaceTitle: 'Product surface reported by server telemetry', empty: 'Send a message to see model evidence for the turn.', thisTurn: 'this turn',
      debug: 'Debug / Raw Evidence', requested: 'Requested', effective: 'Effective', verdict: 'Verdict', reason: 'Reason',
      evidenceNone: 'No model-related fields were captured', raw: 'raw', canonical: 'canonical', ignoredContext: 'historical context; excluded from this-turn verdict',
      sourceRequest: 'request', sourceResponse: 'response', sourceSse: 'SSE', sourceHeader: 'header',
      categoryRequested: 'requested / selected', categoryEffective: 'effective / authoritative', categoryAuxiliary: 'auxiliary', categoryUnknown: 'unknown', categoryAdjacent: 'model-adjacent (not used in verdict)', categorySubdispatch: 'image-gen / sub-call (not used in verdict)',
      copyAll: 'Copy all', copied: 'Copied', copyFailed: 'Copy failed; select manually',
      events: 'Events', noEvent: 'No event names captured',
      stateSent: 'Sent', stateStreaming: 'Streaming; collecting model evidence', stateHandoff: 'Handed off; collecting model evidence',
      stateConfirmed: 'Authoritative model evidence received', stateInsufficient: 'Stream ended; evidence insufficient', stateFailed: 'Request failed'
    }
  };

  function resolvedLanguage() {
    if (languageSetting === 'zh' || languageSetting === 'en') return languageSetting;
    return String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  function t(key) {
    const lang = resolvedLanguage();
    return I18N[lang][key] ?? I18N.en[key] ?? key;
  }

  const STATE_KEYS = {
    '已发送': 'stateSent',
    '流中，收集模型证据': 'stateStreaming',
    '已移交后台，收集模型证据': 'stateHandoff',
    '已确认执行模型': 'stateConfirmed',
    '流已结束，证据不足': 'stateInsufficient',
    '请求失败': 'stateFailed',
    // v0.7 compatibility if an old MAIN-world script survives a hot reload.
    '流中，等 STE': 'stateStreaming',
    '已移交后台，等 STE': 'stateHandoff',
    '流已结束，没有 STE 事件': 'stateInsufficient'
  };

  const NOTE_EN = {
    '请求体不可读，本次未建立记录': 'Request body was unreadable; no turn record was created',
    '单个事件过大，已跳过': 'Oversized event skipped',
    '模型证据过多，仅保留最近一部分': 'Too many model-evidence fields; only the most recent subset is retained',
    '请求体已被消费，本次未记录发送模型': 'Request body was already consumed; requested model was not recorded',
    '响应不可复制': 'Response could not be cloned',
    '响应采集失败，页面请求不受影响': 'Response capture failed; the page request was unaffected',
    'XHR 响应不可读': 'XHR response was unreadable'
  };
  function localizeNote(note) { return resolvedLanguage() === 'en' ? (NOTE_EN[note] || note) : note; }

  function savePrefs() {
    try { chrome.storage.sync.set({ [PREF_KEY]: prefs }); } catch {}
  }
  async function loadPrefs() {
    try {
      const got = await chrome.storage.sync.get(PREF_KEY);
      const old = got?.[PREF_KEY];
      if (old && typeof old === 'object') {
        prefs = { ...prefs, ...old };
        if (!('debug' in old) && old.paths) prefs.debug = true;
      }
    } catch {}
    render();
  }
  async function loadRouteSetting() {
    try {
      const got = await chrome.storage.sync.get(DISPLAY_SETTINGS_KEY);
      const display = got?.[DISPLAY_SETTINGS_KEY] || {};
      showModelRoute = display.showModelRoute !== false;
      languageSetting = display.language || 'auto';
    } catch {
      showModelRoute = true;
      languageSetting = 'auto';
    }
    applyRouteSetting();
  }
  function applyRouteSetting() {
    const visible = showModelRoute !== false;
    send('YY_MUM_PAUSE', { paused: !visible });
    if (!visible) {
      if (block) { block.remove(); block = null; }
      return;
    }
    attach();
    render();
  }

  /* ---------------- Verdict ---------------- */

  function legacyDecision(turn) {
    const exec = [...new Set(turn?.exec || [])];
    if (!turn) return 'UNKNOWN';
    if (!exec.length) return 'UNKNOWN';
    if (!turn.requested || exec.length !== 1) return 'SUSPICIOUS';
    return exec[0] === turn.requested ? 'MATCH' : 'ROUTED';
  }

  function verdict(turn) {
    if (!turn) return { code: 'idle', chip: '--', req: '--', run: t('waitingSend'), help: t('noMessages') };

    const req = turn.requested || t('notCaptured');
    const effective = turn.effective || (Array.isArray(turn.exec) && turn.exec.length ? [...new Set(turn.exec)].join(' / ') : '');

    // Keep the in-progress state visually distinct until authoritative evidence arrives.
    if (!effective && !turn.closed) {
      return { code: 'waiting', chip: '···', req, run: t('waitingEvidence'), help: t('waitingEvidenceHelp') };
    }

    const decision = turn.decision || legacyDecision(turn);
    const map = {
      MATCH: { code: 'match', chip: 'MATCH', help: t('matchHelp') },
      ROUTED: { code: 'routed', chip: 'ROUTED', help: t('routedHelp') },
      SUSPICIOUS: { code: 'suspicious', chip: 'SUS', help: t('suspiciousHelp') },
      UNKNOWN: { code: 'unknown', chip: '?', help: t('unknownHelp') }
    };
    const state = map[decision] || map.UNKNOWN;
    return { ...state, mark: decision === 'MATCH' && !!turn.matchUncertain, req, run: effective || t('noEffective') };
  }

  /* ---------------- Details / debug ---------------- */

  function flagLabels() {
    return {
      product_experience: t('surface'), requested_model_experience: t('requestTier'),
      did_auto_switch_to_reasoning: t('autoReasoning'), is_autoswitcher_enabled: t('autoSwitcher'),
      auto_switcher_race_winner: t('switchRace'), is_search: t('search'), cluster_region: t('cluster'),
      turn_use_case: t('useCase'), tool_invoked: t('toolInvoked'), tool_name: t('toolName'),
      plan_type: t('plan'), server_ttfvt_ms: t('latency')
    };
  }
  const flagText = (key, value) => {
    if (value === null) return t('none');
    if (typeof value === 'boolean') return value ? t('yes') : t('no');
    if (key === 'server_ttfvt_ms') return value + ' ms';
    return String(value);
  };

  function detailLines(turn) {
    const lines = [[t('ui'), turn.ui || t('notCaptured')]];
    if (turn.effort) lines.push([t('effort'), turn.effort]);
    for (const [key, label] of Object.entries(flagLabels())) {
      if (key in (turn.flags || {})) lines.push([label, flagText(key, turn.flags[key])]);
    }
    lines.push([t('api'), [turn.api, ...(turn.transports || [])].filter(Boolean).join(' · ') || '--']);
    const stateText = STATE_KEYS[turn.state] ? t(STATE_KEYS[turn.state]) : turn.state;
    lines.push([t('status'), (stateText || '--') + (turn.approx ? t('approxInline') : '')]);
    return lines;
  }

  function rawText(value) {
    if (typeof value === 'string') return JSON.stringify(value);
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  function categoryText(category) {
    return t({
      requested: 'categoryRequested', effective: 'categoryEffective', auxiliary: 'categoryAuxiliary', unknown: 'categoryUnknown',
      adjacent: 'categoryAdjacent', subdispatch: 'categorySubdispatch'
    }[category] || 'categoryUnknown');
  }
  function sourceText(source) {
    return t({ request: 'sourceRequest', response: 'sourceResponse', SSE: 'sourceSse', header: 'sourceHeader' }[source] || 'sourceResponse');
  }

  let debugFitRaf = 0;

  function fitDebugToViewport() {
    if (debugFitRaf) cancelAnimationFrame(debugFitRaf);
    debugFitRaf = requestAnimationFrame(() => {
      debugFitRaf = 0;
      const details = block?.querySelector('.yy-mum-debug[open]');
      const list = details?.querySelector('.yy-mum-evidence-list');
      if (!details || !list) return;

      const host = document.getElementById(HOST_ID);
      const events = details.querySelector('.yy-mum-debug-events');
      const viewportBottom = Math.min(
        Number(window.innerHeight) || Infinity,
        Number(document.documentElement?.clientHeight) || Infinity
      );
      if (!Number.isFinite(viewportBottom)) return;

      const listTop = list.getBoundingClientRect().top;
      const hostStyle = host ? getComputedStyle(host) : null;
      const bottomPadding = Number.parseFloat(hostStyle?.paddingBottom || '0') || 0;
      let trailing = 0;
      if (events) {
        const eventStyle = getComputedStyle(events);
        trailing += events.getBoundingClientRect().height;
        trailing += Number.parseFloat(eventStyle.marginTop || '0') || 0;
        trailing += Number.parseFloat(eventStyle.marginBottom || '0') || 0;
      }

      // 只使用列表以下真正剩余的可视空间。内容较少时 max-height 不会强制拉长；
      // 内容较多时，证据列表在碰到视口底部之前开始自身滚动。
      const available = Math.floor(viewportBottom - listTop - trailing - bottomPadding - 10);
      list.style.maxHeight = `${Math.max(48, available)}px`;
    });
  }

  function buildDebug(turn) {
    const evidence = Array.isArray(turn.evidence) ? turn.evidence : [];
    const details = el('details', 'yy-mum-debug');
    details.open = !!prefs.debug;
    const summary = el('summary', 'yy-mum-debug-summary', `${t('debug')} (${evidence.length})`);
    details.append(summary);

    const overview = el('dl', 'yy-mum-debug-overview');
    overview.append(
      el('dt', null, t('requested')), el('dd', null, turn.requested || t('notCaptured')),
      el('dt', null, t('effective')), el('dd', null, turn.effective || t('noEffective')),
      el('dt', null, t('verdict')), el('dd', 'yy-mum-verdict-text', (turn.decision || legacyDecision(turn)) + (turn.decision === 'MATCH' && turn.matchUncertain ? '?' : '')),
      el('dt', null, t('reason')), el('dd', null, turn.decisionReason || '--')
    );
    details.append(overview);

    const copyBtn = el('button', 'yy-mum-copy', t('copyAll'));
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const ok = await copyText(debugPlainText(turn));
      copyBtn.textContent = ok ? t('copied') : t('copyFailed');
      setTimeout(() => { copyBtn.textContent = t('copyAll'); }, 1400);
    });
    details.append(copyBtn);

    const list = el('div', 'yy-mum-evidence-list');
    if (!evidence.length) {
      list.append(el('div', 'yy-mum-evidence-empty', t('evidenceNone')));
    } else {
      evidence.forEach((item) => {
        const card = el('div', `yy-mum-evidence yy-mum-evidence-${item.category || 'unknown'}`);
        const path = el('div', 'yy-mum-evidence-path', item.path || '--');
        const metaBits = [sourceText(item.source), categoryText(item.category)];
        if (item.api) metaBits.push(item.api);
        if (item.approx) metaBits.push('≈');
        if (item.relevant === false) metaBits.push(t('ignoredContext'));
        const meta = el('div', 'yy-mum-evidence-meta', metaBits.join(' · '));
        const raw = el('div', 'yy-mum-evidence-raw', `${t('raw')}: ${rawText(item.raw)}`);
        card.append(path, meta, raw);
        if (item.canonical && item.canonical !== item.raw) {
          card.append(el('div', 'yy-mum-evidence-canon', `${t('canonical')}: ${item.canonical}`));
        }
        list.append(card);
      });
    }
    details.append(list);

    if (turn.events?.length) details.append(el('div', 'yy-mum-debug-events', `${t('events')}: ${turn.events.join(' · ')}`));
    else details.append(el('div', 'yy-mum-debug-events', `${t('events')}: ${t('noEvent')}`));

    details.addEventListener('toggle', () => {
      prefs.debug = details.open;
      savePrefs();
      if (details.open) fitDebugToViewport();
    });
    return details;
  }

  function debugPlainText(turn) {
    const evidence = Array.isArray(turn.evidence) ? turn.evidence : [];
    const verdictText = (turn.decision || legacyDecision(turn)) + (turn.decision === 'MATCH' && turn.matchUncertain ? '?' : '');
    const lines = [
      `${t('requested')}: ${turn.requested || t('notCaptured')}`,
      `${t('effective')}: ${turn.effective || t('noEffective')}`,
      `${t('verdict')}: ${verdictText}`,
      `${t('reason')}: ${turn.decisionReason || '--'}`,
      ...detailLines(turn).map(([k, v]) => `${k}: ${v}`),
      ''
    ];
    for (const item of evidence) {
      const meta = [sourceText(item.source), categoryText(item.category), item.api, item.approx ? '≈' : ''].filter(Boolean);
      if (item.relevant === false) meta.push(t('ignoredContext'));
      lines.push(item.path || '--', `  ${meta.join(' · ')}`, `  ${t('raw')}: ${rawText(item.raw)}`);
      if (item.canonical && item.canonical !== item.raw) lines.push(`  ${t('canonical')}: ${item.canonical}`);
    }
    lines.push('', `${t('events')}: ${turn.events?.length ? turn.events.join(' · ') : t('noEvent')}`);
    return lines.join('\n');
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }

  // While the user has text selected inside the panel, live updates would destroy the selection.
  // Hold the body rebuild until the selection is cleared.
  let renderHeld = false;
  function selectionInsideBody() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
      const body = block?.querySelector('.yy-mum-body');
      return !!body && body.contains(sel.getRangeAt(0).commonAncestorContainer);
    } catch { return false; }
  }
  document.addEventListener('selectionchange', () => {
    if (renderHeld && !selectionInsideBody()) { renderHeld = false; render(); }
  });

  /* ---------------- Render ---------------- */

  function render() {
    if (!block) return;
    const turn = (snapshot?.turns || [])[0] || null;
    const v = verdict(turn);

    const reqVal = block.querySelector('.yy-mum-reqval');
    reqVal.textContent = v.req;
    reqVal.title = t('requestTitle');

    const runVal = block.querySelector('.yy-mum-runval');
    runVal.textContent = v.run;
    runVal.dataset.code = v.code;
    runVal.title = t('runTitle');

    const tag = block.querySelector('.yy-mum-surface');
    const surface = turn?.flags?.product_experience || '';
    tag.textContent = surface;
    tag.hidden = !surface;
    tag.title = t('surfaceTitle');

    const chip = block.querySelector('.yy-mum-chip');
    chip.textContent = v.chip;
    if (v.mark) chip.append(el('span', 'yy-mum-chip-mark', '?'));
    chip.dataset.code = v.code;
    chip.title = v.help;

    const body = block.querySelector('.yy-mum-body');
    body.hidden = !prefs.open;
    block.querySelector('.yy-mum-caret').textContent = prefs.open ? '▾' : '▸';
    if (!prefs.open) return;
    if (selectionInsideBody()) { renderHeld = true; return; }

    const oldList = body.querySelector('.yy-mum-evidence-list');
    const keepScroll = oldList ? oldList.scrollTop : 0;
    body.replaceChildren();
    if (!turn) {
      body.append(el('div', 'yy-mum-empty', t('empty')));
    } else {
      body.append(el('div', 'yy-mum-time', new Date(turn.t).toLocaleTimeString(resolvedLanguage() === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }) + ' ' + t('thisTurn')));
      const dl = el('dl', 'yy-mum-dl');
      for (const [k, val] of detailLines(turn)) dl.append(el('dt', null, k), el('dd', null, val));
      body.append(dl, buildDebug(turn));
      const newList = body.querySelector('.yy-mum-evidence-list');
      if (newList && keepScroll) newList.scrollTop = keepScroll;
    }
    if (snapshot?.notes?.length) body.append(el('div', 'yy-mum-note', snapshot.notes.map(localizeNote).join(resolvedLanguage() === 'zh' ? '；' : '; ')));
    fitDebugToViewport();
  }

  /* ---------------- Mount ---------------- */

  function styles() {
    if (document.getElementById('yy-mum-style')) return;
    const style = el('style');
    style.id = 'yy-mum-style';
    style.textContent = `
      #${HOST_ID} .yy-mum-block { margin-top: 4px; padding-top: 5px; border-top: 1px solid color-mix(in srgb, currentColor 13%, transparent); }
      @supports not (background: color-mix(in srgb, black 10%, transparent)) { #${HOST_ID} .yy-mum-block { border-top-color: rgba(127,127,127,.2); } }
      #${HOST_ID} .yy-mum-rows { display: grid; grid-template-columns: 24px minmax(0,1fr) auto auto auto; align-items: center; gap: 1px 6px; line-height: 1.4; cursor: pointer; }
      #${HOST_ID} .yy-mum-key { font-weight: 700; letter-spacing: .02em; opacity: .82; }
      #${HOST_ID} .yy-mum-main { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
      #${HOST_ID} .yy-mum-reqval { opacity: .72; }
      #${HOST_ID} .yy-mum-runval { opacity: .95; }
      #${HOST_ID} .yy-mum-runval[data-code="routed"] { color: #c96f1a; font-weight: 700; opacity: 1; }
      #${HOST_ID} .yy-mum-runval[data-code="suspicious"] { color: #9b7a21; font-weight: 650; opacity: 1; }
      #${HOST_ID}[data-theme="dark"] .yy-mum-runval[data-code="routed"] { color: #efa845; }
      #${HOST_ID}[data-theme="dark"] .yy-mum-runval[data-code="suspicious"] { color: #d7b95a; }
      #${HOST_ID} .yy-mum-runval[data-code="waiting"], #${HOST_ID} .yy-mum-runval[data-code="unknown"], #${HOST_ID} .yy-mum-runval[data-code="idle"] { opacity: .55; }
      #${HOST_ID} .yy-mum-surface { font-size: .82em; padding: 1px 5px; border-radius: 5px; background: color-mix(in srgb, currentColor 12%, transparent); opacity: .7; }
      #${HOST_ID} .yy-mum-surface[hidden] { display: none; }
      #${HOST_ID} .yy-mum-chip { display: inline-grid; grid-auto-flow: column; align-items: baseline; justify-content: center; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 5px; font-size: .72em; font-weight: 750; opacity: .9; white-space: nowrap; }
      #${HOST_ID} .yy-mum-chip[data-code="match"] { background: rgba(52,168,110,.2); color: #2f9c65; }
      #${HOST_ID} .yy-mum-chip[data-code="routed"] { background: rgba(216,100,36,.22); color: #bd6017; }
      #${HOST_ID} .yy-mum-chip[data-code="suspicious"] { background: rgba(190,153,46,.2); color: #8c711b; }
      #${HOST_ID} .yy-mum-chip[data-code="unknown"] { background: rgba(150,150,150,.22); opacity: .8; }
      #${HOST_ID} .yy-mum-chip[data-code="waiting"], #${HOST_ID} .yy-mum-chip[data-code="idle"] { background: color-mix(in srgb, currentColor 12%, transparent); opacity: .55; }
      #${HOST_ID}[data-theme="dark"] .yy-mum-chip[data-code="match"] { color: #58c894; }
      #${HOST_ID}[data-theme="dark"] .yy-mum-chip[data-code="routed"] { color: #efa845; }
      #${HOST_ID}[data-theme="dark"] .yy-mum-chip[data-code="suspicious"] { color: #d7b95a; }
      #${HOST_ID} .yy-mum-caret { opacity: .5; font-size: .8em; }
      #${HOST_ID} .yy-mum-body { margin-top: 4px; font-size: .9em; line-height: 1.45; }
      #${HOST_ID} .yy-mum-body[hidden] { display: none; }
      #${HOST_ID} .yy-mum-empty { opacity: .62; }
      #${HOST_ID} .yy-mum-time { opacity: .5; margin-bottom: 3px; }
      #${HOST_ID} .yy-mum-dl, #${HOST_ID} .yy-mum-debug-overview { display: grid; grid-template-columns: 76px minmax(0,1fr); gap: 2px 8px; margin: 0; }
      #${HOST_ID} .yy-mum-dl dt, #${HOST_ID} .yy-mum-debug-overview dt { opacity: .6; }
      #${HOST_ID} .yy-mum-dl dt { white-space: nowrap; }
      #${HOST_ID} .yy-mum-dl dd, #${HOST_ID} .yy-mum-debug-overview dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; font-variant-numeric: tabular-nums; }
      #${HOST_ID} .yy-mum-note { margin-top: 5px; opacity: .62; }
      #${HOST_ID} .yy-mum-debug { margin-top: 7px; border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent); padding-top: 5px; }
      #${HOST_ID} .yy-mum-debug-summary { cursor: pointer; user-select: none; opacity: .76; font-weight: 650; }
      #${HOST_ID} .yy-mum-debug-overview { margin-top: 6px; grid-template-columns: 62px minmax(0,1fr); }
      #${HOST_ID} .yy-mum-verdict-text { font-weight: 750; }
      #${HOST_ID} .yy-mum-evidence-list { display: grid; gap: 5px; margin-top: 7px; overflow: auto; padding-right: 2px; }
      #${HOST_ID} .yy-mum-evidence { border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 7px; padding: 5px 6px; background: color-mix(in srgb, currentColor 3%, transparent); }
      #${HOST_ID} .yy-mum-evidence-effective { border-left: 3px solid rgba(52,168,110,.65); }
      #${HOST_ID} .yy-mum-evidence-auxiliary { border-left: 3px solid rgba(190,153,46,.6); }
      #${HOST_ID} .yy-mum-evidence-unknown { border-left: 3px solid rgba(140,140,140,.55); }
      #${HOST_ID} .yy-mum-evidence-requested { border-left: 3px solid rgba(80,125,190,.58); }
      #${HOST_ID} .yy-mum-evidence-adjacent { border-left: 3px dashed rgba(140,140,140,.4); opacity: .6; }
      #${HOST_ID} .yy-mum-chip-mark { font-size: .78em; margin-left: 1px; opacity: .8; }
      #${HOST_ID} .yy-mum-evidence-subdispatch { border-left: 3px dashed rgba(190,153,46,.5); opacity: .6; }
      #${HOST_ID} .yy-mum-body .yy-mum-dl, #${HOST_ID} .yy-mum-debug-overview, #${HOST_ID} .yy-mum-evidence-list, #${HOST_ID} .yy-mum-debug-events { -webkit-user-select: text; user-select: text; cursor: text; }
      #${HOST_ID} .yy-mum-copy { margin-top: 6px; font: inherit; font-size: .9em; padding: 1px 7px; border-radius: 5px; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: transparent; color: inherit; opacity: .75; cursor: pointer; }
      #${HOST_ID} .yy-mum-copy:hover { opacity: 1; }
      #${HOST_ID} .yy-mum-evidence-path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; font-size: .94em; }
      #${HOST_ID} .yy-mum-evidence-meta { margin-top: 1px; opacity: .56; font-size: .9em; }
      #${HOST_ID} .yy-mum-evidence-raw, #${HOST_ID} .yy-mum-evidence-canon { margin-top: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
      #${HOST_ID} .yy-mum-evidence-canon { opacity: .62; }
      #${HOST_ID} .yy-mum-evidence-empty, #${HOST_ID} .yy-mum-debug-events { margin-top: 6px; opacity: .6; overflow-wrap: anywhere; }
    `;
    document.documentElement.appendChild(style);
  }

  function build(host) {
    styles();
    block = el('div', 'yy-mum-block');
    const rows = el('div', 'yy-mum-rows');
    rows.append(
      el('span', 'yy-mum-key', 'req'), el('span', 'yy-mum-main yy-mum-reqval', '--'), el('span'), el('span'), el('span'),
      el('span', 'yy-mum-key', 'run'), el('span', 'yy-mum-main yy-mum-runval', t('waitingSend')), el('span', 'yy-mum-surface'),
      el('span', 'yy-mum-chip', '--'), el('span', 'yy-mum-caret', '▸')
    );
    const body = el('div', 'yy-mum-body');
    body.hidden = true;

    block.addEventListener('click', (e) => e.stopPropagation());
    rows.addEventListener('click', () => {
      prefs.open = !prefs.open;
      savePrefs();
      render();
      if (prefs.open) send('YY_MUM_REQUEST');
    });

    block.append(rows, body);
    const panel = host.querySelector('.yy-cum-settings-panel');
    if (panel) host.insertBefore(block, panel);
    else host.appendChild(block);
    render();
    loadPrefs();
    send('YY_MUM_REQUEST');
  }

  function attach() {
    if (showModelRoute !== true) return false;
    if (block?.isConnected) return true;
    const host = document.getElementById(HOST_ID);
    if (!host) return false;
    build(host);
    return true;
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== IN) return;
    if (data.type === 'YY_MUM_DATA' && Number(data.snapshot?.v) >= 2) {
      snapshot = data.snapshot;
      attach();
      render();
    }
  });

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !(DISPLAY_SETTINGS_KEY in changes)) return;
      const saved = changes[DISPLAY_SETTINGS_KEY].newValue || {};
      showModelRoute = saved.showModelRoute !== false;
      languageSetting = saved.language || 'auto';
      applyRouteSetting();
    });
  } catch {}

  const observer = new MutationObserver(() => { attach(); });
  observer.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('resize', fitDebugToViewport, { passive: true });
  setInterval(attach, 2_000);
  loadRouteSetting();
})();
