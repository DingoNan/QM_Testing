// ReportsPage.js - 测试报告页面
// 功能: 查看历史回归测试报告，支持同一用例不同运行结果对比
const ReportsPage = () => {
  // view: 'list' | 'detail' | 'compare'
  const [view, setView] = React.useState('list');
  const [reports, setReports] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [searchCase, setSearchCase] = React.useState('');
  const [selectedReport, setSelectedReport] = React.useState(null);

  const [compareResult, setCompareResult] = React.useState(null);
  const [expandedDetail, setExpandedDetail] = React.useState(null);
  const [expandedCompare, setExpandedCompare] = React.useState(null);
  const [selectedForDelete, setSelectedForDelete] = React.useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [jumpToInput, setJumpToInput] = React.useState('');
  const detailListRef = React.useRef(null);
  const compareListRef = React.useRef(null);

  // 加载报告列表
  const loadReports = React.useCallback(async (caseFilter) => {
    setLoading(true);
    try {
      const list = await window.appApi.listRegressionReports(caseFilter || undefined);
      if (Array.isArray(list)) {
        setReports(list);
      } else {
        setReports([]);
      }
    } catch (e) {
      console.warn('加载报告列表失败:', e);
      setReports([]);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadReports();
  }, [loadReports]);

  // 搜索
  const handleSearch = () => {
    loadReports(searchCase.trim() || undefined);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  // 查看详情
  const handleViewDetail = async (report) => {
    try {
      const full = await window.appApi.getRegressionReport(report.id);
      if (full) {
        setSelectedReport(full);
        setView('detail');
      }
    } catch (e) {
      console.warn('读取报告详情失败:', e);
    }
  };



  // 执行对比
  const handleCompare = async () => {
    if (selectedForDelete.length !== 2) return;
    try {
      const result = await window.appApi.compareRegressionReports(selectedForDelete[0], selectedForDelete[1]);
      if (result && result.success) {
        setCompareResult(result);
        setView('compare');
      } else {
        window.appApi.showToast('对比失败: ' + (result?.error || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('对比失败: ' + e.message, 'error');
    }
  };

  // 返回列表
  const backToList = () => {
    setView('list');
    setSelectedReport(null);
    setCompareResult(null);
    setExpandedDetail(null);
    setExpandedCompare(null);
  };

  // 删除操作
  const handleDeleteReport = async (reportId) => {
    try {
      await window.appApi.deleteRegressionReport(reportId);
      setReports(prev => prev.filter(r => r.id !== reportId));
      window.appApi.showToast('报告已删除', 'success');
    } catch (e) {
      window.appApi.showToast('删除失败: ' + e.message, 'error');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedForDelete.length === 0) return;
    setDeleting(true);
    try {
      const result = await window.appApi.deleteRegressionReports(selectedForDelete);
      if (result.success) {
        setReports(prev => prev.filter(r => !selectedForDelete.includes(r.id)));
        setSelectedForDelete([]);
        window.appApi.showToast('已删除 ' + result.deletedCount + ' 份报告', 'success');
      } else {
        window.appApi.showToast('删除失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('删除失败: ' + e.message, 'error');
    }
    setDeleting(false);
    setShowDeleteConfirm(false);
  };

  const toggleSelect = (reportId) => {
    setSelectedForDelete(prev =>
      prev.includes(reportId)
        ? prev.filter(id => id !== reportId)
        : [...prev, reportId]
    );
  };

  // === 格式化 ===
  const formatDate = (iso) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { return iso; }
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

  const getStatusLabel = (r) => {
    if (!r) return '-';
    if (r.error) return '错误';
    return r.passed ? '通过' : '失败';
  };

  const getStatusClass = (r) => {
    if (!r) return '';
    if (r.error) return 'tag-error';
    return r.passed ? 'tag-success' : 'tag-warning';
  };

  // === 渲染: 列表视图 ===
  const renderListView = () => React.createElement('div', { key: 'list' }, [
    // 页面头
    React.createElement('div', { className: 'page-header', key: 'h' }, [
      React.createElement('h2', { key: 't' }, '测试报告'),
      React.createElement('div', { className: 'page-header-actions', key: 'a' }, [
        React.createElement('button', {
          className: 'btn btn-sm',
          onClick: () => loadReports(),
          disabled: loading,
          key: 'refresh',
        }, loading ? '加载中...' : '刷新'),
      ]),
    ]),

    // 搜索和对比操作栏
    React.createElement('div', {
      className: 'card',
      key: 'toolbar',
      style: { marginBottom: 16 },
    }, [
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' },
        key: 'bar',
      }, [
        React.createElement('input', {
          className: 'input',
          key: 'search',
          type: 'text',
          placeholder: '按用例名称搜索...',
          value: searchCase,
          onChange: (e) => setSearchCase(e.target.value),
          onKeyDown: handleKeyDown,
          style: { flex: 1, maxWidth: 320 },
        }),
        React.createElement('button', {
          className: 'btn btn-sm btn-primary',
          onClick: handleSearch,
          key: 'searchBtn',
        }, '搜索'),
        React.createElement('span', {
          style: { color: 'var(--text-tertiary)', fontSize: 12, marginLeft: 8 },
          key: 'count',
        }, '共 ' + reports.length + ' 份报告'),
        selectedForDelete.length === 2 && React.createElement('button', {
          className: 'btn btn-sm btn-success',
          onClick: handleCompare,
          key: 'compareBtn',
          style: { marginLeft: 'auto' },
        }, '对比选中 (2)'),
        selectedForDelete.length > 0 && React.createElement('button', {
          className: 'btn btn-sm',
          onClick: () => setShowDeleteConfirm(true),
          key: 'deleteSelected',
          style: { color: 'var(--danger)', marginLeft: 8 },
        }, '删除选中 (' + selectedForDelete.length + ')'),
        selectedForDelete.length > 0 && React.createElement('button', {
          className: 'btn btn-sm',
          onClick: () => setSelectedForDelete([]),
          key: 'clearBtn',
          style: { color: 'var(--danger)' },
        }, '取消选择'),
      ]),
    ]),

    // 报告列表
    loading
      ? React.createElement('div', { className: 'page-loading', key: 'load' }, '加载中...')
      : reports.length === 0
        ? React.createElement('div', { className: 'card', key: 'empty' }, [
            React.createElement('div', { className: 'empty-state', key: 'e' }, [
              React.createElement('span', { className: 'empty-state-icon', key: 'icon' }, ''),
              React.createElement('h3', { key: 't' }, '暂无测试报告'),
              React.createElement('p', { key: 'd' }, '执行回归验证后，测试报告将自动生成并显示在这里'),
            ]),
          ])
        : React.createElement('div', { className: 'report-cards-grid', key: 'grid' },
            reports.map((r, i) => {
              const isSelected = selectedForDelete.includes(r.id);
              return React.createElement('div', {
                className: 'report-card' + (isSelected ? ' selected' : ''),
                key: r.id || i,
              }, [
                // 选择框（勾选后可用于对比或批量删除）
                React.createElement('div', {
                  className: 'report-card-checkbox',
                  key: 'cb',
                  style: { display: 'flex', alignItems: 'center', padding: '0 8px 0 0' },
                }, [
                  React.createElement('input', {
                    type: 'checkbox',
                    key: 'check',
                    checked: selectedForDelete.includes(r.id),
                    onChange: () => toggleSelect(r.id),
                    title: selectedForDelete.length === 2 ? '已选 2 项，可对比' : '选择',
                  }),
                ]),
                // 卡片内容
                React.createElement('div', { className: 'report-card-body', key: 'body' }, [
                  // 名称和时间
                  React.createElement('div', { className: 'report-card-header-row', key: 'h' }, [
                    React.createElement('span', { className: 'report-card-name', key: 'name' },
                      r.caseName || '未命名'),
                    React.createElement('span', { className: 'report-card-time', key: 'time' },
                      formatDate(r.timestamp)),
                  ]),
                  // 进度条
                  React.createElement('div', { className: 'report-card-progress', key: 'prog' }, [
                    React.createElement('div', { className: 'report-progress-bar', key: 'bar' }, [
                      React.createElement('div', {
                        className: 'report-progress-fill',
                        style: { width: (r.passRate || 0) + '%' },
                        key: 'fill',
                      }),
                    ]),
                    React.createElement('span', {
                      className: 'report-progress-text',
                      key: 'pct',
                    }, (r.passRate || 0) + '%'),
                  ]),
                  // 统计行
                  React.createElement('div', { className: 'report-card-stats', key: 'stats' }, [
                    React.createElement('span', { className: 'stat-pass', key: 'p' },
                      '通过 ' + (r.passed || 0)),
                    React.createElement('span', { className: 'stat-fail', key: 'f' },
                      '失败 ' + (r.failed || 0)),
                    React.createElement('span', { className: 'stat-error', key: 'e' },
                      '错误 ' + (r.error || 0)),
                    React.createElement('span', { className: 'stat-total', key: 't' },
                      '总计 ' + (r.total || 0)),
                  ]),
                  // 环境信息
                  r.environment ? React.createElement('div', {
                    className: 'report-card-env',
                    key: 'env',
                    style: { fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 },
                  }, '环境: ' + r.environment) : null,
                ]),
                // 操作按钮
                React.createElement('div', { className: 'report-card-actions', key: 'actions' }, [
                  React.createElement('button', {
                    className: 'btn btn-sm btn-primary',
                    onClick: () => handleViewDetail(r),
                    key: 'view',
                  }, '查看详情'),
                  React.createElement('button', {
                    className: 'btn btn-sm',
                    onClick: () => handleDeleteReport(r.id),
                    key: 'del',
                    style: { color: 'var(--danger)' },
                  }, '删除'),
                ]),
              ]);
            })
          ),

    // 批量删除确认弹窗
    showDeleteConfirm && React.createElement('div', {
      className: 'modal-overlay', key: 'delete-confirm',
      style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
      onClick: () => !deleting && setShowDeleteConfirm(false),
    }, React.createElement('div', {
      style: { background: 'var(--bg)', padding: 24, borderRadius: 8, minWidth: 380 },
      onClick: e => e.stopPropagation(),
    }, [
      React.createElement('h4', { key: 't', style: { marginBottom: 12 } }, '确认删除'),
      React.createElement('p', { key: 'msg', style: { marginBottom: 20, color: 'var(--text-secondary)' } },
        '确定要删除选中的 ' + selectedForDelete.length + ' 份测试报告吗？此操作不可恢复。'),
      React.createElement('div', { key: 'btns', style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } }, [
        React.createElement('button', {
          className: 'btn btn-sm',
          onClick: () => setShowDeleteConfirm(false),
          disabled: deleting,
          key: 'cancel',
        }, '取消'),
        React.createElement('button', {
          className: 'btn btn-sm',
          onClick: handleBatchDelete,
          disabled: deleting,
          key: 'confirm',
          style: { background: 'var(--danger)', color: '#fff' },
        }, deleting ? '删除中...' : '确认删除'),
      ]),
    ])),
  ]);

  // === 渲染: 详情视图 ===
  const renderDetailView = () => {
    if (!selectedReport) return null;
    const { stats, results } = selectedReport;

    const jumpToItem = () => {
      const n = parseInt(jumpToInput);
      const total = results?.length || 0;
      if (isNaN(n) || n < 1 || n > total) {
        window.appApi.showToast('请输入 1-' + total + ' 之间的序号', 'warning');
        return;
      }
      setExpandedDetail(n - 1);
      setTimeout(() => {
        const el = detailListRef.current?.querySelector('.report-card-item:nth-child(' + n + ')');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.transition = 'box-shadow 0.3s';
          el.style.boxShadow = '0 0 0 2px var(--primary)';
          setTimeout(() => { el.style.boxShadow = ''; }, 2000);
        }
      }, 100);
      setJumpToInput('');
    };

    return React.createElement('div', { key: 'detail' }, [
      // 返回按钮
      React.createElement('div', { className: 'page-header', key: 'h' }, [
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12 },
          key: 'back-row',
        }, [
          React.createElement('button', {
            className: 'btn btn-sm',
            onClick: backToList,
            key: 'back',
          }, '← 返回列表'),
          React.createElement('h2', { key: 't' }, '测试报告详情'),
        ]),
      ]),

      // 用例概览
      React.createElement('div', { className: 'card', key: 'overview', style: { marginBottom: 16 } }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title', key: 't' }, '用例概览'),
        ),
        React.createElement('div', { className: 'stats-grid', key: 'grid' }, [
          React.createElement('div', { className: 'stat-card', key: 'name' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon blue' }, '用例')),
            React.createElement('div', { className: 'stat-value', style: { fontSize: 16, wordBreak: 'break-all' } },
              selectedReport.caseName || '-'),
            React.createElement('div', { className: 'stat-label' }, '用例名称'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'time' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon cyan' }, '时间')),
            React.createElement('div', { className: 'stat-value', style: { fontSize: 14 } },
              formatDate(selectedReport.timestamp)),
            React.createElement('div', { className: 'stat-label' }, '执行时间'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'env' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon amber' }, '环境')),
            React.createElement('div', { className: 'stat-value' },
              selectedReport.environment || '-'),
            React.createElement('div', { className: 'stat-label' }, '环境'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'apis' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon purple' }, 'API')),
            React.createElement('div', { className: 'stat-value' },
              selectedReport.apiCount || stats?.total || 0),
            React.createElement('div', { className: 'stat-label' }, '接口数'),
          ]),
        ]),
      ]),

      // 统计卡片
      stats && React.createElement('div', { className: 'card', key: 'stats', style: { marginBottom: 16 } }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title', key: 't' }, '验证结果统计'),
        ),
        React.createElement('div', { className: 'stats-grid', key: 'grid' }, [
          React.createElement('div', { className: 'stat-card', key: 'passed' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon green' }, '通过')),
            React.createElement('div', { className: 'stat-value', style: { color: 'var(--success)' } },
              stats.passed || 0),
            React.createElement('div', { className: 'stat-label' }, '通过'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'failed' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon red' }, 'X')),
            React.createElement('div', { className: 'stat-value', style: { color: 'var(--danger)' } },
              stats.failed || 0),
            React.createElement('div', { className: 'stat-label' }, '失败'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'error' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon amber' }, '!')),
            React.createElement('div', { className: 'stat-value', style: { color: 'var(--warning)' } },
              stats.error || 0),
            React.createElement('div', { className: 'stat-label' }, '错误'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'rate' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon blue' }, '%')),
            React.createElement('div', { className: 'stat-value' },
              (stats.passRate || 0) + '%'),
            React.createElement('div', { className: 'stat-label' }, '通过率'),
          ]),
        ]),
        stats.totalAssertions > 0 && React.createElement('div', {
          style: { marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' },
          key: 'assert',
        }, '断言 ' + (stats.passedAssertions || 0) + '/' + (stats.totalAssertions || 0) + ' 通过 (' + (stats.assertionPassRate || 0) + '%)'),
      ]),

      // 各接口详情
      results && results.length > 0 && React.createElement('div', { className: 'card', key: 'details' }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title', key: 't' },
            '接口执行详情 (' + results.length + ')'),
        ),
        React.createElement('div', { key: 'jump-bar', style: { padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--border)' }}, [
          React.createElement('input', {
            type: 'text', key: 'jump',
            placeholder: '#跳转',
            value: jumpToInput,
            onChange: e => setJumpToInput(e.target.value.replace(/[^0-9]/g, '')),
            onKeyDown: e => { if (e.key === 'Enter') jumpToItem(); },
            style: { width: 72, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--bg)', color: 'var(--text)' },
          }),
          React.createElement('button', {
            className: 'btn btn-sm',
            onClick: jumpToItem,
            style: { padding: '2px 8px', fontSize: 12 },
          }, '跳转'),
        ]),
        React.createElement('div', { key: 'list', ref: detailListRef },
          results.map((r, i) => renderResultCard(r, i)),
        ),
      ]),
    ]);
  };

  // 单条结果卡片（复用在详情和对比中）
  const renderResultCard = (r, i) => {
    const isExpanded = expandedDetail === i;
    const statusClass = r.error ? 'tag-error' : r.passed ? 'tag-success' : 'tag-warning';
    const statusText = r.error ? '错误' : r.passed ? '通过' : '失败';

    return React.createElement('div', {
      className: 'report-card-item' + (isExpanded ? ' expanded' : ''),
      key: i,
    }, [
      // 头部
      React.createElement('div', {
        className: 'report-card-item-header',
        onClick: () => setExpandedDetail(isExpanded ? null : i),
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', borderBottom: isExpanded ? '1px solid var(--border)' : 'none' },
      }, [
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 }, key: 'left' }, [
          React.createElement('span', { className: 'tag tag-info', style: { marginRight: 2, fontSize: 11 }}, '#' + (i + 1)),
          React.createElement('span', { className: 'method-badge method-' + (r.method || '').toLowerCase() }, r.method || '?'),
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
        className: 'report-card-item-body',
        style: { padding: 16 },
      }, [
        // 断言
        r.assertions && r.assertions.length > 0 && React.createElement('div', { key: 'asserts', style: { marginBottom: 14 } }, [
          React.createElement('h5', { style: { marginBottom: 6, fontSize: 13, color: 'var(--text-secondary)' } },
            '断言 (' + r.assertions.filter(a => a.passed).length + '/' + r.assertions.length + ')'),
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
        // 请求头
        React.createElement('div', { key: 'reqh', style: { marginBottom: 10 } }, [
          React.createElement('h5', { style: { marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' } }, '请求头'),
          React.createElement('div', { className: 'code-block' }, JSON.stringify(r.requestHeaders || {}, null, 2)),
        ]),
        r.requestBody !== undefined && r.requestBody !== null && r.requestBody !== '' &&
          React.createElement('div', { key: 'reqb', style: { marginBottom: 10 } }, [
            React.createElement('h5', { style: { marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' } }, '请求体'),
            React.createElement('div', { className: 'code-block' },
              typeof r.requestBody === 'object' ? JSON.stringify(r.requestBody, null, 2) : String(r.requestBody)),
          ]),
        r.responseHeaders &&
          React.createElement('div', { key: 'resh', style: { marginBottom: 10 } }, [
            React.createElement('h5', { style: { marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' } }, '响应头'),
            React.createElement('div', { className: 'code-block' }, JSON.stringify(r.responseHeaders, null, 2)),
          ]),
        r.responseBody &&
          React.createElement('div', { key: 'resb' }, [
            React.createElement('h5', { style: { marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' } }, '响应体'),
            React.createElement('div', { className: 'code-block', style: { maxHeight: 250, overflow: 'auto' } },
              formatJSON(r.responseBody)),
          ]),
        r.error &&
          React.createElement('div', { key: 'err', style: { marginTop: 8 } }, [
            React.createElement('h5', { style: { marginBottom: 4, fontSize: 13, color: 'var(--danger)' } }, '错误'),
            React.createElement('div', { className: 'code-block', style: { color: 'var(--danger)' } }, r.error),
          ]),
      ]),
    ]);
  };

  // === 渲染: 对比视图 ===
  const renderCompareView = () => {
    if (!compareResult) return null;
    const { report1, report2, comparison, summary } = compareResult;

    const jumpToCompareItem = () => {
      const n = parseInt(jumpToInput);
      const total = comparison?.length || 0;
      if (isNaN(n) || n < 1 || n > total) {
        window.appApi.showToast('请输入 1-' + total + ' 之间的序号', 'warning');
        return;
      }
      setExpandedCompare(n - 1);
      setTimeout(() => {
        const row = compareListRef.current?.querySelector('tr.diff-row-' + (comparison?.[n-1]?.diffType || 'unchanged'));
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.style.transition = 'box-shadow 0.3s';
          row.style.boxShadow = '0 0 0 2px var(--primary)';
          setTimeout(() => { row.style.boxShadow = ''; }, 2000);
        }
      }, 100);
      setJumpToInput('');
    };

    return React.createElement('div', { key: 'compare' }, [
      // 返回按钮
      React.createElement('div', { className: 'page-header', key: 'h' }, [
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12 },
          key: 'back-row',
        }, [
          React.createElement('button', {
            className: 'btn btn-sm',
            onClick: backToList,
            key: 'back',
          }, '← 返回列表'),
          React.createElement('h2', { key: 't' }, '报告对比'),
        ]),
      ]),

      // 对比概览
      React.createElement('div', { className: 'card', key: 'overview', style: { marginBottom: 16 } }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title', key: 't' }, '对比概览'),
        ),
        React.createElement('div', { className: 'stats-grid', key: 'grid' }, [
          // 第一次报告
          React.createElement('div', { className: 'stat-card', key: 'r1' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon blue' }, '1')),
            React.createElement('div', { className: 'stat-value', style: { fontSize: 14 } },
              report1?.caseName || '-'),
            React.createElement('div', { className: 'stat-label' }, '第一次: ' + formatDate(report1?.timestamp)),
            summary && React.createElement('div', { className: 'stat-sub', style: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 } },
              '通过率 ' + (report1?.stats?.passRate || 0) + '% (' + (report1?.stats?.passed || 0) + '/' + (report1?.stats?.total || 0) + ')'),
          ]),
          // 第二次报告
          React.createElement('div', { className: 'stat-card', key: 'r2' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon purple' }, '2')),
            React.createElement('div', { className: 'stat-value', style: { fontSize: 14 } },
              report2?.caseName || '-'),
            React.createElement('div', { className: 'stat-label' }, '第二次: ' + formatDate(report2?.timestamp)),
            summary && React.createElement('div', { className: 'stat-sub', style: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 } },
              '通过率 ' + (report2?.stats?.passRate || 0) + '% (' + (report2?.stats?.passed || 0) + '/' + (report2?.stats?.total || 0) + ')'),
          ]),
          // 差异汇总
          summary && React.createElement('div', { className: 'stat-card', key: 'diff' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon amber' }, '差异')),
            React.createElement('div', { className: 'stat-value', style: { fontSize: 14 } },
              '共 ' + summary.total + ' 接口'),
            React.createElement('div', { className: 'stat-label' }, '差异汇总'),
            React.createElement('div', { style: { fontSize: 12, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
              React.createElement('span', { className: 'diff-badge unchanged', key: 'u' },
                '不变 ' + summary.unchanged),
              React.createElement('span', { className: 'diff-badge improved', key: 'i' },
                '修复 ' + summary.improved),
              React.createElement('span', { className: 'diff-badge regressed', key: 'r' },
                '降级 ' + summary.regressed),
              React.createElement('span', { className: 'diff-badge added', key: 'a' },
                '新增 ' + summary.added),
              React.createElement('span', { className: 'diff-badge removed', key: 'rm' },
                '缺失 ' + summary.removed),
            ]),
          ]),
        ]),
      ]),

      // 对比表格
      comparison && comparison.length > 0 && React.createElement('div', { className: 'card', key: 'table' }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title', key: 't' },
            '接口对比 (' + comparison.length + ')'),
        ),
        React.createElement('div', { key: 'jump-bar', style: { padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--border)' }}, [
          React.createElement('input', {
            type: 'text', key: 'jump',
            placeholder: '#跳转',
            value: jumpToInput,
            onChange: e => setJumpToInput(e.target.value.replace(/[^0-9]/g, '')),
            onKeyDown: e => { if (e.key === 'Enter') jumpToCompareItem(); },
            style: { width: 72, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--bg)', color: 'var(--text)' },
          }),
          React.createElement('button', {
            className: 'btn btn-sm',
            onClick: jumpToCompareItem,
            style: { padding: '2px 8px', fontSize: 12 },
          }, '跳转'),
        ]),
        React.createElement('div', { className: 'table-wrapper', key: 'wrapper', ref: compareListRef },
          React.createElement('table', { className: 'table report-compare-table' }, [
            React.createElement('thead', { key: 'th' },
              React.createElement('tr', null, [
              React.createElement('th', { key: 'seq', style: { width: 40 } }, '#'),
                React.createElement('th', { key: 'method', style: { width: 70 } }, '方法'),
                React.createElement('th', { key: 'url' }, '接口路径'),
                React.createElement('th', { key: 's1', style: { width: 80 } }, '第一次'),
                React.createElement('th', { key: 's2', style: { width: 80 } }, '第二次'),
                React.createElement('th', { key: 'diff', style: { width: 80 } }, '差异'),
                React.createElement('th', { key: 'assert', style: { width: 140 } }, '断言变化'),
              ]),
            ),
            React.createElement('tbody', { key: 'tb' },
              comparison.map((c, idx) => {
                const isExpanded = expandedCompare === idx;
                let diffLabel = '-';
                let diffCls = 'diff-unchanged';
                if (c.diffType === 'added') { diffLabel = '新增'; diffCls = 'diff-added'; }
                else if (c.diffType === 'removed') { diffLabel = '缺失'; diffCls = 'diff-removed'; }
                else if (c.diffType === 'improved') { diffLabel = '修复'; diffCls = 'diff-improved'; }
                else if (c.diffType === 'regressed') { diffLabel = '降级'; diffCls = 'diff-regressed'; }

                const statusLabel1 = c.status1 === 'passed' ? '通过' : c.status1 === 'failed' ? '失败' : c.status1 === 'error' ? '错误' : '缺失';
                const statusLabel2 = c.status2 === 'passed' ? '通过' : c.status2 === 'failed' ? '失败' : c.status2 === 'error' ? '错误' : '缺失';

                return [
                  // 主行
                  React.createElement('tr', {
                    key: idx,
                    className: 'diff-row-' + c.diffType,
                    style: { cursor: 'pointer' },
                    onClick: () => setExpandedCompare(isExpanded ? null : idx),
                  }, [
                    React.createElement('td', { style: { width: 40, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}, '#' + (idx + 1)),
                    React.createElement('td', null,
                      React.createElement('span', { className: 'method-badge method-' + (c.method || '').toLowerCase() }, c.method || '?')),
                    React.createElement('td', { style: { fontFamily: 'monospace', fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                      c.url || '-'),
                    React.createElement('td', null,
                      React.createElement('span', { className: 'tag ' + (c.status1 === 'passed' ? 'tag-success' : 'tag-' + (c.status1 === 'error' ? 'error' : 'warning')) },
                        statusLabel1 + (c.responseStatus1 !== '-' ? ' ' + c.responseStatus1 : ''))),
                    React.createElement('td', null,
                      React.createElement('span', { className: 'tag ' + (c.status2 === 'passed' ? 'tag-success' : 'tag-' + (c.status2 === 'error' ? 'error' : 'warning')) },
                        statusLabel2 + (c.responseStatus2 !== '-' ? ' ' + c.responseStatus2 : ''))),
                    React.createElement('td', null,
                      React.createElement('span', { className: 'diff-badge ' + diffCls }, diffLabel)),
                    React.createElement('td', { style: { fontSize: 11, color: 'var(--text-secondary)' } },
                      c.assertChange || '-'),
                  ]),
                  // 展开的详情行
                  isExpanded && React.createElement('tr', { key: 'exp-' + idx, className: 'diff-detail-row' }, [
                    React.createElement('td', { colSpan: 7, style: { padding: '8px 16px', background: 'var(--bg-alt)' } }, [
                      React.createElement('div', { style: { fontSize: 12, display: 'flex', gap: 16, flexWrap: 'wrap' } }, [
                        React.createElement('span', { key: 'd1' },
                          '第一次耗时: ' + (c.duration1 || '-') + 'ms'),
                        React.createElement('span', { key: 'd2' },
                          '第二次耗时: ' + (c.duration2 || '-') + 'ms'),
                        c.error1 ? React.createElement('span', { key: 'e1', style: { color: 'var(--danger)' } },
                          '错误1: ' + c.error1) : null,
                        c.error2 ? React.createElement('span', { key: 'e2', style: { color: 'var(--danger)' } },
                          '错误2: ' + c.error2) : null,
                      ]),
                    ]),
                  ]),
                ];
              })
            ),
          ]),
        ),
      ]),
    ]);
  };

  // === 主渲染 ===
  switch (view) {
    case 'detail': return renderDetailView();
    case 'compare': return renderCompareView();
    default: return renderListView();
  }
};
