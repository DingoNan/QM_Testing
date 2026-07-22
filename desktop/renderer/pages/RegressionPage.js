// RegressionPage.js - 回归验证页面
// 功能: 加载管道输出，对每个接口发送真实HTTP请求，验证断言并展示结果
const RegressionPage = () => {
  const [caseVo, setCaseVo] = React.useState(null);
  const [results, setResults] = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const [expandedResult, setExpandedResult] = React.useState(null);
  const [jumpToInput, setJumpToInput] = React.useState('');
  const listRef = React.useRef(null);

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
    setResults(null);
    try {
      const result = await window.appApi.runRegression({ outDir });
      if (result.success) {
        setResults(result);
        window.appApi.showToast(
          '回归完成: ' + (result.stats?.passed || 0) + '/' + (result.stats?.total || 0) + ' 通过',
          result.stats?.failed === 0 && result.stats?.error === 0 ? 'success' : 'warning'
        );
        // 自动保存测试报告
        try {
          const reportData = {
            caseName: result.caseName || state.pipelineResult?.caseVo?.name || '',
            stats: result.stats,
            results: result.results,
            timestamp: result.timestamp || new Date().toISOString(),
            environment: result.environment || '',
            apiCount: result.apiCount || (result.results ? result.results.length : 0),
          };
          await window.appApi.saveRegressionReport(reportData);
        } catch (saveErr) {
          console.warn('保存测试报告失败:', saveErr);
        }
      } else {
        window.appApi.showToast('回归失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('回归失败: ' + e.message, 'error');
    }
    setRunning(false);
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

    return React.createElement('div', {
      className: 'regression-card' + (isExpanded ? ' expanded' : ''),
      key: i,
    }, [
      // 头部（可点击展开）
      React.createElement('div', {
        className: 'regression-card-header',
        onClick: () => toggleExpand(i),
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', cursor: 'pointer', borderBottom: isExpanded ? '1px solid var(--border)' : 'none' },
      }, [
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 }, key: 'left' }, [
          React.createElement('span', { className: 'tag tag-info', style: { marginRight: 4, fontSize: 11 }}, '#' + (i + 1)),
          React.createElement('span', { className: 'method-badge method-' + r.method.toLowerCase() }, r.method),
          React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 13, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.url || '-'),
        ]),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 }, key: 'right' }, [
          React.createElement('span', { className: 'tag ' + statusClass }, statusText),
          r.responseStatus && React.createElement('span', { className: 'tag tag-info' }, String(r.responseStatus)),
          React.createElement('span', { style: { fontSize: 12, color: 'var(--text-tertiary)' } },
            r.duration ? r.duration + 'ms' : ''),
          React.createElement('span', { style: { color: 'var(--text-tertiary)', fontSize: 12 } },
            isExpanded ? '收起' : '展开'),
        ]),
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

  // 渲染
  return React.createElement('div', null, [
    // Header
    React.createElement('div', { className: 'page-header', key: 'h' }, [
      React.createElement('h2', { key: 't' }, '回归验证'),
      React.createElement('div', { className: 'page-header-actions', key: 'a' }, [
        React.createElement('button', {
          className: 'btn btn-primary btn-lg',
          onClick: handleRunRegression,
          disabled: running || !caseVo,
          key: 'run',
          style: { minWidth: 160 },
        }, running ? '验证中...' : '▶ 执行回归验证'),
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

    // 执行中状态
    running && React.createElement('div', {
      className: 'card',
      key: 'running',
      style: { textAlign: 'center', padding: 24 },
    }, [
      React.createElement('div', { className: 'loading-spinner', key: 'spinner' }),
      React.createElement('p', { key: 'text', style: { marginTop: 12, color: 'var(--text-secondary)' } },
        '正在执行回归验证，请稍候...'),
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
      ]),

    // 各接口结果列表
    results?.results && results.results.length > 0 &&
      React.createElement('div', { className: 'card', key: 'details' }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title', key: 't' },
            '接口执行详情 (' + results.results.length + ')'),
        ),
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
        ]),
        React.createElement('div', { key: 'list', ref: listRef },
          results.results.map((r, i) => renderResultDetail(r, i))
        ),
      ]),

    // 完成后操作按钮
    results?.stats &&
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'center', gap: 16, marginTop: 24 },
        key: 'actions',
      }, [
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
