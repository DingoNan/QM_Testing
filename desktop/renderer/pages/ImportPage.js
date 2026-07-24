// ImportPage.js - 导入录制 + 编辑器
// 支持场景编辑、接口删除与修改、批量操作

// 浏览器端 HAR 解析（用于非 Electron 环境拖拽导入）
function parseHarToScenariosInBrowser(harData) {
  const log = harData.log;
  if (!log || !Array.isArray(log.entries)) {
    throw new Error('无效的 HAR 文件：缺少 log.entries');
  }

  const SKIP_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'media']);
  const records = [];

  for (let i = 0; i < log.entries.length; i++) {
    const entry = log.entries[i];
    if (!entry.request || !entry.request.url) continue;

    const resourceType = entry._resourceType || '';
    if (resourceType && SKIP_TYPES.has(resourceType)) continue;

    const req = entry.request;
    const res = entry.response || {};
    if (!req.url.startsWith('http')) continue;

    const requestHeaders = {};
    if (Array.isArray(req.headers)) {
      req.headers.forEach(h => { if (h.name) requestHeaders[h.name] = h.value; });
    }
    const responseHeaders = {};
    if (Array.isArray(res.headers)) {
      res.headers.forEach(h => { if (h.name) responseHeaders[h.name] = h.value; });
    }

    let requestBody = null;
    if (req.postData && req.postData.text) {
      try { requestBody = JSON.parse(req.postData.text); } catch { requestBody = req.postData.text; }
    }

    let responseBody = null;
    if (res.content && res.content.text) {
      const ctype = res.content.mimeType || '';
      try { responseBody = JSON.parse(res.content.text); } catch { responseBody = res.content.text; }
      if (typeof responseBody !== 'object') {
        if (['image', 'video', 'font', 'audio'].some(t => ctype.includes(t))) responseBody = null;
      }
    }

    const duration = entry.time !== undefined ? Math.round(entry.time) + 'ms' : '';

    records.push({
      seq: i + 1,
      time: entry.startedDateTime || '',
      method: (req.method || 'GET').toUpperCase(),
      url: req.url,
      status: res.status || 0,
      type: resourceType || 'XHR',
      duration,
      requestHeaders,
      requestBody,
      responseBody,
      responseHeaders,
      contentType: (res.content && res.content.mimeType) || '',
    });
  }

  if (records.length === 0) {
    throw new Error('HAR 文件中未找到可导入的 API 请求记录');
  }

  const firstPage = log.pages && log.pages[0];
  const pageTitle = firstPage ? firstPage.title || '' : '';
  let scenarioName = '导入录制';
  if (pageTitle) {
    try {
      const u = new URL(pageTitle);
      scenarioName = u.hostname + ' - ' + (u.pathname.split('/').filter(Boolean).pop() || '录制');
    } catch { scenarioName = pageTitle.substring(0, 40); }
  }

  return [{
    id: 'har_sc_' + Date.now(),
    scenarioName,
    records,
    environment: { baseURL: '', authType: 'none' },
    metadata: {
      createdAt: firstPage ? firstPage.startedDateTime : new Date().toISOString(),
      sourceUrl: pageTitle,
      tags: ['har'],
    },
  }];
}

