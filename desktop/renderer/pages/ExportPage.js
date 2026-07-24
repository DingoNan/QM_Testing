// ExportPage.jsx - Modern Export/Import Page
// 从 pipelineStore 的 outDir 加载用例数据
const ExportPage = () => {
  const [caseVo, setCaseVo] = React.useState(null);
  const [exporting, setExporting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [outDir, setOutDir] = React.useState('');
  // 平台导入表单
  const [platformUrl, setPlatformUrl] = React.useState('');
  const [apiToken, setApiToken] = React.useState('');
  const [importResult, setImportResult] = React.useState(null);

  // 获取 case-save.json 路径
  const getCasePath = () => {
    const dir = outDir || pipelineStore.getState().outDir || '';
    return dir ? dir + '/case-save.json' : 'case-save.json';
  };

  React.useEffect(() => {
    (async () => {
      try {
        const state = pipelineStore.getState();
        const dir = state.outDir || '';
        setOutDir(dir);

        // 优先从 pipelineStore 的 pipelineResult 获取
        if (state.pipelineResult?.caseVo) {
          setCaseVo(state.pipelineResult.caseVo);
          return;
        }

        // 从 outDir 读取
        const casePath = dir ? dir + '/case-save.json' : 'case-save.json';
        const r = await window.appApi.readFile(casePath);
        if (r) setCaseVo(r);
      } catch {}
    })();
  }, []);

  // 读取用例数据（带 outDir 优先）
  const readCaseData = async () => {
    const casePath = getCasePath();
    // 如果有 pipelineStore 缓存，优先使用
    const state = pipelineStore.getState();
    if (state.pipelineResult?.caseVo) return state.pipelineResult.caseVo;
    return await window.appApi.readFile(casePath);
  };

  const handleExportJSON = async () => {
    setExporting(true);
    try {
      const data = await readCaseData();
      if (!data) {
        window.appApi.showToast('没有可导出的用例数据', 'warning');
        setExporting(false);
        return;
      }
      // 使用 file:export 打开保存对话框
      const savedPath = await window.appApi.fileExport({ data, defaultName: 'case-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (savedPath) {
        window.appApi.showToast('用例导出成功: ' + savedPath, 'success');
      }
    } catch (e) {
      window.appApi.showToast('导出失败: ' + e.message, 'error');
    }
    setExporting(false);
  };

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const data = await readCaseData();
      if (!data) {
        window.appApi.showToast('没有可导出的用例数据', 'warning');
        setExporting(false);
        return;
      }
      // CSV 导出
      const apis = data.apiVos || [];
      const headers = ['序号', '接口名称', '请求方法', 'URL', '请求头', '请求体'];
      const rows = apis.map((api, i) => [
        i + 1,
        api.apiName || '',
        api.apiMethod || '',
        (api.domainName || '') + (api.apiUrl || ''),
        api.requestHeaders || '',
        typeof api.requestBody === 'object' ? JSON.stringify(api.requestBody) : (api.requestBody || ''),
      ]);
      const csv = [headers, ...rows].map(row => row.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
      // 使用 file:export 打开保存对话框
      const savedPath = await window.appApi.fileExport({ data: csv, defaultName: 'case-export.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (savedPath) {
        window.appApi.showToast('CSV 导出成功: ' + savedPath, 'success');
      }
    } catch (e) {
      window.appApi.showToast('CSV 导出失败: ' + e.message, 'error');
    }
    setExporting(false);
  };

  const handlePlatformImport = async () => {
    if (!platformUrl) { window.appApi.showToast('请输入平台地址', 'warning'); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const data = await readCaseData();
      if (!data) {
        window.appApi.showToast('没有可导入的用例数据', 'warning');
        setImporting(false);
        return;
      }
      const result = await window.appApi.platformImportCase({ caseVo: data, platformUrl, apiToken });
      setImportResult(result);
      if (result.success) {
        window.appApi.showToast('平台导入成功! HTTP ' + result.statusCode, 'success');
      } else {
        window.appApi.showToast('导入失败: HTTP ' + result.statusCode + ' ' + (result.error || ''), 'error');
      }
    } catch (e) {
      setImportResult({ success: false, error: e.message });
      window.appApi.showToast('导入失败: ' + e.message, 'error');
    }
    setImporting(false);
  };

  return React.createElement('div', null, [
    React.createElement('div', { className: 'page-header', key: 'h' },
      React.createElement('h2', { key: 't' }, '📤 导出 / 导入'),
    ),

    // Case Summary
    caseVo &&
      React.createElement('div', { className: 'card', key: 'summary' }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title', key: 't' }, '📋 当前用例摘要'),
        ),
        React.createElement('div', { className: 'config-display', key: 'body' }, [
          React.createElement('span', { className: 'label' }, '用例名称'),
          React.createElement('span', { className: 'value' }, caseVo.name || '-'),
          React.createElement('span', { className: 'label' }, '接口数'),
          React.createElement('span', { className: 'value' }, caseVo.apiCount || 0),
          React.createElement('span', { className: 'label' }, '项目'),
          React.createElement('span', { className: 'value' }, caseVo.projectId || '-'),
          React.createElement('span', { className: 'label' }, '环境'),
          React.createElement('span', { className: 'value' },
            ['DEV', 'TEST', 'PRE', 'PROD'][caseVo.environment] || '?'),
        ]),
      ]),

    // Export Section
    React.createElement('div', { className: 'card', key: 'export' }, [
      React.createElement('div', { className: 'card-header', key: 'h' },
        React.createElement('div', { className: 'card-title', key: 't' }, '📤 导出用例文件'),
      ),
      React.createElement('p', {
        style: { color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 },
        key: 'desc',
      }, '将生成的用例导出为标准格式文件，便于备份或在其他平台使用。'),
      React.createElement('div', { style: { display: 'flex', gap: 12 }, key: 'btns' }, [
        React.createElement('button', {
          className: 'btn btn-primary',
          onClick: handleExportJSON,
          disabled: exporting || !caseVo,
          key: 'json',
        }, exporting ? '导出中...' : '📄 导出 JSON'),
        React.createElement('button', {
          className: 'btn btn-success',
          onClick: handleExportCSV,
          disabled: exporting || !caseVo,
          key: 'csv',
        }, exporting ? '导出中...' : '📊 导出 CSV'),
      ]),
    ]),

    // Import to Platform Section
    React.createElement('div', { className: 'card', key: 'import' }, [
      React.createElement('div', { className: 'card-header', key: 'h' },
        React.createElement('div', { className: 'card-title', key: 't' }, '🌐 导入测试平台'),
      ),
      React.createElement('p', {
        style: { color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 },
        key: 'desc',
      }, '直接导入 MeterSphere 或兼容 API 测试平台。'),
      React.createElement('div', { className: 'form-group', key: 'url' },
        React.createElement('label', null, '平台地址'),
        React.createElement('input', {
          placeholder: 'https://metersphere.example.com/api/case/import',
          value: platformUrl,
          onChange: e => setPlatformUrl(e.target.value),
          style: { width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
        }),
      ),
      React.createElement('div', { className: 'form-group', key: 'token' },
        React.createElement('label', null, 'API Token'),
        React.createElement('input', {
          type: 'password',
          placeholder: '输入平台 API Token',
          value: apiToken,
          onChange: e => setApiToken(e.target.value),
          style: { width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
        }),
      ),
      React.createElement('button', {
        className: 'btn btn-primary',
        onClick: handlePlatformImport,
        disabled: importing || !caseVo || !platformUrl,
        style: { marginTop: 4 },
        key: 'submit',
      }, importing ? '导入中...' : '🚀 导入平台'),
      // 导入结果
      importResult && React.createElement('div', { key: 'result', style: { marginTop: 8, fontSize: 12 } }, [
        React.createElement('span', {
          style: { color: importResult.success ? '#27ae60' : '#e74c3c', fontWeight: 600 },
        }, importResult.success ? '✅ 导入成功' : '❌ 导入失败'),
        importResult.statusCode && React.createElement('span', { style: { marginLeft: 8 } }, 'HTTP ' + importResult.statusCode),
        importResult.response && React.createElement('pre', { style: { marginTop: 4, maxHeight: 100, overflow: 'auto', fontSize: 11, background: 'var(--bg-secondary)', padding: 6, borderRadius: 4 } }, importResult.response),
      ]),
    ]),
  ]);
};
