// RegressionPage.js - 回归验证页面
// 功能: 加载管道输出，对每个接口发送真实HTTP请求，验证断言并展示结果
const RegressionPage = () => {
  const [caseVo, setCaseVo] = React.useState(null);
  const [results, setResults] = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const [expandedResult, setExpandedResult] = React.useState(null);
  const [jumpToInput, setJumpToInput] = React.useState('');
  const listRef = React.useRef(null);

  // 数据池循环/展开模式相关
  const [dataPoolConfig, setDataPoolConfig] = React.useState(null);
  const [iterationMode, setIterationMode] = React.useState('none');
  const [caseList, setCaseList] = React.useState(null);        // 展开模式的多 CaseVo
  const [currentCaseIndex, setCurrentCaseIndex] = React.useState(0);

  // 编辑支持
  const [selectedApis, setSelectedApis] = React.useState({});
  const [editingApiIdx, setEditingApiIdx] = React.useState(null);
  const [editingApiForm, setEditingApiForm] = React.useState(null);
  const [changed, setChanged] = React.useState(false);

  // 实时执行日志与进度
  const [regressionLogs, setRegressionLogs] = React.useState([]);
  const [regressionProgress, setRegressionProgress] = React.useState(0);
  const logContainerRef = React.useRef(null);

  // 自动滚动日志到底部
  React.useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [regressionLogs]);

  // 监听回归进度事件（进度条用）和日志事件（日志窗口用）
  React.useEffect(() => {
    const unsubProgress = window.appApi.onPipelineProgress((msg) => {
      if (msg.agentId === 'regression-runner') {
        setRegressionProgress(msg.progress || 0);
        if (msg.message) {
          setRegressionLogs(prev => [...prev, {
            time: new Date().toLocaleTimeString(),
            message: msg.message,
            progress: msg.progress || 0,
          }]);
        }
      }
    });
    // 监听实时日志（logger 推送），作为进度事件的兜底
    const unsubLog = window.appApi.onLogEntry((entry) => {
      if (!runningRef.current) return;
      if (entry.module === 'RegressionRunner' && entry.message) {
        // 去掉日志前缀 [时间] [级别] [模块名]，只保留实际内容
        const cleanMsg = entry.message.replace(/^\[[^\]]*\]\s*\[[^\]]*\]\s*\[[^\]]*\]\s*/, '');
        // 从日志消息解析进度："接口3/73 GET /xxx" → 3/73 ≈ 4%
        let prog = 0;
        const match = cleanMsg.match(/接口(\d+)\/(\d+)/);
        if (match) {
          const current = parseInt(match[1], 10);
          const total = parseInt(match[2], 10);
          prog = Math.round((current / total) * 85) + 5;
        } else if (cleanMsg.includes('写入回归报告')) {
          prog = 95;
        } else if (cleanMsg.includes('回归验证完成')) {
          prog = 100;
        }
        if (prog > 0) setRegressionProgress(prog);
        setRegressionLogs(prev => {
          // 避免重复添加完全相同的日志
          const last = prev[prev.length - 1];
          if (last && last.message === cleanMsg) return prev;
          return [...prev, {
            time: new Date(entry.timestamp || Date.now()).toLocaleTimeString(),
            message: cleanMsg,
            progress: prog,
          }];
        });
      }
    });
    return () => { if (unsubProgress) unsubProgress(); if (unsubLog) unsubLog(); };
  }, []);

  // 用 ref 跟踪 running 状态以便日志回调访问最新值
  const runningRef = React.useRef(false);

  // 修改追踪
  const modificationRecordsRef = React.useRef([]);
  const trackModification = (type, apiIndices, summary, details) => {
    modificationRecordsRef.current.push({
      type, apiIndices, summary, details: details || summary,
    });
    setChanged(true);
  };

  // 加载数据
  React.useEffect(() => {
    (async () => {
      try {
        const state = pipelineStore.getState();
        const outDir = state.outDir;
        if (!outDir) return;

        // 尝试加载已保存的回归报告
        const report = await window.appApi.readRegressionReport(outDir);
        if (report) {
          setResults(report);
        }

        // 加载用例数据
        const pipelineResult = state.pipelineResult || await window.appApi.readPipelineResult(outDir);
        if (pipelineResult && pipelineResult.success) {
          setCaseVo(pipelineResult.caseVo);
          // 检查数据池配置（循环模式）
          if (pipelineResult.dataPoolConfig) {
            setDataPoolConfig(pipelineResult.dataPoolConfig);
          }
          if (pipelineResult.iterationMode) {
            setIterationMode(pipelineResult.iterationMode);
          }
          // 检查展开模式的多 CaseVo
          if (pipelineResult.caseVoList && Array.isArray(pipelineResult.caseVoList)) {
            setCaseList(pipelineResult.caseVoList);
          } else if (Array.isArray(pipelineResult.caseVo)) {
            setCaseList(pipelineResult.caseVo);
          }
        } else {
          // 直接读取 case-save.json
          const casePath = outDir + '/case-save.json';
          const cv = await window.appApi.readFile(casePath);
          if (cv) setCaseVo(cv);
        }
      } catch (e) {
        console.warn('加载回归数据失败:', e);
      }
    })();
  }, []);

  // 执行回归验证
  const handleRunRegression = async () => {
    const state = pipelineStore.getState();
    const outDir = state.outDir;
    if (!outDir) {
      window.appApi.showToast('无输出目录，请先完成管道处理', 'error');
      return;
    }

    setRunning(true);
    runningRef.current = true;
    setResults(null);
    setRegressionLogs([]);
    setRegressionProgress(0);
    try {
      let result;

      // 循环模式：使用数据池驱动回归
      if (iterationMode === 'loop' && dataPoolConfig) {
        result = await window.appApi.runRegressionWithData({
          outDir,
          dataPoolConfig,
          chainRules: state.pipelineResult?.caseVo?.chainRules || [],
          iterationMode: 'loop',
        });
      } else if (caseList && caseList.length > 0) {
        // 展开模式：可能有多个 CaseVo，运行当前选中的
        const targetCase = caseList[currentCaseIndex] || caseVo;
        result = await window.appApi.runRegression({ outDir, caseVo: targetCase });
      } else {
        // 标准模式
        result = await window.appApi.runRegression({ outDir });
      }

      if (result && result.success) {
        setResults(result);
        const rowLabel = iterationMode === 'loop' && result.stats?.rowCount
          ? ' (数据行: ' + result.stats.rowCount + ')' : '';
        window.appApi.showToast(
          '回归完成: ' + (result.stats?.passed || 0) + '/' + (result.stats?.total || 0) + ' 通过' + rowLabel,
          result.stats?.failed === 0 && result.stats?.error === 0 ? 'success' : 'warning'
        );
        // 自动保存测试报告
        let savedReportId = null;
        try {
          const reportData = {
            caseName: result.caseName || state.pipelineResult?.caseVo?.name || '',
            stats: result.stats,
            results: result.results,
            timestamp: result.timestamp || new Date().toISOString(),
            environment: result.environment || '',
            apiCount: result.apiCount || (result.results ? result.results.length : 0),
            outDir: outDir,
          };
          const saveResult = await window.appApi.saveRegressionReport(reportData);
          if (saveResult && saveResult.reportId) {
            savedReportId = saveResult.reportId;
            // 存入 store 供 ReportsPage 跳转详情用
            pipelineStore.setState({ lastReportId: savedReportId });
          }
        } catch (saveErr) {
          console.warn('保存测试报告失败:', saveErr);
        }
      } else if (result) {
        window.appApi.showToast('回归失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('回归失败: ' + e.message, 'error');
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const toggleExpand = (idx) => {
    setExpandedResult(expandedResult === idx ? null : idx);
  };

  const jumpToResult = () => {
    const n = parseInt(jumpToInput);
    const total = results?.results?.length || 0;
    if (isNaN(n) || n < 1 || n > total) {
      window.appApi.showToast('请输入 1-' + total + ' 之间的序号', 'warning');
      return;
    }
    const idx = n - 1;
    toggleExpand(idx);
    setTimeout(() => {
      const el = listRef.current?.querySelector('.regression-card:nth-child(' + n + ')');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow 0.3s';
        el.style.boxShadow = '0 0 0 2px var(--primary)';
        setTimeout(() => { el.style.boxShadow = ''; }, 2000);
      }
    }, 100);
    setJumpToInput('');
  };

  const scrollToFirstFailed = (type) => {
    const idx = results?.results?.findIndex(r => type === 'failed' ? !r.passed && !r.error : r.error);
    if (idx >= 0) {
      toggleExpand(idx);
      setTimeout(() => {
        const el = listRef.current?.querySelector('.regression-card:nth-child(' + (idx + 1) + ')');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  };

  const goToPage = (page) => {
    pipelineStore.setState({ currentPage: page });
  };

  // ---- 接口选择和编辑 ----
  const toggleSelectApi = (idx, shiftKey) => {
    if (shiftKey) {
      const keys = Object.keys(selectedApis).filter(k => selectedApis[k]).map(Number);
      if (keys.length > 0) {
        const last = keys[keys.length - 1];
        const from = Math.min(last, idx);
        const to = Math.max(last, idx);
        const newSel = {};
        for (let i = from; i <= to; i++) {
          if (caseVo?.apiVos?.[i]) newSel[i] = true;
        }
        setSelectedApis(newSel);
        return;
      }
    }
    setSelectedApis(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleSelectAll = () => {
    if (!caseVo?.apiVos) return;
    const allSelected = caseVo.apiVos.every((_, i) => selectedApis[i]);
    if (allSelected) { setSelectedApis({}); return; }
    const newSel = {};
    caseVo.apiVos.forEach((_, i) => { newSel[i] = true; });
    setSelectedApis(newSel);
  };

  const deleteSelectedApis = async () => {
    const indices = Object.keys(selectedApis).filter(k => selectedApis[k]).map(Number);
    if (indices.length === 0) { window.appApi.showToast('请先选择要删除的接口', 'warning'); return; }
    if (!confirm('确定删除选中的 ' + indices.length + ' 个接口吗？\n删除后回归验证结果将清空，需要重新执行回归验证。')) return;
    const cv = { ...caseVo };
    if (!cv?.apiVos) return;
    indices.sort((a, b) => b - a);
    indices.forEach(i => { cv.apiVos.splice(i, 1); });
    cv.apiCount = cv.apiVos.length;
    setCaseVo(cv);
    setResults(null);
    setSelectedApis({});
    trackModification('delete', indices, '回归测试删除 ' + indices.length + ' 个接口',
      '接口: ' + indices.map(i => '#' + (i + 1)).join(', '));
    // 删除后自动保存
    await handleSave();
  };

  const startEditApi = (idx) => {
    const api = caseVo?.apiVos?.[idx];
    if (!api) return;
    if (expandedResult !== idx) setExpandedResult(idx);
    setEditingApiIdx(idx);
    setEditingApiForm({
      apiMethod: api.apiMethod || 'GET',
      apiUrl: api.apiUrl || '',
      requestHeaders: typeof api.requestHeaders === 'object' ? JSON.stringify(api.requestHeaders, null, 2) : (api.requestHeaders || ''),
      requestBody: typeof api.requestBody === 'object' ? JSON.stringify(api.requestBody, null, 2) : (api.requestBody || ''),
      assertVos: api.assertVos ? api.assertVos.map(a => ({ ...a })) : [],
    });
  };

  const saveApiEdit = async () => {
    if (editingApiIdx === null || !editingApiForm) return;
    const cv = { ...caseVo };
    if (!cv?.apiVos) return;
    const api = cv.apiVos[editingApiIdx];
    api.apiMethod = editingApiForm.apiMethod;
    api.apiUrl = editingApiForm.apiUrl;
    try { api.requestHeaders = JSON.parse(editingApiForm.requestHeaders); } catch { api.requestHeaders = editingApiForm.requestHeaders; }
    try { api.requestBody = JSON.parse(editingApiForm.requestBody); } catch { api.requestBody = editingApiForm.requestBody; }
    api.assertVos = editingApiForm.assertVos;
    setCaseVo(cv);
    setEditingApiIdx(null);
    setEditingApiForm(null);
    setResults(null); // 清除结果，需要重新回归
    trackModification('edit', [editingApiIdx], '回归测试编辑接口 #' + (editingApiIdx + 1),
      api.apiMethod + ' ' + api.apiUrl);
    // 编辑后自动保存
    await handleSave();
  };

  const addAssertion = () => {
    if (!editingApiForm) return;
    const newAssert = { expression: '', expectValue: '', delay: 0, logicType: 1, validateType: 3 };
    setEditingApiForm({ ...editingApiForm, assertVos: [...(editingApiForm.assertVos || []), newAssert] });
  };

  const removeAssertion = (idx) => {
    if (!editingApiForm) return;
    const newVos = editingApiForm.assertVos.filter((_, k) => k !== idx);
    setEditingApiForm({ ...editingApiForm, assertVos: newVos });
  };

  // ---- 批量保存 ----
  const handleSave = async () => {
    if (!caseVo) return;
    try {
      const state = pipelineStore.getState();
      const outDir = state.outDir;
      if (!outDir) { window.appApi.showToast('无法确定输出目录', 'error'); return; }

      // 保存到 case-save.json 和 case-save-regression.json
      await window.appApi.writeFile(outDir + '/case-save.json', caseVo);
      await window.appApi.writeFile(outDir + '/case-save-regression.json', caseVo);

      // 提交修改追踪标签
      const records = modificationRecordsRef.current;
      if (records.length > 0) {
        for (const rec of records) {
          await window.appApi.modificationAppend(outDir, {
            stage: 'regression',
            type: rec.type,
            apiIndices: rec.apiIndices,
            summary: rec.summary,
            details: rec.details,
          });
        }
        modificationRecordsRef.current = [];
      }

      setChanged(false);
      window.appApi.showToast('回归测试修改已保存', 'success');
    } catch (e) {
      window.appApi.showToast('保存失败: ' + e.message, 'error');
    }
  };

  const formatJSON = (str) => {
    if (!str) return '-';
    try {
      const obj = typeof str === 'string' ? JSON.parse(str) : str;
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(str);
    }
  };

  // 渲染每个接口的结果详情
  const renderResultDetail = (r, i) => {
    const isExpanded = expandedResult === i;
    const statusClass = r.error ? 'tag-error' : r.passed ? 'tag-success' : 'tag-warning';
    const statusText = r.error ? '错误' : r.passed ? '通过' : '失败';
    const isEditing = editingApiIdx === i;

    return React.createElement('div', {
      className: 'regression-card' + (isExpanded ? ' expanded' : '') + (isEditing ? ' editing' : ''),
      key: i,
    }, [
      // 头部（可点击展开）
      React.createElement('div', {
        className: 'regression-card-header',
        onClick: () => { if (!isEditing) toggleExpand(i); },
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', cursor: isEditing ? 'default' : 'pointer', borderBottom: (isExpanded || isEditing) ? '1px solid var(--border)' : 'none' },
      }, [
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 }, key: 'left' }, [
          // Checkbox
          React.createElement('input', {
            type: 'checkbox', checked: !!selectedApis[i],
            onClick: e => { e.stopPropagation(); toggleSelectApi(i, e.shiftKey); },
            key: 'cb', style: { margin: 0, cursor: 'pointer' },
          }),
          React.createElement('span', { className: 'tag tag-info', style: { marginRight: 4, fontSize: 11 }}, '#' + (i + 1)),
          r._rowIndex !== undefined && React.createElement('span', {
            className: 'tag',
            style: { background: '#3498db', color: '#fff', fontSize: 10, padding: '1px 6px' },
          }, '行' + r._rowIndex),
          React.createElement('span', { className: 'method-badge method-' + r.method.toLowerCase() }, r.method),
          React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 13, maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.url || '-'),
        ]),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 }, key: 'right' }, [
          // 编辑按钮
          React.createElement('button', {
            className: 'btn btn-sm', key: 'edit-btn',
            onClick: e => { e.stopPropagation(); isEditing ? setEditingApiIdx(null) : startEditApi(i); },
            style: { padding: '2px 8px', fontSize: 11 },
          }, isEditing ? '取消' : '编辑'),
          React.createElement('span', { className: 'tag ' + statusClass }, statusText),
          r.responseStatus && React.createElement('span', { className: 'tag tag-info' }, String(r.responseStatus)),
          React.createElement('span', { style: { fontSize: 12, color: 'var(--text-tertiary)' } },
            r.duration ? r.duration + 'ms' : ''),
          React.createElement('span', { style: { color: 'var(--text-tertiary)', fontSize: 12 } },
            isExpanded ? '收起' : '展开'),
        ]),
      ]),

      // 编辑表单
      isEditing && React.createElement('div', {
        className: 'regression-card-body',
        style: { padding: '16px', background: 'var(--bg-warning, #fffbe6)' },
      }, [
        // Method + URL
        React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 8 }}, [
          React.createElement('select', {
            value: editingApiForm?.apiMethod || 'GET',
            onChange: e => setEditingApiForm({ ...editingApiForm, apiMethod: e.target.value }),
            style: { padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', width: 100 },
          }, ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => React.createElement('option', { key: m, value: m }, m))),
          React.createElement('input', {
            type: 'text', value: editingApiForm?.apiUrl || '',
            onChange: e => setEditingApiForm({ ...editingApiForm, apiUrl: e.target.value }),
            style: { flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
            placeholder: 'API URL',
          }),
        ]),
        // Headers
        React.createElement('div', { style: { marginBottom: 8 }}, [
          React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}, '请求头 (JSON)'),
          React.createElement('textarea', {
            value: editingApiForm?.requestHeaders || '',
            onChange: e => setEditingApiForm({ ...editingApiForm, requestHeaders: e.target.value }),
            style: { width: '100%', minHeight: 50, padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' },
          }),
        ]),
        // Body
        React.createElement('div', { style: { marginBottom: 8 }}, [
          React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}, [
            React.createElement('span', { key: 't' }, '请求体 (JSON)'),
          ]),
          React.createElement('textarea', {
            value: editingApiForm?.requestBody || '',
            onChange: e => setEditingApiForm({ ...editingApiForm, requestBody: e.target.value }),
            style: { width: '100%', minHeight: 60, padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' },
          }),
        ]),
        // Assertions
        React.createElement('div', { style: { marginBottom: 8 }}, [
          React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}, [
            React.createElement('span', { key: 't' }, '断言 (' + (editingApiForm?.assertVos?.length || 0) + ')'),
            React.createElement('button', {
              className: 'btn btn-sm', onClick: addAssertion, key: 'add',
              style: { fontSize: 11 },
            }, '+ 添加断言'),
          ]),
          React.createElement('div', { style: { maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }},
            (editingApiForm?.assertVos || []).map((assert, j) =>
              React.createElement('div', { key: j, style: { display: 'flex', gap: 4, alignItems: 'center' }}, [
                React.createElement('input', {
                  type: 'text', value: assert.expression || '',
                  onChange: e => {
                    const newVos = [...editingApiForm.assertVos];
                    newVos[j] = { ...newVos[j], expression: e.target.value };
                    setEditingApiForm({ ...editingApiForm, assertVos: newVos });
                  },
                  placeholder: 'responseBody.code',
                  style: { flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)' },
                }),
                React.createElement('input', {
                  type: 'text', value: assert.expectValue || '',
                  onChange: e => {
                    const newVos = [...editingApiForm.assertVos];
                    newVos[j] = { ...newVos[j], expectValue: e.target.value };
                    setEditingApiForm({ ...editingApiForm, assertVos: newVos });
                  },
                  placeholder: '200',
                  style: { flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)' },
                }),
                React.createElement('button', {
                  onClick: () => removeAssertion(j),
                  style: { border: 'none', background: 'transparent', color: '#e74c3c', cursor: 'pointer', fontSize: 16, padding: '2px 6px', lineHeight: 1 },
                  title: '删除断言',
                }, '×'),
              ])
            ),
          ),
        ]),
        // Save button
        React.createElement('button', {
          className: 'btn btn-primary btn-sm',
          onClick: saveApiEdit,
        }, '保存接口修改'),
      ]),

      // 展开详情
      isExpanded && React.createElement('div', {
        className: 'regression-card-body',
        style: { padding: '16px' },
      }, [
        // 断言结果
        r.assertions && r.assertions.length > 0 &&
          React.createElement('div', { key: 'asserts', style: { marginBottom: 16 } }, [
            React.createElement('h5', { style: { marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)' } },
              '断言验证 (' + r.assertions.filter(a => a.passed).length + '/' + r.assertions.length + ')'),
            React.createElement('div', { className: 'table-wrapper' },
              React.createElement('table', { className: 'table' }, [
                React.createElement('thead', { key: 'th' },
                  React.createElement('tr', null, [
                    React.createElement('th', { key: 'e' }, '表达式'),
                    React.createElement('th', { key: 'ev' }, '期望值'),
                    React.createElement('th', { key: 'av' }, '实际值'),
                    React.createElement('th', { key: 'r' }, '结果'),
                  ]),
                ),
                React.createElement('tbody', { key: 'tb' },
                  r.assertions.map((a, j) =>
                    React.createElement('tr', { key: j }, [
                      React.createElement('td', { style: { fontFamily: 'monospace', fontSize: 12 } }, a.expression || '-'),
                      React.createElement('td', null, a.expectValue || '-'),
                      React.createElement('td', { style: { fontFamily: 'monospace', fontSize: 12 } }, a.actualValue || '-'),
                      React.createElement('td', null,
                        React.createElement('span', {
                          className: 'tag ' + (a.passed ? 'tag-success' : 'tag-error'),
                        }, a.passed ? '通过' : '失败'),
                      ),
                    ])
                  ),
                ),
              ]),
            ),
          ]),

        // 请求信息
        React.createElement('div', { className: 'detail-section', key: 'req', style: { marginBottom: 12 } }, [
          React.createElement('h5', { style: { marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' } }, '请求头'),
          React.createElement('div', { className: 'code-block' },
            JSON.stringify(r.requestHeaders || {}, null, 2)),
        ]),
        r.requestBody !== undefined && r.requestBody !== null && r.requestBody !== '' &&
          React.createElement('div', { className: 'detail-section', key: 'reqb', style: { marginBottom: 12 } }, [
            React.createElement('h5', { style: { marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' } }, '请求体'),
            React.createElement('div', { className: 'code-block' },
              typeof r.requestBody === 'object' ? JSON.stringify(r.requestBody, null, 2) : String(r.requestBody)),
          ]),

        // 响应信息
        r.responseHeaders &&
          React.createElement('div', { className: 'detail-section', key: 'resh', style: { marginBottom: 12 } }, [
            React.createElement('h5', { style: { marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' } }, '响应头'),
            React.createElement('div', { className: 'code-block' },
              JSON.stringify(r.responseHeaders, null, 2)),
          ]),
        r.responseBody &&
          React.createElement('div', { className: 'detail-section', key: 'resb' }, [
            React.createElement('h5', { style: { marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' } }, '响应体'),
            React.createElement('div', { className: 'code-block', style: { maxHeight: 300, overflow: 'auto' } },
              formatJSON(r.responseBody)),
          ]),
        r.error &&
          React.createElement('div', { className: 'detail-section', key: 'err' }, [
            React.createElement('h5', { style: { marginBottom: 4, fontSize: 13, color: 'var(--danger)' } }, '错误'),
            React.createElement('div', { className: 'code-block', style: { color: 'var(--danger)' } }, r.error),
          ]),
      ]),
    ]);
  };

  // ---- 无结果时的可编辑接口卡片 ----
  const renderApiCardFromCaseVo = (api, i) => {
    const isEditing = editingApiIdx === i;
    return React.createElement('div', {
      key: i,
      className: 'regression-card' + (isEditing ? ' editing' : ''),
      style: { border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4 },
    }, [
      // Header
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' },
      }, [
        React.createElement('input', {
          type: 'checkbox', checked: !!selectedApis[i],
          onClick: e => { e.stopPropagation(); toggleSelectApi(i, e.shiftKey); },
        }),
        React.createElement('span', { className: 'tag tag-info', style: { fontSize: 11 } }, '#' + (i + 1)),
        React.createElement('span', { className: 'method-badge method-' + (api.apiMethod || 'GET').toLowerCase() }, api.apiMethod || 'GET'),
        React.createElement('span', { style: { flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, api.apiUrl || '-'),
        React.createElement('button', {
          className: 'btn btn-sm',
          onClick: e => { e.stopPropagation(); isEditing ? setEditingApiIdx(null) : startEditApi(i); },
          style: { padding: '2px 8px', fontSize: 12 },
        }, isEditing ? '取消' : '编辑'),
      ]),
      // 编辑表单
      isEditing && React.createElement('div', {
        style: { padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-warning, #fffbe6)' },
      }, [
        // Method + URL
        React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 8 }}, [
          React.createElement('select', {
            value: editingApiForm?.apiMethod || 'GET',
            onChange: e => setEditingApiForm({ ...editingApiForm, apiMethod: e.target.value }),
            style: { padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, width: 100 },
          }, ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => React.createElement('option', { key: m, value: m }, m))),
          React.createElement('input', {
            type: 'text', value: editingApiForm?.apiUrl || '',
            onChange: e => setEditingApiForm({ ...editingApiForm, apiUrl: e.target.value }),
            style: { flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 },
            placeholder: 'API URL',
          }),
        ]),
        // Headers
        React.createElement('div', { style: { marginBottom: 8 }}, [
          React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}, '请求头 (JSON)'),
          React.createElement('textarea', {
            value: editingApiForm?.requestHeaders || '',
            onChange: e => setEditingApiForm({ ...editingApiForm, requestHeaders: e.target.value }),
            style: { width: '100%', minHeight: 50, padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', resize: 'vertical' },
          }),
        ]),
        // Body
        React.createElement('div', { style: { marginBottom: 8 }}, [
          React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}, '请求体 (JSON)'),
          React.createElement('textarea', {
            value: editingApiForm?.requestBody || '',
            onChange: e => setEditingApiForm({ ...editingApiForm, requestBody: e.target.value }),
            style: { width: '100%', minHeight: 60, padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', resize: 'vertical' },
          }),
        ]),
        // Assertions
        React.createElement('div', { style: { marginBottom: 8 }}, [
          React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}, [
            React.createElement('span', null, '断言 (' + (editingApiForm?.assertVos?.length || 0) + ')'),
            React.createElement('button', { className: 'btn btn-sm', onClick: addAssertion, style: { fontSize: 11 }}, '+ 添加断言'),
          ]),
          React.createElement('div', { style: { maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }},
            (editingApiForm?.assertVos || []).map((assert, j) =>
              React.createElement('div', { key: j, style: { display: 'flex', gap: 4, alignItems: 'center' }}, [
                React.createElement('input', {
                  type: 'text', value: assert.expression || '',
                  onChange: e => {
                    const newVos = [...editingApiForm.assertVos];
                    newVos[j] = { ...newVos[j], expression: e.target.value };
                    setEditingApiForm({ ...editingApiForm, assertVos: newVos });
                  },
                  placeholder: 'responseBody.code',
                  style: { flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace' },
                }),
                React.createElement('input', {
                  type: 'text', value: assert.expectValue || '',
                  onChange: e => {
                    const newVos = [...editingApiForm.assertVos];
                    newVos[j] = { ...newVos[j], expectValue: e.target.value };
                    setEditingApiForm({ ...editingApiForm, assertVos: newVos });
                  },
                  placeholder: '200',
                  style: { flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace' },
                }),
                React.createElement('button', {
                  onClick: () => removeAssertion(j),
                  style: { border: 'none', background: 'transparent', color: '#e74c3c', cursor: 'pointer', fontSize: 16, padding: '2px 6px' },
                }, '×'),
              ])
            ),
          ),
        ]),
        React.createElement('button', {
          className: 'btn btn-primary btn-sm',
          onClick: saveApiEdit,
        }, '保存接口修改'),
      ]),
    ]);
  };

  // 渲染
  return React.createElement('div', null, [
    // Header
    React.createElement('div', { className: 'page-header', key: 'h' }, [
      React.createElement('h2', { key: 't' }, '回归验证'),
      React.createElement('div', { className: 'page-header-actions', key: 'a' }, [
        // 展开模式的 Case 选择器
        caseList && caseList.length > 1 && React.createElement('div', {
          key: 'case-selector',
          style: { display: 'flex', alignItems: 'center', gap: 6, marginRight: 12 },
        }, [
          React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary)' } }, '用例:'),
          React.createElement('select', {
            value: currentCaseIndex,
            onChange: e => {
              const idx = parseInt(e.target.value);
              setCurrentCaseIndex(idx);
              setCaseVo(caseList[idx]);
              setResults(null);
            },
            style: { padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--bg)', color: 'var(--text)' },
          }, caseList.map((c, i) =>
            React.createElement('option', { key: i, value: i },
              (c.name || '用例 ' + (i + 1)) + (i === 0 ? ' (默认)' : ''))
          )),
          React.createElement('span', { style: { fontSize: 11, color: 'var(--text-tertiary)' } },
            caseList.length + ' 个'),
        ]),
        React.createElement('button', {
          className: 'btn btn-primary btn-lg',
          onClick: handleRunRegression,
          disabled: running || !caseVo,
          key: 'run',
          style: { minWidth: 160 },
        }, running ? '验证中...' : '▶ 执行回归验证'),
      ]),
    ]),

    // 数据池模式指示器
    (iterationMode === 'loop' || (caseList && caseList.length > 1)) && React.createElement('div', {
      className: 'card',
      key: 'mode-info',
      style: { background: 'var(--bg-info, #e8f4fd)', border: '1px solid var(--primary, #3498db)' },
    }, [
      React.createElement('div', { style: { padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 } }, [
        React.createElement('span', { style: { fontSize: 18 } }, iterationMode === 'loop' ? '🔄' : '📋'),
        React.createElement('div', { style: { flex: 1 } }, [
          React.createElement('div', { style: { fontWeight: 600, fontSize: 14 } },
            iterationMode === 'loop'
              ? '循环模式 — 数据池驱动'
              : '展开模式 — ' + caseList.length + ' 个用例'),
          React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 } },
            iterationMode === 'loop'
              ? '数据池: ' + (dataPoolConfig?.name || '-') + ' | ' + (dataPoolConfig?.rowCount || 0) + ' 行数据'
              : '当前: ' + (caseVo?.name || ('用例 ' + (currentCaseIndex + 1)))),
        ]),
      ]),
    ]),

    // 用例概览
    caseVo
      ? React.createElement('div', { className: 'card', key: 'overview' }, [
          React.createElement('div', { className: 'card-header', key: 'h' },
            React.createElement('div', { className: 'card-title', key: 't' }, '用例概览'),
          ),
          React.createElement('div', { className: 'stats-grid', key: 'grid' }, [
            React.createElement('div', { className: 'stat-card', key: 'name' }, [
              React.createElement('div', { className: 'stat-card-header' },
                React.createElement('div', { className: 'stat-icon blue' }, '用例')),
              React.createElement('div', { className: 'stat-value', style: { fontSize: 18, wordBreak: 'break-all' } },
                caseVo.name || '-'),
              React.createElement('div', { className: 'stat-label' }, '用例名称'),
            ]),
            React.createElement('div', { className: 'stat-card', key: 'apis' }, [
              React.createElement('div', { className: 'stat-card-header' },
                React.createElement('div', { className: 'stat-icon cyan' }, 'API')),
              React.createElement('div', { className: 'stat-value' }, caseVo.apiCount || (caseVo.apiVos ? caseVo.apiVos.length : 0)),
              React.createElement('div', { className: 'stat-label' }, '接口数'),
            ]),
            React.createElement('div', { className: 'stat-card', key: 'env' }, [
              React.createElement('div', { className: 'stat-card-header' },
                React.createElement('div', { className: 'stat-icon amber' }, '环境')),
              React.createElement('div', { className: 'stat-value' },
                ['DEV', 'TEST', 'PRE', 'PROD'][caseVo.environment] || '?'),
              React.createElement('div', { className: 'stat-label' }, '环境'),
            ]),
          ]),
        ])
      : React.createElement('div', { className: 'card', key: 'empty' }, [
          React.createElement('div', { className: 'card-header', key: 'h' },
            React.createElement('div', { className: 'card-title', key: 't' }, '用例概览')),
          React.createElement('div', { className: 'empty-state', key: 'e' }, [
            React.createElement('span', { className: 'empty-state-icon' }, '🚀'),
            React.createElement('h3', null, '暂无用例数据'),
            React.createElement('p', null, '请先完成管道处理生成用例'),
          ]),
        ]),

    // 可编辑接口列表（无回归结果时显示）
    !results?.results && caseVo?.apiVos && caseVo.apiVos.length > 0 &&
      React.createElement('div', { className: 'card', key: 'api-list' }, [
        React.createElement('div', { className: 'card-header', key: 'h' }, [
          React.createElement('div', { className: 'card-title', key: 't' },
            '📋 接口列表 (' + caseVo.apiVos.length + ')'),
          React.createElement('div', { key: 'actions', style: { display: 'flex', gap: 6, alignItems: 'center' }}, [
            React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary)' }},
              Object.values(selectedApis).filter(Boolean).length > 0
                ? '已选 ' + Object.values(selectedApis).filter(Boolean).length : ''),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}, [
              React.createElement('input', {
                type: 'checkbox',
                checked: caseVo.apiVos.every((_, i) => selectedApis[i]),
                onChange: toggleSelectAll,
              }),
              '全选',
            ]),
            React.createElement('button', {
              className: 'btn btn-sm',
              onClick: deleteSelectedApis,
              disabled: Object.values(selectedApis).filter(Boolean).length === 0,
              style: { color: Object.values(selectedApis).filter(Boolean).length > 0 ? '#e74c3c' : 'var(--text-secondary)', fontSize: 12 },
            }, '删除选中'),
          ]),
        ]),
        React.createElement('div', { key: 'list', style: { padding: '8px 16px' }},
          caseVo.apiVos.map((api, i) => renderApiCardFromCaseVo(api, i))
        ),
      ]),

    // 执行中状态 — 实时日志窗口+进度条
    running && React.createElement('div', { className: 'card', key: 'running', style: { marginBottom: 16 } }, [
      React.createElement('div', { className: 'card-header', key: 'h' }, [
        React.createElement('div', { className: 'card-title', key: 't' }, [
          '⏳ 正在执行回归验证',
          React.createElement('span', { style: { marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)' } },
            regressionProgress + '%'),
        ]),
      ]),
      // 进度条
      React.createElement('div', { style: { padding: '0 16px', marginBottom: 8 }, key: 'bar-wrap' },
        React.createElement('div', {
          style: {
            width: '100%', height: 6, background: 'var(--border)', borderRadius: 3,
            overflow: 'hidden',
          },
        },
          React.createElement('div', {
            style: {
              width: regressionProgress + '%', height: '100%',
              background: 'linear-gradient(90deg, #6366f1, #22c55e)',
              borderRadius: 3, transition: 'width 0.3s ease',
            },
          })
        )
      ),
      // 日志窗口
      React.createElement('div', {
        ref: logContainerRef,
        style: {
          margin: '0 16px 12px 16px', maxHeight: 280, overflowY: 'auto',
          background: 'var(--bg-secondary, #1a1a2e)', borderRadius: 6,
          padding: '8px 12px', fontFamily: 'monospace', fontSize: 12,
          lineHeight: 1.6, border: '1px solid var(--border)',
        },
        key: 'logs',
      },
        regressionLogs.length === 0
          ? React.createElement('div', { style: { color: 'var(--text-tertiary)', textAlign: 'center', padding: 12 } }, '准备中...')
          : regressionLogs.map((entry, i) =>
              React.createElement('div', { key: i, style: { color: '#e2e8f0', whiteSpace: 'nowrap' } }, [
                React.createElement('span', { style: { color: '#64748b', marginRight: 8 } }, entry.time),
                React.createElement('span', { style: { color: entry.progress >= 100 ? '#22c55e' : '#94a3b8' } }, entry.message),
              ])
            )
      ),
    ]),

    // 结果统计
    results?.stats &&
      React.createElement('div', { className: 'card', key: 'stats' }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title', key: 't' }, '📊 验证结果统计'),
        ),
        React.createElement('div', { className: 'stats-grid', key: 'grid' }, [
          React.createElement('div', { className: 'stat-card', key: 'passed' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon green' }, '✓')),
            React.createElement('div', { className: 'stat-value', style: { color: 'var(--success)' } },
              results.stats.passed || 0),
            React.createElement('div', { className: 'stat-label' }, '通过'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'failed',
            onClick: () => scrollToFirstFailed('failed'),
            style: { cursor: results.stats.failed > 0 ? 'pointer' : 'default' },
          }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon red' }, '✕')),
            React.createElement('div', { className: 'stat-value', style: { color: 'var(--danger)' } },
              results.stats.failed || 0),
            React.createElement('div', { className: 'stat-label' }, '失败'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'error',
            onClick: () => scrollToFirstFailed('error'),
            style: { cursor: results.stats.error > 0 ? 'pointer' : 'default' },
          }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon amber' }, '!')),
            React.createElement('div', { className: 'stat-value', style: { color: 'var(--warning)' } },
              results.stats.error || 0),
            React.createElement('div', { className: 'stat-label' }, '错误'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'total' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon blue' }, '∑')),
            React.createElement('div', { className: 'stat-value' }, results.stats.total || 0),
            React.createElement('div', { className: 'stat-label' }, '总计'),
            results.stats.passed > 0 &&
              React.createElement('div', { className: 'stat-trend' },
                '通过率 ' + results.stats.passRate + '%'),
          ]),
        ]),
        results.stats.totalAssertions > 0 &&
          React.createElement('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' } },
            '断言 ' + results.stats.passedAssertions + '/' + results.stats.totalAssertions + ' 通过 (' + results.stats.assertionPassRate + '%)'),
      // 循环模式数据行统计
      (iterationMode === 'loop' && dataPoolConfig) && React.createElement('div', {
        style: { marginTop: 4, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' },
      }, '数据池: ' + (dataPoolConfig.name || '-') + ' | ' + (dataPoolConfig.rowCount || 0) + ' 行'),
      ]),

    // 各接口结果列表
    results?.results && results.results.length > 0 &&
      React.createElement('div', { className: 'card', key: 'details' }, [
        React.createElement('div', { className: 'card-header', key: 'h' }, [
          React.createElement('div', { className: 'card-title', key: 't' },
            '接口执行详情 (' + results.results.length + ')'),
          React.createElement('div', { key: 'actions', style: { display: 'flex', gap: 6, alignItems: 'center' }}, [
            React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary)' }},
              Object.values(selectedApis).filter(Boolean).length > 0
                ? '已选 ' + Object.values(selectedApis).filter(Boolean).length
                : ''),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}, [
              React.createElement('input', {
                type: 'checkbox',
                checked: caseVo?.apiVos && Object.keys(selectedApis).length > 0 && caseVo.apiVos.every((_, i) => selectedApis[i]),
                onChange: toggleSelectAll,
              }),
              '全选',
            ]),
            React.createElement('button', {
              className: 'btn btn-sm',
              onClick: deleteSelectedApis,
              disabled: Object.values(selectedApis).filter(Boolean).length === 0,
              style: { color: Object.values(selectedApis).filter(Boolean).length > 0 ? '#e74c3c' : 'var(--text-secondary)', fontSize: 12 },
            }, '删除选中'),
          ]),
        ]),
        React.createElement('div', { key: 'jump-bar', style: { padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--border)' }}, [
          React.createElement('input', {
            type: 'text', key: 'jump',
            placeholder: '#跳转',
            value: jumpToInput,
            onChange: e => setJumpToInput(e.target.value.replace(/[^0-9]/g, '')),
            onKeyDown: e => { if (e.key === 'Enter') jumpToResult(); },
            style: { width: 72, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--bg)', color: 'var(--text)' },
          }),
          React.createElement('button', {
            className: 'btn btn-sm',
            onClick: jumpToResult,
            style: { padding: '2px 8px', fontSize: 12 },
          }, '跳转'),
          changed && React.createElement('span', { style: { fontSize: 11, color: 'var(--warning)', marginLeft: 8 }}, '有未保存的修改'),
        ]),
        React.createElement('div', { key: 'list', ref: listRef },
          results.results.map((r, i) => renderResultDetail(r, i))
        ),
      ]),

    // 完成后操作按钮
    (results?.stats || changed) &&
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'center', gap: 16, marginTop: 24 },
        key: 'actions',
      }, [
        changed && React.createElement('button', {
          className: 'btn btn-primary btn-lg',
          onClick: handleSave,
          key: 'save',
          style: { minWidth: 150 },
        }, '💾 保存修改'),
        React.createElement('button', {
          className: 'btn btn-success btn-lg',
          onClick: () => goToPage('export'),
          key: 'export',
          style: { minWidth: 180 },
        }, '导出用例'),
        React.createElement('button', {
          className: 'btn btn-primary btn-lg',
          onClick: () => goToPage('reports'),
          key: 'report',
          style: { minWidth: 180 },
        }, '查看报告'),
        React.createElement('button', {
          className: 'btn',
          onClick: () => goToPage('pipeline'),
          key: 'back',
        }, '返回管道'),
      ]),
  ]);
};
