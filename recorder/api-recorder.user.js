// ==UserScript==
// @name         QM-Testing API Recorder
// @namespace    http://qm-testing.local
// @version      2.0.0
// @description  浏览器 API 录制工具 — 悬浮面板控制，支持跨页签录制（页签=浏览器Tab），导出 JSON 供 QM-Testing 管道处理
// @author       QM-Testing
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_download
// @grant        unsafeWindow
// @grant        GM_listValues
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
   *  §1  配置
   * ═══════════════════════════════════════════════════════════════════ */
  const CONFIG = {
    storageKey: 'qm_recording_data',
    maxRecordsPerTab: 2000,
    noisePatterns: [
      /datacollect/i, /collect/i, /analytics/i, /monitor/i, /sentry/i,
      /\.(css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)\b/i,
      /heartbeat/i, /ping/i, /alive/i, /healthz/i, /__webpack/i,
      /hmr/i, /hot-update/i, /sockjs/i, /livereload/i,
    ],
  };

  /* ═══════════════════════════════════════════════════════════════════
   *  §2  状态管理
   * ═══════════════════════════════════════════════════════════════════ */
  const RECORDING_KEY = 'qm_recording_active';
  const SCENARIO_KEY = 'qm_scenario_name';
  const TAB_PREFIX = 'qm_tab_';

  const tabId = Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);

  const state = {
    recording: false,
    records: [],
    scenarioName: '',
    tabId: tabId,
    menuIds: [],
    activeTabs: {},
  };

  /* ═══════════════════════════════════════════════════════════════════
   *  §3  工具函数
   * ═══════════════════════════════════════════════════════════════════ */
  function now() { return new Date().toISOString(); }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }

  function isNoise(url) {
    return CONFIG.noisePatterns.some(p => p.test(url));
  }

  function truncateBody(body, maxLen = 1024 * 100) {
    if (!body) return body;
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    return s.length > maxLen ? s.slice(0, maxLen) + '... [truncated]' : s;
  }

  function getTabStorageKey() { return TAB_PREFIX + tabId; }

  // 计算所有页签的总记录数（用于 UI 显示）
  function computeTotalRecords() {
    try {
      let total = 0;
      // 优先从 GM 持久化数据中汇总所有页签的记录数
      if (typeof GM_listValues === 'function') {
        const keys = GM_listValues();
        keys.forEach(key => {
          if (key.startsWith(TAB_PREFIX)) {
            try {
              const raw = GM_getValue(key, '');
              if (raw) {
                const data = JSON.parse(raw);
                total += data.count || (data.records ? data.records.length : 0);
              }
            } catch {}
          }
        });
      }
      total = Math.max(total, state.records.length);
      return total;
    } catch {
      return state.records.length;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  §4  跨页签状态同步
   * ═══════════════════════════════════════════════════════════════════ */
  function readSharedFlag() {
    try { return !!GM_getValue(RECORDING_KEY, false); } catch { return false; }
  }

  function writeSharedFlag(val) {
    try { GM_setValue(RECORDING_KEY, val); } catch {}
  }

  function readScenarioName() {
    try { return GM_getValue(SCENARIO_KEY, ''); } catch { return ''; }
  }

  function writeScenarioName(name) {
    try { GM_setValue(SCENARIO_KEY, name); } catch {}
  }

  function readActiveTabs() {
    try {
      const raw = GM_getValue('qm_active_tabs', '{}');
      return JSON.parse(raw);
    } catch { return {}; }
  }

  function writeActiveTabs(tabs) {
    try { GM_setValue('qm_active_tabs', JSON.stringify(tabs)); } catch {}
  }

  function registerThisTab() {
    const tabs = readActiveTabs();
    // 移除本主机下过期的页签引用，但保留持久化数据（不影响跨页签总数统计）
    Object.keys(tabs).forEach(id => {
      if (tabs[id].host === location.hostname && id !== tabId) {
        delete tabs[id];
      }
    });
    tabs[tabId] = {
      url: location.href,
      host: location.hostname,
      startedAt: now(),
      recordCount: 0,
    };
    writeActiveTabs(tabs);
  }

  function unregisterThisTab() {
    const tabs = readActiveTabs();
    delete tabs[tabId];
    writeActiveTabs(tabs);
    try { GM_deleteValue(getTabStorageKey()); } catch {}
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  §5  持久化（当前页签的录制数据）
   * ═══════════════════════════════════════════════════════════════════ */
  function persistRecords() {
    try {
      GM_setValue(getTabStorageKey(), JSON.stringify({
        tabId: tabId,
        host: location.hostname,
        url: location.href,
        count: state.records.length,
        records: state.records.slice(-CONFIG.maxRecordsPerTab),
      }));
      // 更新活动页签的记录数
      const tabs = readActiveTabs();
      if (tabs[tabId]) {
        tabs[tabId].recordCount = state.records.length;
        writeActiveTabs(tabs);
      }
    } catch (e) {
      console.warn('[QM-Recorder] 持久化失败:', e);
    }
  }

  let persistTimer = null;
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistRecords, 500);
  }

  function loadPersistedRecords() {
    try {
      const raw = GM_getValue(getTabStorageKey(), '');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.records && Array.isArray(data.records)) {
          state.records = data.records;
        }
      }
    } catch { /* ignore */ }
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  §6  核心录制逻辑（XHR + Fetch 拦截）
   * ═══════════════════════════════════════════════════════════════════ */
  function recordRequest(detail) {
    if (!state.recording) return;
    if (isNoise(detail.url)) return;

    const record = {
      seq: state.records.length + 1,
      id: generateId(),
      tabId: tabId,
      tabHost: location.hostname,
      time: now(),
      method: detail.method,
      url: detail.url,
      status: detail.status || 0,
      statusText: detail.statusText || '',
      requestHeaders: detail.requestHeaders || {},
      requestBody: detail.requestBody !== undefined ? truncateBody(detail.requestBody) : undefined,
      responseHeaders: detail.responseHeaders || {},
      responseBody: detail.responseBody !== undefined ? truncateBody(detail.responseBody) : undefined,
      contentType: detail.contentType || '',
      timestamp: Date.now(),
    };

    state.records.push(record);
    updateUI();
    schedulePersist();
  }

  // ----- XHR 拦截 -----
  function hookXHR() {
    const OrigXHR = unsafeWindow.XMLHttpRequest;
    if (OrigXHR.__qm_hooked) return;
    unsafeWindow.XMLHttpRequest = function () {
      const xhr = new OrigXHR();
      const reqInfo = { url: '', method: '', requestHeaders: {}, requestBody: undefined };

      const origOpen = xhr.open.bind(xhr);
      xhr.open = function (method, url) {
        reqInfo.method = method;
        try { reqInfo.url = new URL(url, location.href).href; } catch { reqInfo.url = url; }
        return origOpen(method, url, ...Array.from(arguments).slice(2));
      };

      const origSetReqHeader = xhr.setRequestHeader.bind(xhr);
      xhr.setRequestHeader = function (name, value) {
        reqInfo.requestHeaders[name] = value;
        return origSetReqHeader(name, value);
      };

      const origSend = xhr.send.bind(xhr);
      xhr.send = function (body) {
        reqInfo.requestBody = body;
        xhr.addEventListener('readystatechange', function () {
          if (xhr.readyState === 4) {
            recordRequest({
              method: reqInfo.method,
              url: reqInfo.url,
              status: xhr.status,
              statusText: xhr.statusText,
              requestHeaders: reqInfo.requestHeaders,
              requestBody: reqInfo.requestBody,
              responseHeaders: parseResponseHeaders(xhr.getAllResponseHeaders()),
              responseBody: safeParseJSON(xhr.responseText),
              contentType: xhr.getResponseHeader('content-type') || '',
            });
          }
        });
        return origSend(body);
      };

      return xhr;
    };
    unsafeWindow.XMLHttpRequest.__qm_hooked = true;
    Object.keys(OrigXHR).forEach(k => { unsafeWindow.XMLHttpRequest[k] = OrigXHR[k]; });
    unsafeWindow.XMLHttpRequest.prototype = OrigXHR.prototype;
  }

  // ----- Fetch 拦截 -----
  function hookFetch() {
    const origFetch = unsafeWindow.fetch;
    if (origFetch.__qm_hooked) return;
    unsafeWindow.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input.url || input);
      const method = (init && init.method) || 'GET';

      const reqHeaders = {};
      const headers = (init && init.headers) || {};
      if (headers instanceof Headers) {
        headers.forEach((v, k) => { reqHeaders[k] = v; });
      } else if (Array.isArray(headers)) {
        headers.forEach(([k, v]) => { reqHeaders[k] = v; });
      } else if (typeof headers === 'object') {
        Object.assign(reqHeaders, headers);
      }

      return origFetch.call(unsafeWindow, input, init).then(async response => {
        const cloned = response.clone();
        let responseBody = null;
        let contentType = cloned.headers.get('content-type') || '';
        try {
          if (contentType.includes('json')) {
            responseBody = await cloned.json();
          } else if (contentType.includes('text') || contentType.includes('html') || contentType.includes('xml')) {
            responseBody = await cloned.text();
          } else {
            responseBody = await cloned.text();
          }
        } catch { responseBody = '(unable to read body)'; }

        const respHeaders = {};
        cloned.headers.forEach((v, k) => { respHeaders[k] = v; });

        recordRequest({
          method: method,
          url: typeof url === 'string' ? (url.startsWith('http') ? url : new URL(url, location.href).href) : url,
          status: response.status,
          statusText: response.statusText,
          requestHeaders: reqHeaders,
          requestBody: init && init.body ? truncateBody(init.body) : undefined,
          responseHeaders: respHeaders,
          responseBody: responseBody,
          contentType: contentType,
        });
        return response;
      }).catch(err => {
        console.warn('[QM-Recorder] fetch error:', err);
        throw err;
      });
    };
    unsafeWindow.fetch.__qm_hooked = true;
  }

  // ----- 辅助函数 -----
  function parseResponseHeaders(headerStr) {
    if (!headerStr) return {};
    const headers = {};
    headerStr.split('\r\n').forEach(line => {
      const idx = line.indexOf(':');
      if (idx > 0) {
        headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    });
    return headers;
  }

  function safeParseJSON(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  §7  录制控制
   * ═══════════════════════════════════════════════════════════════════ */
  function startRecording(scenarioName) {
    if (!scenarioName) {
      scenarioName = state.scenarioName || `API录制_${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')}_${String(new Date().getHours()).padStart(2,'0')}${String(new Date().getMinutes()).padStart(2,'0')}${String(new Date().getSeconds()).padStart(2,'0')}`;
    }
    // 清理所有旧的页签缓存数据，确保新录制会话从干净状态开始
    // 跨页签录制时其他页签通过 GM_addValueChangeListener 同步，不依赖历史持久化数据
    try {
      const keys = typeof GM_listValues === 'function' ? GM_listValues() : [];
      keys.forEach(key => {
        if (key.startsWith(TAB_PREFIX)) { try { GM_deleteValue(key); } catch {} }
      });
    } catch {}
    try { GM_deleteValue('qm_active_tabs'); } catch {}
    try { GM_deleteValue(getTabStorageKey()); } catch {}
    state.recording = true;
    state.records = [];
    state.scenarioName = scenarioName;
    writeScenarioName(scenarioName);
    writeSharedFlag(true);
    registerThisTab();
    updateUI();
    persistRecords();
    console.log(`[QM-Recorder] ▶ 开始录制 | 场景: ${scenarioName} | 页签: ${tabId}`);
  }

  function stopRecording() {
    if (!state.recording) return;
    state.recording = false;
    persistRecords();
    writeSharedFlag(false);
    updateUI();
    console.log(`[QM-Recorder] ⏹ 停止录制 | 页签: ${tabId} | 记录: ${state.records.length}`);
  }

  function toggleRecording() {
    if (state.recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  §8  导出
   * ═══════════════════════════════════════════════════════════════════ */
  function collectAllRecords() {
    const allRecords = [];
    const tabSources = [];

    try {
      const keys = typeof GM_listValues === 'function' ? GM_listValues() : [];
      keys.forEach(key => {
        if (key.startsWith(TAB_PREFIX)) {
          try {
            const raw = GM_getValue(key, '');
            if (raw) {
              const data = JSON.parse(raw);
              if (data.records && Array.isArray(data.records)) {
                allRecords.push(...data.records);
                tabSources.push({ tabId: data.tabId, host: data.host, count: data.records.length });
              }
            }
          } catch { /* skip corrupted */ }
        }
      });
    } catch {
      // 如果 GM_listValues 不可用，至少使用当前页签的数据
      allRecords.push(...state.records);
      tabSources.push({ tabId: tabId, host: location.hostname, count: state.records.length });
    }

    // 如果 GM_listValues 没有返回任何内容（回退）
    if (allRecords.length === 0 && state.records.length > 0) {
      allRecords.push(...state.records);
      tabSources.push({ tabId: tabId, host: location.hostname, count: state.records.length });
    }

    // 按时间排序
    allRecords.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // 重新编号
    allRecords.forEach((r, i) => { r.seq = i + 1; });

    return { records: allRecords, tabSources };
  }
  
  /** 清除录制内部字段（导出时去掉无关元数据）*/
  function stripInternalFields(records) {
    const INTERNAL_FIELDS = ['tabId', 'tabHost', 'id'];
    return records.map(r => {
      const cleaned = { ...r };
      INTERNAL_FIELDS.forEach(f => delete cleaned[f]);
      return cleaned;
    });
  }
  
  function buildExportData() {
    const { records: rawRecords, tabSources } = collectAllRecords();
    const records = stripInternalFields(rawRecords);

    // 从 URL 推断环境信息
    const domains = {};
    records.forEach(r => {
      try {
        const u = new URL(r.url);
        domains[u.origin] = (domains[u.origin] || 0) + 1;
      } catch {}
    });
    const sortedDomains = Object.entries(domains).sort((a, b) => b[1] - a[1]);

    // 检测认证方式
    let authType = 'none';
    for (const r of records) {
      const h = r.requestHeaders || {};
      if (h['Authorization']) { authType = h['Authorization'].startsWith('Basic ') ? 'basic' : 'token'; break; }
      if (h['X-XSRF-TOKEN'] || h['X-CSRF-TOKEN'] || h['X-Token']) { authType = 'token'; break; }
      if (h['Cookie'] && (h['Cookie'].includes('session') || h['Cookie'].includes('token') || h['Cookie'].includes('sid'))) { authType = 'cookie'; break; }
    }

    return {
      scenarioName: readScenarioName() || state.scenarioName,
      exportedAt: now(),
      sourceUrl: location.href,
      recordingTabs: tabSources,
      environment: {
        baseURL: sortedDomains.length > 0 ? sortedDomains[0][0] : '',
        authType: authType,
        domains: sortedDomains.map(([d, c]) => ({ domain: d, count: c })),
      },
      records: records,
      metadata: {
        createdAt: records[0]?.time || now(),
        tags: ['qm-recorder'],
        totalRecords: records.length,
        tabCount: tabSources.length,
      },
    };
  }

  function exportJSON() {
    const { records } = collectAllRecords();
    if (records.length === 0) { showToast('没有录制数据可导出', 'warning'); return; }
    const data = buildExportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qm-recording_${(data.scenarioName || '录制数据').replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${records.length} 条记录`, 'success');
  }

  function exportToClipboard() {
    const { records } = collectAllRecords();
    if (records.length === 0) { showToast('没有录制数据可导出', 'warning'); return; }
    const data = buildExportData();
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      showToast(`已复制 ${records.length} 条记录`, 'success');
    }).catch(() => {
      showToast('复制失败', 'error');
    });
  }

  function clearAllData() {
    if (state.records.length === 0) { showToast('没有数据', 'warning'); return; }
    if (!confirm('确定清除所有录制数据？（所有页签的数据将被删除）')) return;
    state.records = [];
    try {
      const keys = typeof GM_listValues === 'function' ? GM_listValues() : [];
      keys.forEach(key => {
        if (key.startsWith(TAB_PREFIX)) { try { GM_deleteValue(key); } catch {} }
      });
    } catch {}
    try { GM_deleteValue(getTabStorageKey()); } catch {}
    try { GM_deleteValue(RECORDING_KEY); } catch {}
    try { GM_deleteValue(SCENARIO_KEY); } catch {}
    try { GM_deleteValue('qm_active_tabs'); } catch {}
    unregisterThisTab();
    updateUI();
    showToast('数据已清除', 'info');
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  §9  悬浮 UI 面板
   * ═══════════════════════════════════════════════════════════════════ */
  let panel = null;
  let pill = null;
  let expanded = false;

  // ----- 样式注入 -----
  function injectStyles() {
    const style = document.createElement('style');
    style.setAttribute('data-qm-recorder', 'true');
    style.textContent = `
      /* ─── 悬浮药丸按钮 ─── */
      #qm-recorder-pill {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid #334155;
        border-radius: 100px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        cursor: pointer;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        font-size: 13px;
        color: #e2e8f0;
        user-select: none;
        transition: all 0.2s ease;
      }
      #qm-recorder-pill:hover {
        border-color: #6366f1;
        box-shadow: 0 4px 24px rgba(99,102,241,0.3);
        transform: translateY(-1px);
      }
      #qm-recorder-pill .qm-pill-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #64748b;
        flex-shrink: 0;
        transition: all 0.3s ease;
      }
      #qm-recorder-pill .qm-pill-dot.active {
        background: #22c55e;
        box-shadow: 0 0 8px rgba(34,197,94,0.6);
        animation: pillPulse 2s infinite;
      }
      #qm-recorder-pill .qm-pill-count {
        background: #334155;
        border-radius: 10px;
        padding: 1px 8px;
        font-size: 11px;
        font-weight: 600;
        color: #94a3b8;
        min-width: 20px;
        text-align: center;
      }
      #qm-recorder-pill .qm-pill-count.has-data {
        background: #6366f1;
        color: #fff;
      }
      #qm-recorder-pill .qm-pill-label {
        font-size: 12px;
        color: #94a3b8;
      }
      @keyframes pillPulse {
        0%, 100% { box-shadow: 0 0 8px rgba(34,197,94,0.4); }
        50% { box-shadow: 0 0 16px rgba(34,197,94,0.8); }
      }

      /* ─── 主面板 ─── */
      #qm-recorder-panel {
        position: fixed;
        bottom: 80px;
        right: 24px;
        width: 400px;
        max-height: 560px;
        z-index: 2147483647;
        background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid #334155;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        font-size: 13px;
        color: #e2e8f0;
        display: none;
        overflow: hidden;
        flex-direction: column;
        transition: all 0.3s ease;
      }
      #qm-recorder-panel.expanded {
        display: flex;
      }

      /* ─── Header ─── */
      #qm-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: linear-gradient(135deg, #1e293b, #0f172a);
        border-bottom: 1px solid #334155;
        cursor: move;
        user-select: none;
        flex-shrink: 0;
      }
      #qm-panel-header .qm-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #qm-panel-header .qm-header-title {
        font-weight: 700;
        font-size: 14px;
        background: linear-gradient(135deg, #6366f1, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      #qm-panel-header .qm-header-badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        background: #334155;
        color: #94a3b8;
      }
      #qm-panel-header .qm-header-badge.recording {
        background: #166534;
        color: #86efac;
      }
      #qm-panel-header .qm-header-close {
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: #64748b;
        font-size: 18px;
        cursor: pointer;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      #qm-panel-header .qm-header-close:hover {
        background: #334155;
        color: #f1f5f9;
      }

      /* ─── Body ─── */
      #qm-panel-body {
        padding: 12px 16px;
        overflow-y: auto;
        flex: 1;
      }

      /* ─── Controls ─── */
      .qm-controls {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }
      .qm-controls button {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        border: 1px solid #334155;
        border-radius: 8px;
        background: #1e293b;
        color: #e2e8f0;
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
      }
      .qm-controls button:hover {
        background: #334155;
        border-color: #475569;
      }
      .qm-controls button.primary {
        background: #6366f1;
        border-color: #6366f1;
        color: #fff;
      }
      .qm-controls button.primary:hover {
        background: #4f46e5;
      }
      .qm-controls button.danger {
        color: #f87171;
      }
      .qm-controls button.danger:hover {
        background: #7f1d1d;
        border-color: #ef4444;
        color: #fca5a5;
      }
      .qm-controls button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* ─── Scenario Name ─── */
      .qm-scenario-row {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        align-items: center;
      }
      .qm-scenario-row input {
        flex: 1;
        padding: 6px 12px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 6px;
        color: #e2e8f0;
        font-size: 13px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
      }
      .qm-scenario-row input:focus {
        border-color: #6366f1;
      }
      .qm-scenario-row input::placeholder {
        color: #64748b;
      }

      /* ─── Stats ─── */
      .qm-stats {
        display: flex;
        gap: 12px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }
      .qm-stat-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: #1e293b;
        border-radius: 6px;
        font-size: 12px;
        color: #94a3b8;
      }
      .qm-stat-item .qm-stat-value {
        font-weight: 700;
        color: #e2e8f0;
        font-size: 14px;
      }

      /* ─── Actions ─── */
      .qm-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
      }
      .qm-actions button {
        padding: 6px 14px;
        border: 1px solid #334155;
        border-radius: 6px;
        background: #1e293b;
        color: #e2e8f0;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .qm-actions button:hover {
        background: #334155;
      }
      .qm-actions button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      /* ─── 响应式适配 ─── */
      @media (max-width: 480px) {
        #qm-recorder-panel {
          right: 8px;
          left: 8px;
          bottom: 72px;
          width: auto;
          max-height: 70vh;
        }
        #qm-recorder-pill {
          right: 12px;
          bottom: 16px;
          padding: 6px 12px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ----- 创建悬浮药丸 -----
  function createPill() {
    if (pill) return;
    pill = document.createElement('div');
    pill.id = 'qm-recorder-pill';
    pill.title = 'QM-Testing API 录制器';
    pill.innerHTML = `
      <span class="qm-pill-dot" id="qm-pill-dot"></span>
      <span class="qm-pill-label" id="qm-pill-label">录制器</span>
      <span class="qm-pill-count" id="qm-pill-count">0</span>
    `;
    pill.addEventListener('click', toggleExpand);
    document.body.appendChild(pill);
  }

  // ----- 创建主面板 -----
  function createPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'qm-recorder-panel';

    // Header
    const header = document.createElement('div');
    header.id = 'qm-panel-header';
    header.innerHTML = `
      <div class="qm-header-left">
        <span class="qm-header-title">QM-Testing 录制器</span>
        <span class="qm-header-badge" id="qm-header-badge">已停止</span>
      </div>
      <button class="qm-header-close" id="qm-panel-close" title="关闭">✕</button>
    `;

    // Body
    const body = document.createElement('div');
    body.id = 'qm-panel-body';
    body.innerHTML = `
      <!-- 场景名称 -->
      <div class="qm-scenario-row">
        <input type="text" id="qm-scenario-input" placeholder="输入场景名称..." maxlength="50" />
      </div>

      <!-- 控制按钮 -->
      <div class="qm-controls">
        <button class="primary" id="qm-btn-rec-toggle">▶ 开始录制</button>
        <button class="danger" id="qm-btn-clear">🗑 清空</button>
      </div>

      <!-- 接口数量统计 -->
      <div class="qm-stats">
        <div class="qm-stat-item">
          <span>📡</span>
          <span>已录制 </span>
          <span class="qm-stat-value" id="qm-stat-count">0</span>
          <span>接口</span>
        </div>
      </div>

      <!-- 导出操作 -->
      <div class="qm-actions">
        <button id="qm-btn-export">💾 导出 JSON</button>
        <button id="qm-btn-copy">📋 复制</button>
      </div>
    `;

    panel.append(header, body);
    document.body.appendChild(panel);

    // ─── 事件绑定 ───
    panel.querySelector('#qm-btn-rec-toggle').addEventListener('click', toggleRecording);
    panel.querySelector('#qm-btn-clear').addEventListener('click', clearAllData);
    panel.querySelector('#qm-btn-export').addEventListener('click', exportJSON);
    panel.querySelector('#qm-btn-copy').addEventListener('click', exportToClipboard);
    panel.querySelector('#qm-panel-close').addEventListener('click', () => collapsePanel());

    // 场景名称输入
    const scenarioInput = panel.querySelector('#qm-scenario-input');
    scenarioInput.addEventListener('change', function () {
      if (this.value.trim()) {
        state.scenarioName = this.value.trim();
        writeScenarioName(state.scenarioName);
      }
    });
    // 恢复场景名称
    const savedName = readScenarioName();
    if (savedName) {
      state.scenarioName = savedName;
      scenarioInput.value = savedName;
    }

    // ─── 拖拽 ───
    makeDraggable(panel, panel.querySelector('#qm-panel-header'));
  }

  // ----- 展开/折叠 -----
  function toggleExpand() {
    expanded = !expanded;
    if (expanded) {
      if (!panel) createPanel();
      panel.classList.add('expanded');
      updateUI();
    } else {
      collapsePanel();
    }
  }

  function collapsePanel() {
    expanded = false;
    if (panel) panel.classList.remove('expanded');
  }

  // ----- 拖拽 -----
  function makeDraggable(el, handle) {
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', dragMouseDown);

    function dragMouseDown(e) {
      if (e.target.closest('.qm-header-close')) return;
      e.preventDefault();
      x1 = e.clientX;
      y1 = e.clientY;
      document.addEventListener('mouseup', closeDrag);
      document.addEventListener('mousemove', drag);
    }

    function drag(e) {
      e.preventDefault();
      x2 = x1 - e.clientX;
      y2 = e.clientY - y1;
      x1 = e.clientX;
      y1 = e.clientY;
      el.style.top = (el.offsetTop - y2) + 'px';
      el.style.left = (el.offsetLeft - x2) + 'px';
      el.style.bottom = 'auto';
      el.style.right = 'auto';
    }

    function closeDrag() {
      document.removeEventListener('mouseup', closeDrag);
      document.removeEventListener('mousemove', drag);
    }
  }

  // ----- UI 更新 -----
  function updateUI() {
    try {
    // 更新药丸
    updatePillUI();

    if (!panel) return;

    // Header badge
    const badge = panel.querySelector('#qm-header-badge');
    badge.textContent = state.recording ? '● 录制中' : '已停止';
    badge.className = 'qm-header-badge' + (state.recording ? ' recording' : '');

    // Toggle button
    const recBtn = panel.querySelector('#qm-btn-rec-toggle');
    recBtn.textContent = state.recording ? '⏹ 停止录制' : '▶ 开始录制';
    recBtn.className = state.recording ? 'danger' : 'primary';

    // Count - 接口数量统计
    panel.querySelector('#qm-stat-count').textContent = state.records.length;

    // Scenario name
    const scenarioInput = panel.querySelector('#qm-scenario-input');
    if (!scenarioInput.value && state.scenarioName) {
      scenarioInput.value = state.scenarioName;
    }
    } catch (e) {
      console.warn('[QM-Recorder] UI更新失败:', e);
    }
  }

  function updatePillUI() {
    try {
    if (!pill) return;
    const dot = pill.querySelector('#qm-pill-dot');
    const label = pill.querySelector('#qm-pill-label');
    const count = pill.querySelector('#qm-pill-count');

    dot.className = 'qm-pill-dot' + (state.recording ? ' active' : '');
    label.textContent = state.recording ? '录制中' : '录制器';
    const totalRecords = computeTotalRecords();
    count.textContent = state.records.length;
    count.title = totalRecords > state.records.length
      ? '当前页签 ' + state.records.length + ' 条，总计 ' + totalRecords + ' 条'
      : '共 ' + state.records.length + ' 条记录';
    count.className = 'qm-pill-count' + (state.records.length > 0 ? ' has-data' : '');
    } catch (e) {
      console.warn('[QM-Recorder] 药丸更新失败:', e);
    }
  }



  /* ═══════════════════════════════════════════════════════════════════
   *  §10  Toast 通知
   * ═══════════════════════════════════════════════════════════════════ */
  let toastTimer = null;

  function showToast(message, type) {
    const existing = document.getElementById('qm-recorder-toast');
    if (existing) existing.remove();

    const colors = {
      success: '#22c55e',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#6366f1',
    };

    const toast = document.createElement('div');
    toast.id = 'qm-recorder-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '80px',
      right: '24px',
      zIndex: 2147483647,
      padding: '10px 20px',
      background: '#1e293b',
      border: `1px solid ${colors[type] || colors.info}`,
      borderRadius: '8px',
      color: '#e2e8f0',
      fontSize: '13px',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      transition: 'all 0.3s ease',
      opacity: '0',
      transform: 'translateY(8px)',
    });
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  §11  油猴菜单
   * ═══════════════════════════════════════════════════════════════════ */
  function registerMenu() {
    state.menuIds.forEach(id => { try { GM_unregisterMenuCommand(id); } catch {} });
    state.menuIds = [];

    state.menuIds.push(GM_registerMenuCommand('🎬 ' + (state.recording ? '⏹ 停止录制' : '▶ 开始录制'), toggleRecording));
    state.menuIds.push(GM_registerMenuCommand('📂 切换录制面板', toggleExpand));
    state.menuIds.push(GM_registerMenuCommand('💾 导出 JSON', exportJSON));
    state.menuIds.push(GM_registerMenuCommand('📋 复制到剪贴板', exportToClipboard));
    state.menuIds.push(GM_registerMenuCommand('🗑 清除数据', clearAllData));
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  §12  跨页签状态监听
   * ═══════════════════════════════════════════════════════════════════ */
  let initByCrossTab = false;

  function setupCrossTabSync() {
    try {
      GM_addValueChangeListener(RECORDING_KEY, function (name, oldVal, newVal) {
        const active = newVal === true || newVal === 'true' || newVal === true;
        if (active && !state.recording) {
          // 另一个页签开始了录制，跟随
          initByCrossTab = true;
          state.recording = true;
          state.records = [];
          state.scenarioName = readScenarioName();
          registerThisTab();
          updateUI();
          console.log('[QM-Recorder] 跨页签同步: 开始录制');
          if (expanded) updateUI();
        } else if (!active && state.recording && !initByCrossTab) {
          // 不是自己发起的停止（另一个页签停止了）
          state.recording = false;
          persistRecords();
          updateUI();
          console.log('[QM-Recorder] 跨页签同步: 停止录制');
        }
        initByCrossTab = false;
      });
    } catch (e) {
      console.warn('[QM-Recorder] 跨页签监听初始化失败:', e);
    }

    // 定期同步活动页签（处理页签关闭）
    setInterval(() => {
      if (state.recording) {
        persistRecords();
        registerThisTab();
      }
    }, 5000);
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  §13  初始化
   * ═══════════════════════════════════════════════════════════════════ */
  function init() {
    // 恢复录制状态
    const wasRecording = readSharedFlag();
    if (wasRecording) {
      state.recording = true;
      state.scenarioName = readScenarioName();
      loadPersistedRecords();
      registerThisTab();
    }

    // 注入拦截器
    // 清理其他主机的孤立页签数据：只清理非当前主机的过期数据，保护当前录制会话
    try {
      const activeTabs = readActiveTabs();
      const currentDomain = location.hostname;
      const keys = typeof GM_listValues === 'function' ? GM_listValues() : [];
      keys.forEach(key => {
        if (key.startsWith(TAB_PREFIX)) {
          try {
            const raw = GM_getValue(key, '');
            if (raw) {
              const data = JSON.parse(raw);
              // 仅在非录制状态下清理跨域孤立数据（录制中保留跨域数据以支持域名跳转）
              if (!state.recording && data.tabId && !activeTabs[data.tabId] && data.host !== currentDomain) {
                GM_deleteValue(key);
              }
            }
          } catch {}
        }
      });
    } catch {}

    // 注入拦截器
    hookXHR();
    hookFetch();

    // 注入 UI
    injectStyles();
    createPill();
    updatePillUI();

    // 跨页签同步
    setupCrossTabSync();

    // 菜单
    registerMenu();

    console.log(`[QM-Recorder] 已加载 | v2.0.0 | 页签: ${tabId} | 状态: ${state.recording ? '录制中' : '已停止'} | 缓存: ${state.records.length} 条`);
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