const ImportPage = () => {
  const [file, setFile] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  // Editor state
  const [recordings, setRecordings] = React.useState([]);
  const [selectedScIdx, setSelectedScIdx] = React.useState(0);
  const [editingApi, setEditingApi] = React.useState(null); // { scenarioIdx, recordIdx }
  const [editForm, setEditForm] = React.useState(null); // { method, url, headers, body }
  const [selectedRecords, setSelectedRecords] = React.useState({}); // "scIdx-recIdx" -> boolean
  const [searchTerm, setSearchTerm] = React.useState('');
  const [methodFilter, setMethodFilter] = React.useState('');
  const [editingScName, setEditingScName] = React.useState(null); // { idx, name }
  const [changed, setChanged] = React.useState(false);
  const [jumpToInput, setJumpToInput] = React.useState('');
  const lastClickedRef = React.useRef(-1);
  const listRef = React.useRef(null);

  const handleImport = async () => {
    setLoading(true);
    try {
      const result = await window.appApi.openRecording();
      if (result) {
        await processImportResult(result);
      }
    } catch (e) {
      window.appApi.showToast('导入失败: ' + e.message, 'error');
    }
    setLoading(false);
  };

  const processImportResult = async (result) => {
    setFile(result);
    const imported = await window.appApi.importRecording(result);
    if (imported) {
      const scs = imported.scenarios || imported.recording || imported;
      const scArr = Array.isArray(scs) ? scs : [scs];
      pipelineStore.setState({
        recording: scArr,
        stats: imported.stats,
        recordingPath: imported.filePath || imported.name || '',
      });
      setRecordings(JSON.parse(JSON.stringify(scArr)));
      setSelectedScIdx(0);
      setChanged(true);
      window.appApi.showToast('导入成功: ' + (imported.name || imported.filePath || '录制文件'), 'success');
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const fileNameLC = file.name.toLowerCase();
    if (!fileNameLC.endsWith('.json') && !fileNameLC.endsWith('.har')) {
      window.appApi.showToast('仅支持 JSON / HAR 文件', 'warning');
      return;
    }
    setLoading(true);
    try {
      if (window.appApi.isElectron && file.path) {
        await processImportResult(file.path);
      } else {
        const text = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(new Error('文件读取失败'));
          r.readAsText(file);
        });
        const data = JSON.parse(text);
        let scs;
        if (file.name.toLowerCase().endsWith('.har')) {
          scs = parseHarToScenariosInBrowser(data);
        } else {
          scs = Array.isArray(data) ? data : [data];
        }
        const scArr = scs.map((s, i) => ({
          id: s.id || 'sc_' + Date.now() + '_' + i,
          name: s.scenarioName || s.name || '场景 ' + (i + 1),
          environment: s.environment || {},
          records: (s.records || []).map((r, j) => ({
            seq: r.seq || j + 1,
            method: (r.method || 'GET').toUpperCase(),
            url: r.url || '',
            status: r.status || 0,
            duration: r.duration || '',
            requestHeaders: r.requestHeaders || {},
            requestBody: r.requestBody ?? null,
            responseBody: r.responseBody ?? null,
            enabled: true,
            ref: '',
          })),
          metadata: s.metadata || {},
        }));
        const stats = {
          scenarioCount: scArr.length,
          totalRequests: scArr.reduce((s, sc) => s + sc.records.length, 0),
          methods: {},
          domains: [],
        };
        const domainSet = new Set();
        scArr.forEach(sc => sc.records.forEach(r => {
          const m = (r.method || 'GET').toUpperCase();
          stats.methods[m] = (stats.methods[m] || 0) + 1;
          try { domainSet.add(new URL(r.url).hostname); } catch {}
        }));
        stats.domains = [...domainSet];
        const importResult = { scenarios: scArr, stats, filePath: file.name, name: file.name };
        setFile(importResult);
        setRecordings(JSON.parse(JSON.stringify(scArr)));
        setSelectedScIdx(0);
        setChanged(true);
        pipelineStore.setState({
          recording: scArr,
          stats,
          recordingPath: file.name,
        });
        window.appApi.showToast('导入成功: ' + file.name, 'success');
      }
    } catch (e) {
      window.appApi.showToast('导入失败: ' + e.message, 'error');
    }
    setLoading(false);
  };

  const state = pipelineStore.getState();
  const stats = state.stats;

  // --- 场景编辑 ---
  const updateScenarioName = (idx, name) => {
    const updated = [...recordings];
    updated[idx] = { ...updated[idx], name };
    setRecordings(updated);
    setEditingScName(null);
    setChanged(true);
  };

  const addScenario = () => {
    const updated = [...recordings, {
      id: 'sc_' + Date.now(),
      name: '场景 ' + (recordings.length + 1),
      records: [],
      environment: {},
      metadata: {},
    }];
    setRecordings(updated);
    setSelectedScIdx(updated.length - 1);
    setChanged(true);
  };

  const deleteScenario = (idx) => {
    if (!confirm('确定删除场景 "' + (recordings[idx]?.name || '') + '" 吗？')) return;
    const updated = recordings.filter((_, i) => i !== idx);
    setRecordings(updated);
    if (selectedScIdx >= updated.length) setSelectedScIdx(Math.max(0, updated.length - 1));
    setChanged(true);
  };

  // --- 接口编辑 ---
  const startEditing = (scIdx, recIdx) => {
    const rec = recordings[scIdx]?.records[recIdx];
    if (!rec) return;
    setEditingApi({ scenarioIdx: scIdx, recordIdx: recIdx });
    setEditForm({
      method: rec.method || 'GET',
      url: rec.url || '',
      headers: typeof rec.requestHeaders === 'object' ? JSON.stringify(rec.requestHeaders, null, 2) : (rec.requestHeaders || ''),
      body: typeof rec.requestBody === 'object' ? JSON.stringify(rec.requestBody, null, 2) : (rec.requestBody || ''),
    });
  };

  const saveApiEdit = () => {
    if (!editingApi || !editForm) return;
    const { scenarioIdx, recordIdx } = editingApi;
    const updated = [...recordings];
    const rec = { ...updated[scenarioIdx].records[recordIdx] };
    rec.method = editForm.method;
    rec.url = editForm.url;
    try { rec.requestHeaders = JSON.parse(editForm.headers); } catch { rec.requestHeaders = editForm.headers; }
    try { rec.requestBody = JSON.parse(editForm.body); } catch { rec.requestBody = editForm.body; }
    updated[scenarioIdx] = { ...updated[scenarioIdx] };
    updated[scenarioIdx].records = [...updated[scenarioIdx].records];
    updated[scenarioIdx].records[recordIdx] = rec;
    setRecordings(updated);
    setEditingApi(null);
    setEditForm(null);
    setChanged(true);
    window.appApi.showToast('接口已保存', 'success');
  };

  const deleteApi = (scIdx, recIdx) => {
    const updated = [...recordings];
    updated[scIdx] = { ...updated[scIdx] };
    updated[scIdx].records = updated[scIdx].records.filter((_, i) => i !== recIdx);
    setRecordings(updated);
    setEditingApi(null);
    setEditForm(null);
    setChanged(true);
  };

  const toggleRecordSelect = (key, displayIdx, shiftKey) => {
    if (shiftKey && displayIdx !== undefined && lastClickedRef.current >= 0) {
      const from = Math.min(lastClickedRef.current, displayIdx);
      const to = Math.max(lastClickedRef.current, displayIdx);
      const newSel = { ...selectedRecords };
      for (let i = from; i <= to; i++) {
        const rec = filteredRecords[i];
        if (rec) {
          const gIdx = currentSc.records.indexOf(rec);
          newSel[selectedScIdx + '-' + gIdx] = true;
        }
      }
      setSelectedRecords(newSel);
    } else {
      setSelectedRecords(prev => ({ ...prev, [key]: !prev[key] }));
    }
    if (displayIdx !== undefined) lastClickedRef.current = displayIdx;
  };

  const toggleSelectAll = () => {
    const records = recordings[selectedScIdx]?.records || [];
    const allSelected = records.every((_, i) => selectedRecords[selectedScIdx + '-' + i]);
    const newSel = {};
    if (!allSelected) {
      records.forEach((_, i) => { newSel[selectedScIdx + '-' + i] = true; });
    }
    setSelectedRecords(newSel);
  };

  const deleteSelectedRecords = () => {
    const keys = Object.keys(selectedRecords).filter(k => selectedRecords[k]);
    if (keys.length === 0) { window.appApi.showToast('请先选择要删除的接口', 'warning'); return; }
    if (!confirm('确定删除选中的 ' + keys.length + ' 个接口吗？')) return;
    const indices = keys.map(k => parseInt(k.split('-')[1])).sort((a, b) => b - a);
    const updated = [...recordings];
    updated[selectedScIdx] = { ...updated[selectedScIdx] };
    updated[selectedScIdx].records = updated[selectedScIdx].records.filter((_, i) => !indices.includes(i));
    setRecordings(updated);
    setSelectedRecords({});
    setEditingApi(null);
    setChanged(true);
    window.appApi.showToast('已删除 ' + keys.length + ' 个接口', 'success');
  };

  const batchSave = async () => {
    try {
      pipelineStore.setState({ recording: recordings });
      if (window.appApi.saveRecordingEdits) {
        const recordingPath = state.recordingPath || file;
        await window.appApi.saveRecordingEdits({
          outDir: state.outDir || '',
          recordingPath: typeof recordingPath === 'string' ? recordingPath : '',
          data: recordings,
        });
      }
      setChanged(false);
      window.appApi.showToast('批量保存成功', 'success');
    } catch (e) {
      window.appApi.showToast('保存失败: ' + e.message, 'error');
    }
  };

  const jumpToApi = () => {
    const n = parseInt(jumpToInput);
    if (isNaN(n) || n < 1 || n > filteredRecords.length) {
      window.appApi.showToast('请输入 1-' + filteredRecords.length + ' 之间的序号', 'warning');
      return;
    }
    const el = listRef.current?.querySelector('.import-api-row:nth-child(' + n + ')');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'box-shadow 0.3s';
      el.style.boxShadow = '0 0 0 2px var(--primary)';
      setTimeout(() => { el.style.boxShadow = ''; }, 2000);
    }
    setJumpToInput('');
  };

  const reorderApi = (fromIdx, toIdx) => {
    if (!currentSc) return;
    const updated = [...recordings];
    const records = [...updated[selectedScIdx].records];
    const [moved] = records.splice(fromIdx, 1);
    records.splice(toIdx, 0, moved);
    updated[selectedScIdx] = { ...updated[selectedScIdx], records };
    setRecordings(updated);
    setChanged(true);
  };

  // Drag & drop state
  const dragFromRef = React.useRef(null);

  const handleDragStart = (e, fromGlobalIdx) => {
    dragFromRef.current = fromGlobalIdx;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.target.style.opacity = '1';
    dragFromRef.current = null;
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleApiDrop = (e, toGlobalIdx) => {
    e.preventDefault();
    const fromIdx = dragFromRef.current;
    if (fromIdx === null || fromIdx === toGlobalIdx) return;
    reorderApi(fromIdx, toGlobalIdx);
    dragFromRef.current = null;
  };

  // --- Filter ---
  const currentSc = recordings[selectedScIdx] || null;
  const filteredRecords = currentSc ? currentSc.records.filter((r, idx) => {
    if (searchTerm) {
      // Support #N syntax for index-based filtering
      const idxRange = searchTerm.match(/^#(\d+)(?:-(\d+))?$/);
      if (idxRange) {
        const start = parseInt(idxRange[1]) - 1;
        const end = idxRange[2] ? parseInt(idxRange[2]) - 1 : start;
        return idx >= start && idx <= end;
      }
      const multiIdx = searchTerm.match(/^#(\d+(?:,#\d+)*)$/);
      if (multiIdx) {
        const indices = searchTerm.split(',').map(s => parseInt(s.replace('#', '')) - 1);
        return indices.includes(idx);
      }
      if (!r.url.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    }
    if (methodFilter && r.method !== methodFilter) return false;
    return true;
  }) : [];

  const methodOptions = ['', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  const totalSelected = Object.values(selectedRecords).filter(Boolean).length;

  if (!file || recordings.length === 0) {
    return React.createElement('div', null, [
      React.createElement('div', { className: 'page-header', key: 'h' }, [
        React.createElement('h2', { key: 't' }, '导入录制'),
        !file && React.createElement('button', {
          className: 'btn btn-primary btn-lg',
          onClick: handleImport,
          disabled: loading,
          key: 'btn',
        }, loading ? '导入中...' : '选择录制文件'),
      ]),
      !file && React.createElement('div', {
        className: 'drop-zone' + (dragOver ? ' drag-over' : ''),
        onClick: handleImport,
        onDragOver: e => { e.preventDefault(); setDragOver(true); },
        onDragLeave: () => setDragOver(false),
        onDrop: handleDrop,
        key: 'dz',
      }, [
        React.createElement('span', { className: 'drop-zone-icon', key: 'icon' }, '📂'),
        React.createElement('h3', { key: 't' }, '点击选择或拖拽录制 JSON 文件到此处'),
        React.createElement('p', { key: 'p' }, '支持 Tampermonkey 导出格式 / 浏览器 HAR 文件'),
      ]),
    ]);
  }

  return React.createElement('div', null, [
    // Header
    React.createElement('div', { className: 'page-header', key: 'h' }, [
      React.createElement('h2', { key: 't' }, '导入录制'),
      React.createElement('div', { className: 'page-header-actions', key: 'a' }, [
        changed && React.createElement('span', {
          style: { color: 'var(--warning)', fontSize: 13, marginRight: 8 },
          key: 'dirty',
        }, '(有未保存的修改)'),
        React.createElement('button', {
          className: 'btn btn-primary btn-lg',
          onClick: batchSave,
          disabled: !changed,
          key: 'save',
          style: { minWidth: 100 },
        }, '💾 批量保存'),
      ]),
    ]),

    // Stats
    stats && React.createElement('div', { className: 'stats-grid', key: 'stats' }, [
      React.createElement('div', { className: 'stat-card', key: 'sc' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon blue' }, '📋')),
        React.createElement('div', { className: 'stat-value' }, recordings.length || 0),
        React.createElement('div', { className: 'stat-label' }, '场景数'),
      ]),
      React.createElement('div', { className: 'stat-card', key: 'req' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon cyan' }, '🔗')),
        React.createElement('div', { className: 'stat-value' }, currentSc ? currentSc.records.length : 0),
        React.createElement('div', { className: 'stat-label' }, '接口数'),
      ]),
      totalSelected > 0 && React.createElement('div', { className: 'stat-card', key: 'sel' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon amber' }, '✅')),
        React.createElement('div', { className: 'stat-value' }, totalSelected),
        React.createElement('div', { className: 'stat-label' }, '已选中'),
      ]),
    ]),

    // 场景选择选项卡
    React.createElement('div', { className: 'import-scenario-selectors', key: 'tabs', style: {
      display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center',
    }},
      recordings.map((sc, i) =>
        React.createElement('div', {
          key: i,
          className: 'import-scenario-selector' + (selectedScIdx === i ? ' active' : ''),
          style: {
            padding: '6px 12px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            background: selectedScIdx === i ? 'var(--primary)' : 'var(--bg-secondary)',
            color: selectedScIdx === i ? '#fff' : 'var(--text)',
            display: 'flex', alignItems: 'center', gap: 6,
          },
        }, [
          editingScName?.idx === i
            ? React.createElement('input', {
                key: 'input',
                type: 'text',
                value: editingScName.name,
                onChange: e => setEditingScName({ idx: i, name: e.target.value }),
                onBlur: () => updateScenarioName(i, editingScName.name),
                onKeyDown: e => { if (e.key === 'Enter') updateScenarioName(i, editingScName.name); },
                style: { width: 100, fontSize: 13, padding: '2px 4px', background: '#fff', color: '#000', border: '1px solid #ccc', borderRadius: 3 },
                autoFocus: true,
              })
            : React.createElement('span', {
                key: 'name',
                onClick: () => setEditingScName({ idx: i, name: sc.name }),
                style: { cursor: 'text' },
              }, sc.name || '场景 ' + (i + 1)),
          sc.records.length > 0 && React.createElement('span', {
            style: { fontSize: 11, opacity: 0.7 },
          }, '(' + sc.records.length + ')'),
          React.createElement('span', {
            className: 'btn btn-sm',
            onClick: e => { e.stopPropagation(); deleteScenario(i); },
            style: { padding: '0 4px', fontSize: 12, color: '#e74c3c', cursor: 'pointer', marginLeft: 2 },
          }, '✕'),
        ])
      ),
      React.createElement('button', {
        className: 'btn btn-sm',
        onClick: addScenario,
        key: 'add',
        style: { padding: '4px 10px', fontSize: 13 },
      }, '+ 添加场景'),
    ),

    // Filter bar
    React.createElement('div', { className: 'import-filter-bar', key: 'filter', style: {
      display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center',
    }}, [
      // Search
      React.createElement('input', {
        key: 'search',
        type: 'text',
        placeholder: '搜索 URL 或 #序号 (如 #3, #2-5)...',
        value: searchTerm,
        onChange: e => setSearchTerm(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter') setSearchTerm(e.target.value); },
        style: { flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
      }),
      // Method filter
      React.createElement('select', {
        key: 'method',
        value: methodFilter,
        onChange: e => setMethodFilter(e.target.value),
        style: { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
      }, methodOptions.map(m => React.createElement('option', { key: m, value: m }, m || '所有 Method'))),
      // Jump to #
      React.createElement('input', {
        key: 'jump',
        type: 'text',
        placeholder: '#跳转',
        value: jumpToInput,
        onChange: e => setJumpToInput(e.target.value.replace(/[^0-9]/g, '')),
        onKeyDown: e => { if (e.key === 'Enter') jumpToApi(); },
        style: { width: 72, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
      }),
      React.createElement('button', {
        key: 'jumpBtn',
        className: 'btn btn-sm',
        onClick: jumpToApi,
        style: { padding: '4px 8px', fontSize: 12 },
      }, '跳转'),
      // Select all
      React.createElement('label', { key: 'sel', style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}, [
        React.createElement('input', {
          type: 'checkbox',
          checked: filteredRecords.length > 0 && filteredRecords.every((_, i) => {
            const globalIdx = currentSc.records.indexOf(filteredRecords[i]);
            return selectedRecords[selectedScIdx + '-' + globalIdx];
          }),
          onChange: toggleSelectAll,
        }),
        '全选',
      ]),
      // Delete selected
      React.createElement('button', {
        className: 'btn btn-sm',
        onClick: deleteSelectedRecords,
        disabled: totalSelected === 0,
        style: { color: totalSelected > 0 ? '#e74c3c' : 'var(--text-secondary)' },
      }, '删除选中(' + totalSelected + ')'),
    ]),

    // API list with inline editing
    React.createElement('div', { className: 'import-api-list', key: 'list', ref: listRef, style: { display: 'flex', flexDirection: 'column', gap: 1 }},
      filteredRecords.length === 0
        ? React.createElement('div', { style: { textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}, '无匹配接口')
        : filteredRecords.map((rec, displayIdx) => {
            const globalRecIdx = currentSc.records.indexOf(rec);
            const key = selectedScIdx + '-' + globalRecIdx;
            const isEditing = editingApi && editingApi.scenarioIdx === selectedScIdx && editingApi.recordIdx === globalRecIdx;
            return React.createElement('div', {
              key: key,
              className: 'import-api-row' + (isEditing ? ' editing' : ''),
              draggable: true,
              onDragStart: e => handleDragStart(e, globalRecIdx),
              onDragEnd: handleDragEnd,
              onDragOver: handleDragOver,
              onDrop: e => handleApiDrop(e, globalRecIdx),
              style: {
                border: '1px solid var(--border)',
                borderRadius: 6,
                marginBottom: 4,
                background: isEditing ? 'var(--bg-secondary)' : 'var(--bg)',
                cursor: 'grab',
              },
            }, [
              // Row header
              React.createElement('div', { style: {
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                cursor: 'pointer',
              }}, [
                React.createElement('input', {
                  type: 'checkbox',
                  checked: !!selectedRecords[key],
                  onClick: e => {
                    e.stopPropagation();
                    toggleRecordSelect(key, displayIdx, e.shiftKey);
                  },
                }),
                React.createElement('span', { className: 'tag tag-info', style: { marginRight: 4, fontSize: 11 }}, '#' + (displayIdx + 1)),
                React.createElement('span', { className: 'method-badge method-' + rec.method.toLowerCase() }, rec.method),
                React.createElement('span', { style: { flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}, rec.url),
                rec.status > 0 && React.createElement('span', { className: 'tag tag-info' }, rec.status),
                rec.duration && React.createElement('span', { style: { fontSize: 11, color: 'var(--text-secondary)' }}, rec.duration),
                React.createElement('button', {
                  className: 'btn btn-sm',
                  onClick: e => { 
                    e.stopPropagation(); 
                    if (isEditing) {
                      setEditingApi(null);
                      setEditForm(null);
                    } else {
                      startEditing(selectedScIdx, globalRecIdx);
                    }
                  },
                  style: { padding: '2px 8px', fontSize: 12 },
                }, isEditing ? '取消' : '编辑'),
                React.createElement('button', {
                  className: 'btn btn-sm',
                  onClick: e => { e.stopPropagation(); if (confirm('确定删除此接口吗？')) deleteApi(selectedScIdx, globalRecIdx); },
                  style: { padding: '2px 6px', fontSize: 12, color: '#e74c3c' },
                }, '删除'),
              ]),

              // Editing form
              isEditing && React.createElement('div', { style: { padding: '12px 16px', borderTop: '1px solid var(--border)' }}, [
                // Method + URL
                React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 8 }}, [
                  React.createElement('select', {
                    value: editForm.method,
                    onChange: e => setEditForm({ ...editForm, method: e.target.value }),
                    style: { padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', width: 100 },
                  }, ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].map(m =>
                    React.createElement('option', { key: m, value: m }, m)
                  )),
                  React.createElement('input', {
                    type: 'text',
                    value: editForm.url,
                    onChange: e => setEditForm({ ...editForm, url: e.target.value }),
                    style: { flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
                    placeholder: '请求 URL',
                    autoFocus: true,
                  }),
                ]),
                // Headers
                React.createElement('div', { style: { marginBottom: 8 }}, [
                  React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}, '请求头 (JSON)'),
                  React.createElement('textarea', {
                    value: editForm.headers,
                    onChange: e => setEditForm({ ...editForm, headers: e.target.value }),
                    style: { width: '100%', minHeight: 60, padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' },
                    placeholder: '{"Content-Type": "application/json"}',
                  }),
                ]),
                // Body
                React.createElement('div', { style: { marginBottom: 8 }}, [
                  React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}, '请求体 (JSON)'),
                  React.createElement('textarea', {
                    value: editForm.body,
                    onChange: e => setEditForm({ ...editForm, body: e.target.value }),
                    style: { width: '100%', minHeight: 80, padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' },
                    placeholder: '请求体 JSON',
                  }),
                ]),
                // Original response (readonly reference)
                rec.responseBody && React.createElement('div', { style: { marginBottom: 8 }}, [
                  React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}, '原始响应 (只读参考)'),
                  React.createElement('pre', { style: { maxHeight: 120, overflow: 'auto', padding: 6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11, color: 'var(--text-secondary)' }},
                    typeof rec.responseBody === 'object' ? JSON.stringify(rec.responseBody, null, 2) : String(rec.responseBody).slice(0, 500)),
                ]),
                // Save button
                React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' }}, [
                  React.createElement('button', {
                    className: 'btn btn-primary',
                    onClick: saveApiEdit,
                    style: { padding: '6px 20px', fontSize: 13 },
                  }, '保存修改'),
                ]),
              ]),
            ]);
          })
    ),

    // 启动管道按钮
    React.createElement('div', {
      style: { textAlign: 'center', marginTop: 24 },
      key: 'cta',
    }, [
      React.createElement('button', {
        className: 'btn btn-primary btn-lg',
        onClick: async () => {
          // 先保存编辑内容，再跳转管道页面
          if (changed && window.appApi.saveRecordingEdits) {
            try {
              const recordingPath = state.recordingPath || file;
              await window.appApi.saveRecordingEdits({
                outDir: state.outDir || '',
                recordingPath: typeof recordingPath === 'string' ? recordingPath : '',
                data: recordings,
              });
              setChanged(false);
            } catch (e) {
              console.warn('自动保存编辑失败:', e);
            }
          }
          pipelineStore.setState({ recording: recordings, currentPage: 'pipeline' });
        },
        style: { minWidth: 200 },
      }, '启动管道处理'),
    ]),
  ]);
};
