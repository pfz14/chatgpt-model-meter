(() => {
  'use strict';

  if (window.__YY_CODEX_USAGE_WIDGET__) return;
  window.__YY_CODEX_USAGE_WIDGET__ = true;

  const MESSAGE_DATA = 'YY_CODEX_USAGE_DATA';
  const MESSAGE_ERROR = 'YY_CODEX_USAGE_ERROR';
  const MESSAGE_REQUEST = 'YY_CODEX_USAGE_REQUEST';
  const WIDGET_ID = 'yy-codex-usage-meter';
  const SETTINGS_KEY = 'yyCodexUsageMeterSettings';
  const SETTINGS_PANEL_WIDTH = 236; // keep in sync with .yy-cum-settings-panel CSS width
  const VIEWPORT_EDGE_MARGIN = 8;

  const DEFAULT_SETTINGS = {
    fontFamily: 'system',
    fontSize: 13,
    textColor: null,
    cardColor: null,
    cardOpacity: 92,
    showModelRoute: true,
    defaultHidden: false,
    language: 'auto',
    posMode: 'auto',
    posX: null,
    posY: null,
    collapsed: false
  };

  const FONT_FAMILIES = {
    system: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  };


  const I18N = {
    zh: {
      settingsTitle: '显示设置', language: '界面语言', modelRouting: '显示模型路由', autoHide: '默认隐藏',
      font: '字体', system: '系统无衬线', serif: '衬线', mono: '等宽', size: '字号',
      textColor: '文字颜色', cardColor: '卡片颜色', opacity: '透明度',
      followTheme: '跟随主题', reset: '恢复默认', settings: '显示设置',
      collapse: '收纳', expand: '展开', resetPosition: '恢复自动跟随',
      usageTitle: 'Work / Codex 剩余额度', clickRefresh: '点击卡片立即刷新。',
      readError: '暂时读取不到额度', retry: '点击卡片重试。'
    },
    en: {
      settingsTitle: 'Display settings', language: 'Language', modelRouting: 'Model routing', autoHide: 'Auto-hide',
      font: 'Font', system: 'System sans', serif: 'Serif', mono: 'Monospace', size: 'Font size',
      textColor: 'Text color', cardColor: 'Card color', opacity: 'Opacity',
      followTheme: 'Follow theme', reset: 'Reset', settings: 'Display settings',
      collapse: 'Collapse', expand: 'Expand', resetPosition: 'Auto-follow sidebar',
      usageTitle: 'Work / Codex remaining quota', clickRefresh: 'Click the card to refresh.',
      readError: 'Unable to read quota right now', retry: 'Click the card to retry.'
    }
  };

  function resolvedLanguage() {
    if (currentSettings.language === 'zh' || currentSettings.language === 'en') return currentSettings.language;
    const lang = String(navigator.language || '').toLowerCase();
    return lang.startsWith('zh') ? 'zh' : 'en';
  }

  function t(key) {
    const lang = resolvedLanguage();
    return I18N[lang][key] ?? I18N.en[key] ?? key;
  }

  let payload = null;
  let lastError = '';
  let widget = null;
  let fiveHourValue = null;
  let weeklyValue = null;
  let settingsPanel = null;
  let settingsButton = null;
  let collapseButton = null;
  let autoHideCloseTimer = 0;
  const AUTO_HIDE_MARGIN = 5;
  let lastPointerX = null;
  let lastPointerY = null;
  let currentSettings = { ...DEFAULT_SETTINGS };

  // Dragging state: suppressClick swallows the synthetic click that fires after a real drag.
  let suppressClick = false;
  let dragActive = false;
  let dragMoved = false;
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function remainingPercent(windowData) {
    if (!windowData || typeof windowData.used_percent !== 'number') return null;
    return clamp(Math.round((100 - windowData.used_percent) * 10) / 10, 0, 100);
  }

  function isPrimaryInactive(windowData) {
    if (!windowData) return false;
    const used = Number(windowData.used_percent);
    const total = Number(windowData.limit_window_seconds);
    const remaining = Number(windowData.reset_after_seconds);
    if (!Number.isFinite(used) || !Number.isFinite(total) || !Number.isFinite(remaining)) return false;

    // 5h 窗口未触发时，Web API 会给出 used=0，reset_after≈完整 18000 秒。
    return used === 0 && total > 0 && remaining >= total - 5;
  }

  function formatCountdown(windowData, primary = false) {
    if (!windowData) return '--';
    if (primary && isPrimaryInactive(windowData)) return '-';

    const resetAt = Number(windowData.reset_at);
    if (!Number.isFinite(resetAt) || resetAt <= 0) return '--';

    let totalMinutes = Math.max(0, Math.ceil((resetAt * 1000 - Date.now()) / 60_000));
    if (totalMinutes <= 0) return '0m';

    const days = Math.floor(totalMinutes / 1440);
    totalMinutes %= 1440;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function row(label) {
    const el = document.createElement('div');
    el.className = 'yy-cum-row';
    el.innerHTML = `
      <span class="yy-cum-label">${label}</span>
      <span class="yy-cum-track"><span class="yy-cum-fill"></span></span>
      <span class="yy-cum-percent">--</span>
      <span class="yy-cum-reset">--</span>
    `;
    return el;
  }

  function hexToRgb(hex) {
    const normalized = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16)
    };
  }

  function themeDefaults() {
    const dark = widget?.dataset.theme === 'dark' || bodyLooksDark();
    return dark
      ? { textColor: '#f5f5f5', cardColor: '#232323' }
      : { textColor: '#141414', cardColor: '#fafafa' };
  }

  function effectiveColors() {
    const defaults = themeDefaults();
    return {
      textColor: currentSettings.textColor || defaults.textColor,
      cardColor: currentSettings.cardColor || defaults.cardColor
    };
  }

  function applySettings() {
    if (!widget) return;

    const colors = effectiveColors();
    const rgb = hexToRgb(colors.cardColor) || { r: 250, g: 250, b: 250 };
    const alpha = clamp(Number(currentSettings.cardOpacity) / 100, 0.2, 1);
    const fontFamily = FONT_FAMILIES[currentSettings.fontFamily] || FONT_FAMILIES.system;
    const fontSize = clamp(Number(currentSettings.fontSize) || DEFAULT_SETTINGS.fontSize, 11, 18);

    widget.style.setProperty('--yy-card-bg', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`);
    widget.style.setProperty('--yy-text-color', colors.textColor);
    widget.style.setProperty('--yy-font-family', fontFamily);
    widget.style.setProperty('--yy-font-size', `${fontSize}px`);
    widget.dataset.autoHide = currentSettings.defaultHidden ? 'true' : 'false';
    widget.dataset.collapsed = currentSettings.collapsed ? 'true' : 'false';
    applyLanguage();
    updatePanelSide();

    if (settingsPanel) syncSettingsControls();
  }

  function applyLanguage() {
    if (!widget) return;
    if (settingsPanel) {
      settingsPanel.querySelectorAll('[data-i18n]').forEach((node) => {
        node.textContent = t(node.dataset.i18n);
      });
    }
    if (settingsButton) {
      settingsButton.setAttribute('aria-label', t('settings'));
      settingsButton.title = t('settings');
    }
    if (collapseButton) {
      const collapsed = Boolean(currentSettings.collapsed);
      const label = collapsed ? t('expand') : t('collapse');
      collapseButton.setAttribute('aria-label', label);
      collapseButton.title = label;
      collapseButton.setAttribute('aria-expanded', String(!collapsed));
    }
    render();
  }

  function syncSettingsControls() {
    if (!settingsPanel) return;
    const colors = effectiveColors();
    const fontSelect = settingsPanel.querySelector('[data-setting="fontFamily"]');
    const fontSize = settingsPanel.querySelector('[data-setting="fontSize"]');
    const fontSizeValue = settingsPanel.querySelector('[data-role="fontSizeValue"]');
    const textColor = settingsPanel.querySelector('[data-setting="textColor"]');
    const cardColor = settingsPanel.querySelector('[data-setting="cardColor"]');
    const cardOpacity = settingsPanel.querySelector('[data-setting="cardOpacity"]');
    const cardOpacityValue = settingsPanel.querySelector('[data-role="cardOpacityValue"]');
    const showModelRoute = settingsPanel.querySelector('[data-setting="showModelRoute"]');
    const defaultHidden = settingsPanel.querySelector('[data-setting="defaultHidden"]');
    const language = settingsPanel.querySelector('[data-setting="language"]');

    if (fontSelect) fontSelect.value = currentSettings.fontFamily;
    if (fontSize) fontSize.value = String(currentSettings.fontSize);
    if (fontSizeValue) fontSizeValue.textContent = `${currentSettings.fontSize}px`;
    if (textColor) textColor.value = colors.textColor;
    if (cardColor) cardColor.value = colors.cardColor;
    if (cardOpacity) cardOpacity.value = String(currentSettings.cardOpacity);
    if (cardOpacityValue) cardOpacityValue.textContent = `${currentSettings.cardOpacity}%`;
    if (showModelRoute) showModelRoute.checked = currentSettings.showModelRoute !== false;
    if (defaultHidden) defaultHidden.checked = Boolean(currentSettings.defaultHidden);
    if (language) language.value = currentSettings.language || 'auto';
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get(SETTINGS_KEY);
      const saved = result?.[SETTINGS_KEY];
      if (saved && typeof saved === 'object') {
        currentSettings = { ...DEFAULT_SETTINGS, ...saved };
      }
    } catch {}
    applySettings();
    updatePosition();
  }

  function saveSettings() {
    try {
      chrome.storage.sync.set({ [SETTINGS_KEY]: currentSettings });
    } catch {}
  }

  function buildSettingsPanel() {
    const panel = document.createElement('div');
    panel.className = 'yy-cum-settings-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="yy-cum-settings-title" data-i18n="settingsTitle"></div>

      <label class="yy-cum-setting-line">
        <span data-i18n="language"></span>
        <select data-setting="language">
          <option value="auto">Auto</option>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>

      <label class="yy-cum-setting-line yy-cum-setting-toggle-line">
        <span data-i18n="modelRouting"></span>
        <input data-setting="showModelRoute" type="checkbox">
      </label>

      <label class="yy-cum-setting-line yy-cum-setting-toggle-line">
        <span data-i18n="autoHide"></span>
        <input data-setting="defaultHidden" type="checkbox">
      </label>

      <label class="yy-cum-setting-line">
        <span data-i18n="font"></span>
        <select data-setting="fontFamily">
          <option value="system" data-i18n="system"></option>
          <option value="serif" data-i18n="serif"></option>
          <option value="mono" data-i18n="mono"></option>
        </select>
      </label>

      <label class="yy-cum-setting-line yy-cum-setting-range-line">
        <span data-i18n="size"></span>
        <input data-setting="fontSize" type="range" min="11" max="18" step="1">
        <span class="yy-cum-setting-value" data-role="fontSizeValue"></span>
      </label>

      <label class="yy-cum-setting-line">
        <span data-i18n="textColor"></span>
        <input data-setting="textColor" type="color">
      </label>

      <label class="yy-cum-setting-line">
        <span data-i18n="cardColor"></span>
        <input data-setting="cardColor" type="color">
      </label>

      <label class="yy-cum-setting-line yy-cum-setting-range-line">
        <span data-i18n="opacity"></span>
        <input data-setting="cardOpacity" type="range" min="20" max="100" step="1">
        <span class="yy-cum-setting-value" data-role="cardOpacityValue"></span>
      </label>

      <div class="yy-cum-settings-actions">
        <button type="button" data-action="reset-position" data-i18n="resetPosition"></button>
        <button type="button" data-action="theme-default" data-i18n="followTheme"></button>
        <button type="button" data-action="reset-all" data-i18n="reset"></button>
      </div>
    `;

    panel.addEventListener('click', (event) => event.stopPropagation());
    panel.addEventListener('pointerdown', (event) => event.stopPropagation());

    const fontSelect = panel.querySelector('[data-setting="fontFamily"]');
    const fontSize = panel.querySelector('[data-setting="fontSize"]');
    const textColor = panel.querySelector('[data-setting="textColor"]');
    const cardColor = panel.querySelector('[data-setting="cardColor"]');
    const cardOpacity = panel.querySelector('[data-setting="cardOpacity"]');
    const showModelRoute = panel.querySelector('[data-setting="showModelRoute"]');
    const defaultHidden = panel.querySelector('[data-setting="defaultHidden"]');
    const language = panel.querySelector('[data-setting="language"]');

    language.addEventListener('change', () => {
      currentSettings.language = language.value;
      applySettings();
      saveSettings();
    });

    showModelRoute.addEventListener('change', () => {
      currentSettings.showModelRoute = showModelRoute.checked;
      applySettings();
      saveSettings();
    });

    defaultHidden.addEventListener('change', () => {
      currentSettings.defaultHidden = defaultHidden.checked;
      applySettings();
      saveSettings();
    });

    fontSelect.addEventListener('change', () => {
      currentSettings.fontFamily = fontSelect.value;
      applySettings();
      saveSettings();
    });

    fontSize.addEventListener('input', () => {
      currentSettings.fontSize = Number(fontSize.value);
      applySettings();
      saveSettings();
    });

    textColor.addEventListener('input', () => {
      currentSettings.textColor = textColor.value;
      applySettings();
      saveSettings();
    });

    cardColor.addEventListener('input', () => {
      currentSettings.cardColor = cardColor.value;
      applySettings();
      saveSettings();
    });

    cardOpacity.addEventListener('input', () => {
      currentSettings.cardOpacity = Number(cardOpacity.value);
      applySettings();
      saveSettings();
    });

    panel.querySelector('[data-action="reset-position"]').addEventListener('click', () => {
      currentSettings.posMode = 'auto';
      currentSettings.posX = null;
      currentSettings.posY = null;
      applySettings();
      updatePosition();
      saveSettings();
    });

    panel.querySelector('[data-action="theme-default"]').addEventListener('click', () => {
      currentSettings.textColor = null;
      currentSettings.cardColor = null;
      applySettings();
      saveSettings();
    });

    panel.querySelector('[data-action="reset-all"]').addEventListener('click', () => {
      currentSettings = { ...DEFAULT_SETTINGS };
      applySettings();
      saveSettings();
    });

    syncSettingsControls();
    return panel;
  }

  function buildWidget() {
    if (document.getElementById(WIDGET_ID)) return document.getElementById(WIDGET_ID);

    const style = document.createElement('style');
    style.id = `${WIDGET_ID}-style`;
    style.textContent = `
      #${WIDGET_ID} {
        --yy-card-bg: rgba(250,250,250,.92);
        --yy-text-color: #141414;
        --yy-font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --yy-font-size: 13px;
        position: fixed;
        top: 10px;
        left: 232px;
        width: 236px;
        box-sizing: border-box;
        z-index: 2147483000;
        padding: 8px 10px;
        border: 1px solid rgba(0,0,0,.11);
        border-radius: 12px;
        background: var(--yy-card-bg);
        color: var(--yy-text-color);
        box-shadow: 0 2px 8px rgba(0,0,0,.08);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        font-family: var(--yy-font-family);
        font-size: var(--yy-font-size);
        line-height: 1.15;
        user-select: none;
        transition: left 120ms ease, top 120ms ease, width 140ms ease, padding 140ms ease,
          opacity 120ms ease, background-color 120ms ease, color 120ms ease;
      }

      #${WIDGET_ID}.yy-cum-dragging {
        transition: none !important;
      }

      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer) {
        width: 112px;
        padding: 7px 10px;
      }

      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer) .yy-cum-header {
        min-height: 24px;
        margin-bottom: 0;
      }

      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer) > .yy-cum-row,
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer) > .yy-mum-block,
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer) .yy-cum-settings-button,
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer) > .yy-cum-settings-panel {
        display: none !important;
      }

      #${WIDGET_ID}[data-theme="dark"] {
        border-color: rgba(255,255,255,.14);
        box-shadow: 0 2px 10px rgba(0,0,0,.32);
      }

      #${WIDGET_ID}.yy-cum-loading { opacity: .76; }
      #${WIDGET_ID}.yy-cum-error { opacity: .82; }

      #${WIDGET_ID} .yy-cum-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        min-height: 22px;
        margin-bottom: 2px;
        cursor: grab;
        touch-action: none;
      }

      #${WIDGET_ID}.yy-cum-dragging .yy-cum-header {
        cursor: grabbing;
      }

      #${WIDGET_ID} .yy-cum-header-actions {
        display: flex;
        align-items: center;
        gap: 1px;
      }

      #${WIDGET_ID} .yy-cum-collapse-button svg {
        transition: transform 160ms ease;
      }

      #${WIDGET_ID}[data-collapsed="true"] .yy-cum-collapse-button svg {
        transform: rotate(180deg);
      }

      #${WIDGET_ID} .yy-cum-title {
        font-weight: 700;
        letter-spacing: .01em;
        opacity: .88;
      }

      #${WIDGET_ID} .yy-cum-settings-button,
      #${WIDGET_ID} .yy-cum-collapse-button {
        display: inline-grid;
        place-items: center;
        flex: none;
        width: 24px;
        height: 24px;
        margin: -2px -2px -2px 0;
        padding: 0;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        opacity: .66;
        font: inherit;
      }

      #${WIDGET_ID} .yy-cum-settings-button:hover,
      #${WIDGET_ID} .yy-cum-collapse-button:hover,
      #${WIDGET_ID} .yy-cum-settings-button[aria-expanded="true"] {
        background: rgba(127,127,127,.12);
        opacity: .98;
      }

      #${WIDGET_ID} .yy-cum-settings-button svg,
      #${WIDGET_ID} .yy-cum-collapse-button svg {
        width: 16px;
        height: 16px;
        display: block;
      }

      #${WIDGET_ID} .yy-cum-row {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr) 40px 74px;
        align-items: center;
        gap: 6px;
        height: 24px;
        white-space: nowrap;
      }

      #${WIDGET_ID} .yy-cum-label {
        font-weight: 700;
        letter-spacing: .02em;
        opacity: .82;
      }

      #${WIDGET_ID} .yy-cum-track {
        display: block;
        position: relative;
        height: 9px;
        overflow: hidden;
        border-radius: 999px;
        background: color-mix(in srgb, currentColor 14%, transparent);
      }

      @supports not (background: color-mix(in srgb, black 10%, transparent)) {
        #${WIDGET_ID} .yy-cum-track { background: rgba(90,90,90,.16); }
      }

      #${WIDGET_ID} .yy-cum-fill {
        display: block;
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: currentColor;
        opacity: .72;
        transition: width 220ms ease;
      }

      #${WIDGET_ID} .yy-cum-percent {
        text-align: right;
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        opacity: .92;
      }

      #${WIDGET_ID} .yy-cum-reset {
        text-align: right;
        font-variant-numeric: tabular-nums;
        font-weight: 520;
        opacity: .68;
      }

      #${WIDGET_ID} .yy-cum-reset.yy-cum-inactive {
        text-align: center;
      }

      #${WIDGET_ID} .yy-cum-settings-panel {
        position: absolute;
        top: 0;
        left: calc(100% + 8px);
        width: 236px;
        box-sizing: border-box;
        padding: 12px;
        border: 1px solid rgba(0,0,0,.12);
        border-radius: 12px;
        background: rgba(250,250,250,.98);
        color: #181818;
        box-shadow: 0 8px 24px rgba(0,0,0,.16);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        line-height: 1.2;
      }

      /* 设置面板固定从主卡片右侧弹出。两者之间保留 8px 视觉间距，
         用透明命中区横向桥接，避免鼠标穿过缝隙时触发 auto-hide。 */
      #${WIDGET_ID} .yy-cum-settings-panel::before {
        content: "";
        position: absolute;
        left: -9px;
        top: 0;
        bottom: 0;
        width: 9px;
        pointer-events: auto;
      }

      /* 拖动到右边缘附近时，设置面板改从左侧弹出，命中桥接同步镜像。 */
      #${WIDGET_ID}[data-panel-side="left"] .yy-cum-settings-panel {
        left: auto;
        right: calc(100% + 8px);
      }

      #${WIDGET_ID}[data-panel-side="left"] .yy-cum-settings-panel::before {
        left: auto;
        right: -9px;
      }

      /* 手动收纳：折叠成只剩标题条，隐藏额度行 / 模型路由区块 / 设置面板。 */
      #${WIDGET_ID}[data-collapsed="true"] {
        width: auto;
        padding: 8px 10px;
      }

      #${WIDGET_ID}[data-collapsed="true"] .yy-cum-header {
        min-height: 20px;
        margin-bottom: 0;
      }

      #${WIDGET_ID}[data-collapsed="true"] > .yy-cum-row,
      #${WIDGET_ID}[data-collapsed="true"] > .yy-mum-block {
        display: none !important;
      }

      #${WIDGET_ID}[data-collapsed="true"]:not(.yy-cum-settings-open) > .yy-cum-settings-panel {
        display: none !important;
      }

      #${WIDGET_ID}[data-theme="dark"] .yy-cum-settings-panel {
        border-color: rgba(255,255,255,.14);
        background: rgba(36,36,36,.98);
        color: #f2f2f2;
        box-shadow: 0 8px 28px rgba(0,0,0,.42);
      }

      #${WIDGET_ID} .yy-cum-settings-panel[hidden] { display: none; }

      #${WIDGET_ID} .yy-cum-settings-title {
        font-size: 13px;
        font-weight: 700;
        margin-bottom: 9px;
      }

      #${WIDGET_ID} .yy-cum-setting-line {
        display: grid;
        grid-template-columns: 88px 1fr;
        align-items: center;
        gap: 8px;
        min-height: 32px;
      }

      #${WIDGET_ID} .yy-cum-setting-range-line {
        grid-template-columns: 88px 1fr 42px;
      }

      #${WIDGET_ID} .yy-cum-setting-toggle-line {
        grid-template-columns: 1fr auto;
      }

      /* ChatGPT 的宿主样式可能重置原生 checkbox（appearance / opacity / position）。
         这里显式恢复浏览器复选框，避免网页 UI 更新后两个设置开关消失。 */
      #${WIDGET_ID} .yy-cum-setting-toggle-line input[type="checkbox"] {
        -webkit-appearance: checkbox !important;
        appearance: auto !important;
        display: inline-block !important;
        position: static !important;
        inset: auto !important;
        width: 16px !important;
        min-width: 16px !important;
        max-width: 16px !important;
        height: 16px !important;
        min-height: 16px !important;
        max-height: 16px !important;
        margin: 0 !important;
        padding: 0 !important;
        opacity: 1 !important;
        visibility: visible !important;
        transform: none !important;
        clip: auto !important;
        clip-path: none !important;
        pointer-events: auto !important;
        justify-self: end !important;
        align-self: center !important;
        cursor: pointer !important;
        accent-color: auto !important;
      }

      #${WIDGET_ID} .yy-cum-setting-line select,
      #${WIDGET_ID} .yy-cum-setting-line input[type="range"] {
        width: 100%;
      }

      #${WIDGET_ID} .yy-cum-setting-line select {
        height: 27px;
        border: 1px solid rgba(127,127,127,.25);
        border-radius: 7px;
        padding: 0 7px;
        background: rgba(127,127,127,.08);
        color: inherit;
        font: inherit;
      }

      #${WIDGET_ID} .yy-cum-setting-line input[type="color"] {
        width: 44px;
        height: 27px;
        padding: 1px;
        border: 1px solid rgba(127,127,127,.25);
        border-radius: 7px;
        background: transparent;
        cursor: pointer;
      }

      #${WIDGET_ID} .yy-cum-setting-value {
        text-align: right;
        font-variant-numeric: tabular-nums;
        opacity: .7;
      }

      #${WIDGET_ID} .yy-cum-settings-actions {
        display: flex;
        justify-content: flex-end;
        gap: 7px;
        margin-top: 9px;
        padding-top: 9px;
        border-top: 1px solid rgba(127,127,127,.18);
      }

      #${WIDGET_ID} .yy-cum-settings-actions button {
        min-height: 28px;
        border: 1px solid rgba(127,127,127,.24);
        border-radius: 8px;
        padding: 0 9px;
        background: rgba(127,127,127,.08);
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      #${WIDGET_ID} .yy-cum-settings-actions button:hover {
        background: rgba(127,127,127,.15);
      }
    `;
    document.documentElement.appendChild(style);

    const root = document.createElement('div');
    root.id = WIDGET_ID;
    root.className = 'yy-cum-loading';
    root.title = `${t('usageTitle')}。${t('clickRefresh')}`;

    const header = document.createElement('div');
    header.className = 'yy-cum-header';
    header.innerHTML = `
      <span class="yy-cum-title">Work / Codex</span>
      <span class="yy-cum-header-actions">
        <button class="yy-cum-collapse-button" type="button" aria-label="Collapse" aria-expanded="true" title="Collapse">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 15l6-6 6 6"></path>
          </svg>
        </button>
        <button class="yy-cum-settings-button" type="button" aria-label="Display settings" aria-expanded="false" title="Display settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3.15"></circle>
            <path d="M10.32 5.26L10.49 2.98A9.15 9.15 0 0 1 13.51 2.98L13.68 5.26A6.95 6.95 0 0 1 15.58 6.04L17.31 4.55A9.15 9.15 0 0 1 19.45 6.69L17.96 8.42A6.95 6.95 0 0 1 18.74 10.32L21.02 10.49A9.15 9.15 0 0 1 21.02 13.51L18.74 13.68A6.95 6.95 0 0 1 17.96 15.58L19.45 17.31A9.15 9.15 0 0 1 17.31 19.45L15.58 17.96A6.95 6.95 0 0 1 13.68 18.74L13.51 21.02A9.15 9.15 0 0 1 10.49 21.02L10.32 18.74A6.95 6.95 0 0 1 8.42 17.96L6.69 19.45A9.15 9.15 0 0 1 4.55 17.31L6.04 15.58A6.95 6.95 0 0 1 5.26 13.68L2.98 13.51A9.15 9.15 0 0 1 2.98 10.49L5.26 10.32A6.95 6.95 0 0 1 6.04 8.42L4.55 6.69A9.15 9.15 0 0 1 6.69 4.55L8.42 6.04A6.95 6.95 0 0 1 10.32 5.26Z"></path>
          </svg>
        </button>
      </span>
    `;
    root.appendChild(header);
    root.appendChild(row('5h'));
    root.appendChild(row('7d'));

    settingsPanel = buildSettingsPanel();
    root.appendChild(settingsPanel);
    settingsButton = header.querySelector('.yy-cum-settings-button');
    collapseButton = header.querySelector('.yy-cum-collapse-button');

    settingsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const nextOpen = settingsPanel.hidden;
      settingsPanel.hidden = !nextOpen;
      settingsButton.setAttribute('aria-expanded', String(nextOpen));
      root.classList.toggle('yy-cum-settings-open', nextOpen);
      if (nextOpen) { syncSettingsControls(); updatePanelSide(); }
    });

    collapseButton.addEventListener('click', (event) => {
      event.stopPropagation();
      currentSettings.collapsed = !currentSettings.collapsed;
      applySettings();
      saveSettings();
    });

    root.addEventListener('click', (event) => {
      if (suppressClick) { suppressClick = false; return; }
      if (event.target.closest('.yy-cum-settings-button, .yy-cum-collapse-button, .yy-cum-settings-panel')) return;
      root.classList.add('yy-cum-loading');
      requestUsage(true);
    });

    // Header drag: move the fixed card with the pointer, clamped fully inside the viewport.
    const DRAG_START_THRESHOLD = 3;

    header.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.closest('.yy-cum-settings-button, .yy-cum-collapse-button, .yy-cum-settings-panel')) return;
      dragActive = true;
      dragMoved = false;
      dragPointerId = event.pointerId;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      const rect = root.getBoundingClientRect();
      dragStartLeft = rect.left;
      dragStartTop = rect.top;
      try { header.setPointerCapture(event.pointerId); } catch {}
    });

    header.addEventListener('pointermove', (event) => {
      if (!dragActive || event.pointerId !== dragPointerId) return;
      const dx = event.clientX - dragStartX;
      const dy = event.clientY - dragStartY;
      if (!dragMoved && Math.abs(dx) < DRAG_START_THRESHOLD && Math.abs(dy) < DRAG_START_THRESHOLD) return;
      dragMoved = true;
      root.classList.add('yy-cum-dragging');
      const pos = clampPosition(dragStartLeft + dx, dragStartTop + dy);
      root.style.left = `${pos.left}px`;
      root.style.top = `${pos.top}px`;
    });

    const endHeaderDrag = (event) => {
      if (!dragActive || (event && event.pointerId !== dragPointerId)) return;
      dragActive = false;
      try { header.releasePointerCapture(dragPointerId); } catch {}
      dragPointerId = null;
      root.classList.remove('yy-cum-dragging');
      if (!dragMoved) return;
      // Swallow the synthetic click that follows a real drag so it doesn't trigger a refresh.
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      const rect = root.getBoundingClientRect();
      currentSettings.posMode = 'manual';
      currentSettings.posX = Math.round(rect.left);
      currentSettings.posY = Math.round(rect.top);
      saveSettings();
      updatePosition();
    };

    header.addEventListener('pointerup', endHeaderDrag);
    header.addEventListener('pointercancel', endHeaderDrag);

    const cancelAutoHideClose = () => {
      if (!autoHideCloseTimer) return;
      clearTimeout(autoHideCloseTimer);
      autoHideCloseTimer = 0;
    };

    const pointNearRect = (rect, x, y, margin = AUTO_HIDE_MARGIN) =>
      Number.isFinite(x) && Number.isFinite(y) &&
      x >= rect.left - margin && x <= rect.right + margin &&
      y >= rect.top - margin && y <= rect.bottom + margin;

    const pointerNearExpandedWidget = () => {
      if (!Number.isFinite(lastPointerX) || !Number.isFinite(lastPointerY)) return false;
      if (pointNearRect(root.getBoundingClientRect(), lastPointerX, lastPointerY)) return true;
      if (settingsPanel && !settingsPanel.hidden &&
          pointNearRect(settingsPanel.getBoundingClientRect(), lastPointerX, lastPointerY)) return true;
      return false;
    };

    const scheduleAutoHideClose = () => {
      if (!currentSettings.defaultHidden || !settingsPanel || settingsPanel.hidden) return;
      cancelAutoHideClose();
      autoHideCloseTimer = setTimeout(() => {
        autoHideCloseTimer = 0;
        // 视觉缝隙 + 外沿 5px 都算作仍在面板附近。
        if (root.matches(':hover') || settingsPanel.matches(':hover') || pointerNearExpandedWidget()) return;
        settingsPanel.hidden = true;
        settingsButton?.setAttribute('aria-expanded', 'false');
        root.classList.remove('yy-cum-settings-open');
        root.classList.remove('yy-cum-hover-buffer');
      }, 180);
    };

    root.addEventListener('mouseleave', () => {
      if (!currentSettings.defaultHidden) return;
      // CSS 原本会在 :hover 消失的瞬间立刻缩回。先挂住展开态，
      // 等指针真正离开 5px 缓冲区再释放。
      root.classList.add('yy-cum-hover-buffer');
      if (!settingsPanel.hidden) scheduleAutoHideClose();
    });
    root.addEventListener('mouseenter', () => {
      cancelAutoHideClose();
      root.classList.remove('yy-cum-hover-buffer');
    });
    settingsPanel.addEventListener('mouseenter', cancelAutoHideClose);
    settingsPanel.addEventListener('mouseleave', scheduleAutoHideClose);

    document.addEventListener('pointermove', (event) => {
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      if (!currentSettings.defaultHidden) {
        root.classList.remove('yy-cum-hover-buffer');
        return;
      }

      if (root.matches(':hover') || settingsPanel.matches(':hover') || pointerNearExpandedWidget()) {
        cancelAutoHideClose();
        return;
      }

      if (root.classList.contains('yy-cum-hover-buffer')) {
        root.classList.remove('yy-cum-hover-buffer');
      }
      if (!settingsPanel.hidden && !autoHideCloseTimer) scheduleAutoHideClose();
    }, { passive: true });

    (document.body || document.documentElement).appendChild(root);
    widget = root;
    fiveHourValue = root.querySelectorAll('.yy-cum-row')[0];
    weeklyValue = root.querySelectorAll('.yy-cum-row')[1];

    updateTheme();
    applySettings();
    updatePosition();
    render();
    loadSettings();
    return root;
  }

  function setRow(rowEl, windowData, primary = false) {
    const fill = rowEl.querySelector('.yy-cum-fill');
    const percent = rowEl.querySelector('.yy-cum-percent');
    const reset = rowEl.querySelector('.yy-cum-reset');
    const remaining = remainingPercent(windowData);
    const inactive = primary && isPrimaryInactive(windowData);

    reset.classList.toggle('yy-cum-inactive', inactive);

    if (remaining == null) {
      fill.style.width = '0%';
      percent.textContent = '--';
      reset.textContent = '--';
      return;
    }

    fill.style.width = `${remaining}%`;
    percent.textContent = `${Number.isInteger(remaining) ? remaining : remaining.toFixed(1)}%`;
    reset.textContent = formatCountdown(windowData, primary);
  }

  function classifyRateLimitWindows(rateLimit) {
    const windows = [rateLimit?.primary_window, rateLimit?.secondary_window].filter(Boolean);
    let fiveHour = null;
    let weekly = null;

    for (const windowData of windows) {
      const seconds = Number(windowData?.limit_window_seconds);
      if (seconds === 18_000) fiveHour = windowData;
      else if (seconds === 604_800) weekly = windowData;
    }

    // Older responses historically used primary=5h and secondary=7d.
    // Only fall back to slot order when duration metadata is absent altogether.
    const hasDurationMetadata = windows.some((w) => Number.isFinite(Number(w?.limit_window_seconds)));
    if (!hasDurationMetadata) {
      fiveHour = rateLimit?.primary_window || null;
      weekly = rateLimit?.secondary_window || null;
    }

    return { fiveHour, weekly };
  }

  function render() {
    if (!widget || !fiveHourValue || !weeklyValue) return;

    const rateLimit = payload?.rate_limit;
    const { fiveHour, weekly } = classifyRateLimitWindows(rateLimit);
    setRow(fiveHourValue, fiveHour, true);
    setRow(weeklyValue, weekly, false);

    widget.classList.toggle('yy-cum-error', Boolean(lastError && !payload));
    if (payload) {
      widget.classList.remove('yy-cum-loading');
      const plan = payload.plan_type ? ` · ${payload.plan_type}` : '';
      widget.title = `${t('usageTitle')}${plan}. ${t('clickRefresh')}`;
    } else if (lastError) {
      widget.title = `${t('readError')}: ${lastError}\n${t('retry')}`;
    }
  }

  function bodyLooksDark() {
    const target = document.body || document.documentElement;
    const color = getComputedStyle(target).backgroundColor;
    const match = color.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);
    if (!match) return matchMedia('(prefers-color-scheme: dark)').matches;
    const r = Number(match[1]), g = Number(match[2]), b = Number(match[3]);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }

  function updateTheme() {
    if (!widget) return;
    const next = bodyLooksDark() ? 'dark' : 'light';
    if (widget.dataset.theme !== next) {
      widget.dataset.theme = next;
      applySettings();
    }
  }

  function plausibleSidebarRect(rect) {
    return rect &&
      rect.left <= 5 &&
      rect.right > 0 &&
      rect.width >= 40 &&
      rect.width <= Math.min(430, window.innerWidth * 0.45) &&
      rect.height >= window.innerHeight * 0.55;
  }

  function elementLooksVisible(el, rect) {
    if (!el || !rect || !plausibleSidebarRect(rect)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number.parseFloat(style.opacity || '1') <= 0.01) return false;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
    return true;
  }

  // 命中测试必须跳过挂件自己：卡片一旦压在侧栏右边缘上（比如侧栏展开时卡片还停在收起态的位置），
  // elementFromPoint 打到的是卡片，侧栏会被误判为“不可见”，测量失败后卡片就永远停在原地。
  function firstHitOutsideWidget(x, y) {
    try {
      if (typeof document.elementsFromPoint === 'function') {
        for (const hit of document.elementsFromPoint(x, y)) {
          if (!widget || (hit !== widget && !widget.contains(hit))) return hit;
        }
        return null;
      }
      const hit = document.elementFromPoint(x, y);
      return hit && widget && (hit === widget || widget.contains(hit)) ? null : hit;
    } catch { return null; }
  }

  function ownsVisibleRightEdge(el, rect) {
    // ChatGPT 收起侧栏时，DOM 中可能仍保留一个“展开态”的宽侧栏节点。
    // 只接受真正占据屏幕像素的候选，避免挂件继续停在旧的展开位置。
    const x = clamp(Math.floor(rect.right - 2), 1, Math.max(1, window.innerWidth - 2));
    const ys = [0.25, 0.5, 0.75].map((ratio) =>
      clamp(Math.floor(rect.top + rect.height * ratio), 1, Math.max(1, window.innerHeight - 2))
    );

    let owned = 0;
    for (const y of ys) {
      try {
        const hit = firstHitOutsideWidget(x, y);
        if (hit && (hit === el || el.contains(hit))) owned += 1;
      } catch {}
    }
    return owned >= 1;
  }

  function collectSidebarCandidate(el, candidates) {
    if (!el || el === widget || widget?.contains(el)) return;
    const rect = el.getBoundingClientRect?.();
    if (!elementLooksVisible(el, rect)) return;
    if (!ownsVisibleRightEdge(el, rect)) return;
    candidates.push({ el, rect });
  }

  function getSidebarRight() {
    const candidates = [];
    const selectors = [
      '[data-testid="sidebar"]',
      '[data-testid*="sidebar"]',
      'aside',
      'nav'
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => collectSidebarCandidate(el, candidates));
    }

    // 再从屏幕最左侧实际命中的元素向上爬祖先，兼容 ChatGPT 改 class / data-testid。
    for (const y of [96, Math.floor(window.innerHeight / 2), Math.max(96, window.innerHeight - 96)]) {
      try {
        let node = firstHitOutsideWidget(8, y);
        while (node && node !== document.documentElement) {
          collectSidebarCandidate(node, candidates);
          node = node.parentElement;
        }
      } catch {}
    }

    if (!candidates.length) return 0;

    // 相同布局可能被多个祖先重复命中。取最右的“真实可见边界”。
    return Math.max(...candidates.map(({ rect }) => rect.right));
  }

  let sidebarMissCount = 0;

  function clampPosition(left, top) {
    const w = widget ? widget.offsetWidth : 0;
    const h = widget ? widget.offsetHeight : 0;
    const maxLeft = Math.max(VIEWPORT_EDGE_MARGIN, window.innerWidth - w - VIEWPORT_EDGE_MARGIN);
    const maxTop = Math.max(VIEWPORT_EDGE_MARGIN, window.innerHeight - h - VIEWPORT_EDGE_MARGIN);
    return {
      left: Math.round(clamp(left, VIEWPORT_EDGE_MARGIN, maxLeft)),
      top: Math.round(clamp(top, VIEWPORT_EDGE_MARGIN, maxTop))
    };
  }

  function updatePanelSide() {
    if (!widget) return;
    const rect = widget.getBoundingClientRect();
    const need = SETTINGS_PANEL_WIDTH + 16;
    const spaceRight = window.innerWidth - rect.right;
    const spaceLeft = rect.left;
    widget.dataset.panelSide = (spaceRight < need && spaceLeft > spaceRight) ? 'left' : 'right';
  }

  function updatePosition() {
    if (!widget || dragActive) return;

    if (currentSettings.posMode === 'manual') {
      const storedLeft = Number.isFinite(Number(currentSettings.posX)) ? Number(currentSettings.posX) : VIEWPORT_EDGE_MARGIN;
      const storedTop = Number.isFinite(Number(currentSettings.posY)) ? Number(currentSettings.posY) : 10;
      const pos = clampPosition(storedLeft, storedTop);
      widget.style.left = `${pos.left}px`;
      widget.style.top = `${pos.top}px`;
      updatePanelSide();
      return;
    }

    const sidebarRight = getSidebarRight();
    // DOM 瞬时变化导致侧栏测量失败时，先保持当前位置，不要跳回页面最左侧。
    // 但连续几次都测不到（窄窗口下侧栏整个消失），说明侧栏真的不在了，贴回左边。
    if (!(sidebarRight > 0)) {
      sidebarMissCount += 1;
      if (sidebarMissCount >= 3) widget.style.left = '12px';
      updatePanelSide();
      return;
    }
    sidebarMissCount = 0;
    const left = Math.round(sidebarRight + 12);
    widget.style.left = `${left}px`;
    widget.style.removeProperty('top');
    updatePanelSide();
  }

  function requestUsage(force = false) {
    window.postMessage({
      source: 'yy-codex-usage-widget',
      type: MESSAGE_REQUEST,
      force
    }, '*');
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'yy-codex-usage-meter') return;

    if (data.type === MESSAGE_DATA && data.payload) {
      payload = data.payload;
      lastError = '';
      buildWidget();
      render();
    }

    if (data.type === MESSAGE_ERROR) {
      lastError = data.message || 'unknown error';
      buildWidget();
      render();
    }
  });

  function closeSettingsIfOutside(event) {
    if (!settingsPanel || settingsPanel.hidden || !widget) return;
    if (widget.contains(event.target)) return;
    settingsPanel.hidden = true;
    settingsButton?.setAttribute('aria-expanded', 'false');
    widget.classList.remove('yy-cum-settings-open');
  }

  function init() {
    buildWidget();
    requestUsage(false);

    window.addEventListener('resize', updatePosition, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        updatePosition();
        updateTheme();
        requestUsage(false);
      }
    });

    document.addEventListener('pointerdown', closeSettingsIfOutside, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && settingsPanel && !settingsPanel.hidden) {
        settingsPanel.hidden = true;
        settingsButton?.setAttribute('aria-expanded', 'false');
        widget?.classList.remove('yy-cum-settings-open');
      }
    });

    // ChatGPT 是 SPA。侧栏展开/收起时监听 DOM/class 变化，下一帧立即贴到新边界；
    // 另外保留低频兜底校正，应对布局动画或未来 DOM 调整。
    let positionRaf = 0;
    const schedulePositionUpdate = () => {
      if (positionRaf) return;
      positionRaf = requestAnimationFrame(() => {
        positionRaf = 0;
        updatePosition();
      });
    };

    const layoutObserver = new MutationObserver(schedulePositionUpdate);
    layoutObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-state', 'aria-expanded']
    });

    setInterval(updatePosition, 2_000);
    setInterval(updateTheme, 3_000);

    // reset 倒计时只在本地按分钟推进，不增加服务器请求。
    setInterval(render, 30_000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
