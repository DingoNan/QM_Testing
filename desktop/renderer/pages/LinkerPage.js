// LinkerPage.js - 跨接口关联可视化
// 展示自动关联结果，支持手动添加/编辑关联规则
const LinkerPage = () => {
  const [loading, setLoading] = React.useState(true);
  const [depsGraph, setDepsGraph] = React.useState(null);
  const [allDeps, setAllDeps] = React.useState([]);
  const [records, setRecords] = React.useState([]);
  const [manualDeps, setManualDeps] = React.useState([]);
  const [showAddDep, setShowAddDep] = React.useState(false);
  const [newDep, setNewDep] = React.useState({
    fromSeq: '', fromPath: 'responseBody.', toSeq: '', toLocation: 'requestHeaders.', matchType: 'manual',
  });
  const [relinking, setRelinking] = React.useState(false);
  const [depTypeFilter, setDepTypeFilter] = React.useState('ALL');
  const [activeTab, setActiveTab] = React.useState('auto');
  const [chainRules, setChainRules] = React.useState([]);
  const [dataBindings, setDataBindings] = React.useState([]);
  const [showBatchEdit, setShowBatchEdit] = React.useState(false);

  // 提取依赖类型
  const getDepType = (dep) => {
    const path = (dep.from_path || dep.to_location || '').toLowerCase();
    if (path.includes('token') || path.includes('jwt') || path.includes('auth')) return 'token';
    if (path.includes('cookie') || path.includes('cookie')) return 'cookie';
    if (path.includes('id') || path.includes('key')) return 'id';
    if (path.includes('body') || path.includes('data')) return 'body';
    if (path.includes('header') || path.includes('x-')) return 'header';
    if (dep.match_type === 'token') return 'token';
    return 'other';
  };

  // 按类型汇总
  const getDepTypeSummary = (deps) => {
    const summary = {};
    deps.forEach(d => {
      const t = getDepType(d);
      summary[t] = (summary[t] || 0) + 1;
    });
    return summary;
  };

  const depTypeColors = {
    token: { bg: '#dcfce7', color: '#166534', label: 'Token' }, // green
    cookie: { bg: '#fef3c7', color: '#92400e', label: 'Cookie' }, // amber
    id: { bg: '#dbeafe', color: '#1e40af', label: 'ID/Key' }, // blue
    body: { bg: '#e0e7ff', color: '#3730a3', label: 'Body字段' }, // indigo
    header: { bg: '#f3e8ff', color: '#6b21a8', label: 'Header' }, // purple
    other: { bg: '#f1f5f9', color: '#475569', label: '其他' }, // slate
  };

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const state = pipelineStore.getState();
        const outDir = state.outDir;
        if (!outDir) {
          console.log('[LinkerPage] outDir 未设置，请先完成管道处理');
          setLoading(false); return;
        }

        // Load deps graph
        const graph = await window.appApi.getLinkedDeps(outDir);
        if (graph) { setDepsGraph(graph); console.log('[LinkerPage] 加载依赖图成功，节点数:', graph.nodes?.length); }

        // Load all deps
        const deps = await window.appApi.fileRead(outDir + '/deps.json');
        if (deps) {
          const depsArr = Array.isArray(deps) ? deps : [];
          setAllDeps(depsArr);
          console.log('[LinkerPage] 加载依赖列表:', depsArr.length);
        }

        // Load linked records
        const linked = await window.appApi.fileRead(outDir + '/linked.json');
        if (linked) {
          const linkedArr = Array.isArray(linked) ? linked : [];
          setRecords(linkedArr);
          console.log('[LinkerPage] 加载关联记录:', linkedArr.length);
        }

        // Load previously saved manual deps
        const saved = await window.appApi.fileRead(outDir + '/manual-deps.json');
        if (saved) setManualDeps(Array.isArray(saved) ? saved : []);

        // Load chain rules
        try {
          const rules = await window.appApi.chainRuleList(outDir);
          if (Array.isArray(rules)) setChainRules(rules);
        } catch {}
      } catch (e) {
        console.warn('[LinkerPage] 加载关联数据失败:', e);
      }
      setLoading(false);
    })();
  }, []);

  const addManualDep = () => {
    if (!newDep.fromSeq || !newDep.toSeq) {
      window.appApi.showToast('请填写完整关联信息', 'warning');
      return;
    }
    const dep = {
      ...newDep,
      fromSeq: parseInt(newDep.fromSeq, 10),
      toSeq: parseInt(newDep.toSeq, 10),
    };
    const updated = [...manualDeps, dep];
    setManualDeps(updated);
    setShowAddDep(false);
    setNewDep({ fromSeq: '', fromPath: 'responseBody.', toSeq: '', toLocation: 'requestHeaders.', matchType: 'manual' });
  };

  const removeManualDep = (idx) => {
    const updated = manualDeps.filter((_, i) => i !== idx);
    setManualDeps(updated);
  };

  const applyAndRelink = async () => {
    const state = pipelineStore.getState();
    const outDir = state.outDir;
    if (!outDir) { window.appApi.showToast('无输出目录', 'error'); return; }
    setRelinking(true);
    try {
      // Save manual deps
      await window.appApi.writeFile(outDir + '/manual-deps.json', manualDeps);
      // Apply and relink
      const result = await window.appApi.applyManualDeps(outDir, manualDeps);
      if (result.success) {
        // Reload
        const graph = await window.appApi.getLinkedDeps(outDir);
        if (graph) setDepsGraph(graph);
        const deps = await window.appApi.fileRead(outDir + '/deps.json');
        if (deps) setAllDeps(Array.isArray(deps) ? deps : []);
        const linked = await window.appApi.fileRead(outDir + '/linked.json');
        if (linked) setRecords(Array.isArray(linked) ? linked : []);

        window.appApi.showToast('关联已完成，新增 ' + (result.stats?.totalDeps || 0) + ' 处依赖', 'success');
      } else {
        window.appApi.showToast('关联失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('关联失败: ' + e.message, 'error');
    }
    setRelinking(false);
  };

  const goToPage = (page) => {
    pipelineStore.setState({ currentPage: page });
  };

  if (loading) {
    return React.createElement('div', { className: 'page-loading' }, '加载中...');
  }

  // 空状态：outDir 不存在或文件不存在
  const state = pipelineStore.getState();
  const hasNoDir = !state.outDir;
  if (hasNoDir) {
    // 即使无 outDir，也显示 header
    return React.createElement('div', null, [
      React.createElement('div', { className: 'page-header', key: 'h' }, [
        React.createElement('h2', { key: 't' }, '跨接口关联'),
        React.createElement('div', { className: 'page-header-actions', key: 'a' },
          React.createElement('button', {
            className: 'btn btn-primary btn-sm',
            onClick: () => setShowAddDep(true),
            disabled: true,
            key: 'add',
          }, '+ 手动关联'),
        ),
      ]),
      // Empty tabs
      React.createElement('div', { key: 'tabs', style: { display: 'flex', gap: 2, marginBottom: 16, borderBottom: '2px solid var(--border)' } }, [
        ['auto', '自动关联'], ['manual', '手动关联'], ['chain', '串联规则'],
      ].map(([tabKey, label]) =>
        React.createElement('div', {
          key: tabKey,
          style: {
            padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tabKey ? 700 : 400,
            borderBottom: activeTab === tabKey ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: -2, color: activeTab === tabKey ? 'var(--primary)' : 'var(--text-secondary)',
            transition: 'all 0.1s',
          },
          onClick: () => setActiveTab(tabKey),
        }, label)
      )),
      React.createElement('div', { className: 'empty-state', key: 'e' }, [
        React.createElement('span', { className: 'empty-state-icon', key: 'ic' }, '\uD83D\uDD17'),
        React.createElement('h3', { key: 't' }, '暂无关联数据'),
        React.createElement('p', { key: 'd' }, '请先完成管道处理，跨接口关联在管道\u300C用例拼装\u300D阶段自动执行。'),
        React.createElement('p', { key: 'd2', style: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }},
          '关联功能会自动识别接口间的 token、cookie、ID 等引用关系，无需手动配置。完成管道后，可在此手动补充关联规则。'),
      ]),
      React.createElement('div', { style: { textAlign: 'center', marginTop: 16 }, key: 'back' },
        React.createElement('button', { className: 'btn btn-primary', onClick: () => pipelineStore.setState({ currentPage: 'pipeline' }) }, '返回管道处理')
      ),
      showAddDep && React.createElement('div', {
        className: 'modal-overlay', key: 'add-modal',
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
        onClick: () => setShowAddDep(false),
      }, React.createElement('div', {
        style: { background: 'var(--bg)', padding: 24, borderRadius: 8, minWidth: 500 },
        onClick: e => e.stopPropagation(),
      }, [
        React.createElement('h4', { key: 't', style: { marginBottom: 16 }}, '添加手动关联'),
        React.createElement('p', { key: 'note', style: { color: 'var(--text-secondary)', fontSize: 12 }}, '请先完成管道处理后再添加关联规则。'),
        React.createElement('div', { key: 'btns', style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }},
          React.createElement('button', { className: 'btn btn-sm', onClick: () => setShowAddDep(false) }, '关闭'),
        ),
      ])),
    ]);
  }

  // Build a visual dependency graph with card layout
  const renderDagVisual = () => {
    if (!depsGraph || !depsGraph.nodes) {
      return React.createElement('div', { style: { textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}, '暂无关联网数据');
    }

    const { nodes, edges, providers, dependents, isolatedSeqs } = depsGraph;

    // Group: find chains - nodes that provide deps (left) and those that consume (right)
    const providerNodes = nodes.filter(n => edges.some(e => e.from === n.seq));
    const dependentNodes = nodes.filter(n => edges.some(e => e.to === n.seq));
    const isolatedNodes = nodes.filter(n => !edges.some(e => e.from === n.seq) && !edges.some(e => e.to === n.seq));

    return React.createElement('div', null, [
      // 统计摘要
      React.createElement('div', { className: 'card', key: 'stats', style: { marginBottom: 16 }}, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title' }, '依赖关系图 (' + nodes.length + ' 节点, ' + edges.length + ' 条边)')),
        React.createElement('div', { className: 'stats-grid', key: 'body', style: { padding: 12 } }, [
          React.createElement('div', { className: 'stat-card', key: 'prov' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon green' }, '提供')),
            React.createElement('div', { className: 'stat-value' }, providerNodes.length),
            React.createElement('div', { className: 'stat-label' }, '数据提供者'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'dep' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon amber' }, '消费')),
            React.createElement('div', { className: 'stat-value' }, dependentNodes.length),
            React.createElement('div', { className: 'stat-label' }, '数据消费者'),
          ]),
          React.createElement('div', { className: 'stat-card', key: 'edge' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon blue' }, '关联')),
            React.createElement('div', { className: 'stat-value' }, edges.length),
            React.createElement('div', { className: 'stat-label' }, '依赖关系'),
          ]),
          isolatedNodes.length > 0 && React.createElement('div', { className: 'stat-card', key: 'iso' }, [
            React.createElement('div', { className: 'stat-card-header' },
              React.createElement('div', { className: 'stat-icon' }, '孤立')),
            React.createElement('div', { className: 'stat-value' }, isolatedNodes.length),
            React.createElement('div', { className: 'stat-label' }, '孤立节点'),
          ]),
        ]),
      ]),

      // 依赖链卡片
      edges.length > 0 && React.createElement('div', { className: 'card', key: 'chains', style: { marginBottom: 16 }}, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title' }, '接口依赖链条')),
        React.createElement('div', { key: 'body', style: { padding: 16 }},
          edges.map((edge, idx) => {
            const fromNode = nodes.find(n => n.seq === edge.from);
            const toNode = nodes.find(n => n.seq === edge.to);
            const depType = getDepType({ from_path: edge.fromPath, to_location: edge.toLocation });
            const typeInfo = depTypeColors[depType] || depTypeColors.other;

            return React.createElement('div', {
              key: idx,
              style: {
                display: 'flex', alignItems: 'stretch', gap: 0, marginBottom: 12,
                border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
              },
            }, [
              // Source node (provider)
              React.createElement('div', {
                style: {
                  flex: 1, padding: 12, background: 'rgba(34, 197, 94, 0.06)',
                  borderRight: '1px solid var(--border)',
                },
              }, [
                React.createElement('div', { style: { marginBottom: 4 } }, [
                  React.createElement('span', {
                    className: 'method-badge method-' + ((fromNode ? fromNode.method : '') || '').toLowerCase(),
                    style: { marginRight: 6 },
                  }, fromNode ? fromNode.method : '?'),
                  React.createElement('span', {
                    style: { fontWeight: 600, fontSize: 13 },
                  }, 'Seq ' + edge.from),
                ]),
                React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all', fontFamily: 'monospace' }},
                  fromNode ? (fromNode.path || fromNode.name || '') : ''),
                React.createElement('div', { style: { fontSize: 11, color: '#16a34a', marginTop: 4, fontFamily: 'monospace' }},
                  '提供: ' + (edge.fromPath || '')),
              ]),
              // Arrow + type
              React.createElement('div', {
                style: {
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', padding: '8px 16px', minWidth: 80,
                  background: typeInfo.bg,
                },
              }, [
                React.createElement('div', { style: { color: typeInfo.color, fontWeight: 700, fontSize: 11 } }, typeInfo.label),
                React.createElement('div', { style: { color: '#666', fontSize: 18, lineHeight: 1 } }, '\u2192'),
                React.createElement('div', { style: { color: typeInfo.color, fontSize: 10 } }, '依赖'),
              ]),
              // Target node (consumer)
              React.createElement('div', {
                style: {
                  flex: 1, padding: 12, background: 'rgba(245, 158, 11, 0.06)',
                  borderLeft: '1px solid var(--border)',
                },
              }, [
                React.createElement('div', { style: { marginBottom: 4 } }, [
                  React.createElement('span', {
                    className: 'method-badge method-' + ((toNode ? toNode.method : '') || '').toLowerCase(),
                    style: { marginRight: 6 },
                  }, toNode ? toNode.method : '?'),
                  React.createElement('span', {
                    style: { fontWeight: 600, fontSize: 13 },
                  }, 'Seq ' + edge.to),
                ]),
                React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all', fontFamily: 'monospace' }},
                  toNode ? (toNode.path || toNode.name || '') : ''),
                React.createElement('div', { style: { fontSize: 11, color: '#d97706', marginTop: 4, fontFamily: 'monospace' }},
                  '消费: ' + (edge.toLocation || '')),
              ]),
            ]);
          })
        ),
      ]),

      // 孤立节点
      isolatedNodes.length > 0 && React.createElement('div', { className: 'card', key: 'isolated', style: { marginBottom: 16 }}, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title' }, '\u26A0\uFE0F 孤立接口（无依赖关系）')),
        React.createElement('div', { key: 'body', style: { padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }},
          isolatedNodes.map((node, i) =>
            React.createElement('div', {
              key: i,
              style: {
                padding: '6px 12px', background: 'var(--bg-secondary)',
                borderRadius: 6, border: '1px solid var(--border)', fontSize: 12,
              },
            }, [
              React.createElement('span', { className: 'method-badge method-' + (node.method || '').toLowerCase(), style: { marginRight: 4 } }, node.method || '?'),
              'Seq ' + node.seq + ': ' + (node.path || node.name || ('#' + node.seq)),
            ])
          )
        ),
      ]),
    ]);
  };

  const filteredDeps = depTypeFilter === 'ALL' ? allDeps : allDeps.filter(d => getDepType(d) === depTypeFilter);
  const depSummary = getDepTypeSummary(allDeps);
  const depTypes = Object.keys(depTypeColors);

  // Tab-based content
  const handleSaveChainRules = async (rules) => {
    const state = pipelineStore.getState();
    const outDir = state.outDir;
    if (!outDir) {
      window.appApi.showToast('无输出目录', 'error');
      return;
    }
    const result = await window.appApi.chainRuleSave(outDir, rules);
    if (result && result.success) {
      setChainRules(rules);
      window.appApi.showToast('串联规则已保存', 'success');
    } else {
      window.appApi.showToast('保存失败: ' + (result?.error || '未知错误'), 'error');
    }
  };

  return React.createElement('div', null, [
    // Header
    React.createElement('div', { className: 'page-header', key: 'h' }, [
      React.createElement('h2', { key: 't' }, '跨接口关联'),
      React.createElement('div', { className: 'page-header-actions', key: 'a' }, [
        React.createElement('button', {
          className: 'btn btn-primary btn-sm', onClick: () => setShowAddDep(true), key: 'add',
        }, '+ 手动关联'),
        React.createElement('button', {
          className: 'btn btn-sm', onClick: () => setShowBatchEdit(!showBatchEdit), key: 'batch',
        }, showBatchEdit ? '关闭批量' : '批量编辑'),
        React.createElement('button', {
          className: 'btn btn-primary', onClick: applyAndRelink, disabled: relinking, key: 'apply',
          style: { minWidth: 120 },
        }, relinking ? '关联中...' : '应用并重新关联'),
      ]),
    ]),

    // Tabs
    React.createElement('div', { key: 'tabs', style: { display: 'flex', gap: 2, marginBottom: 16, borderBottom: '2px solid var(--border)' } }, [
      ['auto', '自动关联', allDeps.length], ['manual', '手动关联', manualDeps.length], ['chain', '串联规则', chainRules.length],
    ].map(([tabKey, label, count]) =>
      React.createElement('div', {
        key: tabKey,
        style: {
          padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tabKey ? 700 : 400,
          borderBottom: activeTab === tabKey ? '2px solid var(--primary)' : '2px solid transparent',
          marginBottom: -2, color: activeTab === tabKey ? 'var(--primary)' : 'var(--text-secondary)',
          transition: 'all 0.1s', userSelect: 'none',
        },
        onClick: () => setActiveTab(tabKey),
      }, [
        label,
        React.createElement('span', { className: 'tag tag-sm', style: { marginLeft: 6, fontSize: 10 } }, count),
      ])
    )),

    // Data binding overview
    dataBindings.length > 0 && React.createElement('div', { className: 'card', key: 'db-overview', style: { marginBottom: 16 } }, [
      React.createElement('div', { className: 'card-header', key: 'h' },
        React.createElement('div', { className: 'card-title' }, '🔗 数据绑定概览'),
      ),
      React.createElement('div', { key: 'body', style: { padding: '8px 16px', fontSize: 12 } },
        React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
          dataBindings.map((db, i) =>
            React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)' } }, [
              React.createElement('span', { style: { fontWeight: 600, fontSize: 12 } }, '📦 ' + (db.dataPoolName || '数据池')),
              React.createElement('span', { style: { fontSize: 11, color: 'var(--text-secondary)' } }, (db.mappings || []).length + ' 个映射'),
              React.createElement('span', { className: 'tag tag-sm tag-info', style: { fontSize: 10 } }, '展开: ' + (db.settings?.iterationMode || 'none')),
            ])
          )
        ),
      ),
    ]),

    // Tab content: 自动关联
    activeTab === 'auto' && React.createElement('div', { key: 'auto-content' }, [
      // DAG Visualization
      renderDagVisual(),

      // All deps detail with type filter
      React.createElement('div', { className: 'card', key: 'deps' }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title' }, '所有依赖明细 (' + allDeps.length + ')')),
        allDeps.length > 0 && React.createElement('div', {
          key: 'filter',
          style: { padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
        }, [
          React.createElement('span', { key: 'lbl', style: { fontSize: 11, color: 'var(--text-secondary)', marginRight: 4 }}, '过滤:'),
          React.createElement('button', {
            key: 'all',
            className: 'btn btn-sm' + (depTypeFilter === 'ALL' ? ' btn-primary' : ''),
            onClick: () => setDepTypeFilter('ALL'),
            style: { fontSize: 10, padding: '2px 8px' },
          }, '全部 (' + allDeps.length + ')'),
          ...depTypes.map(t =>
            depSummary[t] > 0 && React.createElement('button', {
              key: t,
              className: 'btn btn-sm' + (depTypeFilter === t ? ' btn-primary' : ''),
              onClick: () => setDepTypeFilter(t),
              style: { fontSize: 10, padding: '2px 8px' },
            }, (depTypeColors[t]?.label || t) + ' (' + depSummary[t] + ')')
          ),
        ]),
        filteredDeps.length === 0
          ? React.createElement('div', { key: 'empty', style: { padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}, '暂无依赖数据')
          : React.createElement('div', { key: 'table', style: { overflowX: 'auto' }},
              React.createElement('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse' }}, [
                React.createElement('thead', { key: 'thead' },
                  React.createElement('tr', { style: { background: 'var(--bg-secondary)' }}, [
                    React.createElement('th', { style: { padding: '8px 10px', textAlign: 'left' }}, '序号'),
                    React.createElement('th', { style: { padding: '8px 10px', textAlign: 'left' }}, '来源 (from)'),
                    React.createElement('th', { style: { padding: '8px 10px', textAlign: 'left' }}, '来源路径'),
                    React.createElement('th', { style: { padding: '8px 10px', textAlign: 'left' }}, '目标 (to)'),
                    React.createElement('th', { style: { padding: '8px 10px', textAlign: 'left' }}, '目标位置'),
                    React.createElement('th', { style: { padding: '8px 10px', textAlign: 'left' }}, '依赖类型'),
                    React.createElement('th', { style: { padding: '8px 10px', textAlign: 'left' }}, '匹配类型'),
                  ])
                ),
                React.createElement('tbody', { key: 'tbody' },
                  filteredDeps.map((dep, i) => {
                    const dt = getDepType(dep);
                    const tc = depTypeColors[dt] || depTypeColors.other;
                    return React.createElement('tr', {
                      key: i,
                      style: { borderBottom: '1px solid var(--border)' },
                    }, [
                      React.createElement('td', { style: { padding: '6px 10px' }}, i + 1),
                      React.createElement('td', { style: { padding: '6px 10px' }}, 'Seq ' + dep.from_seq),
                      React.createElement('td', { style: { padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}, dep.from_path || ''),
                      React.createElement('td', { style: { padding: '6px 10px' }}, 'Seq ' + dep.to_seq),
                      React.createElement('td', { style: { padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}, dep.to_location || ''),
                      React.createElement('td', { style: { padding: '6px 10px' }},
                        React.createElement('span', { style: { background: tc.bg, color: tc.color, padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}, tc.label)),
                      React.createElement('td', { style: { padding: '6px 10px' }},
                        React.createElement('span', { className: 'tag tag-' + (dep.match_type === 'manual' ? 'warning' : 'info') }, dep.match_type || 'auto')),
                    ]);
                  })
                ),
              ])
            ),
      ]),
    ]),

    // Tab content: 手动关联
    activeTab === 'manual' && React.createElement('div', { key: 'manual-content' }, [
      React.createElement('div', { className: 'card', key: 'manual' }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title' }, '手动关联规则 (' + manualDeps.length + ')')),
        manualDeps.length === 0
          ? React.createElement('div', { key: 'empty', style: { padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}, '暂无手动关联规则，点击 "+ 手动关联" 添加')
          : React.createElement('div', { key: 'list', style: { padding: 12 } },
              manualDeps.map((dep, i) =>
                React.createElement('div', {
                  key: i,
                  style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 13 },
                }, [
                  React.createElement('span', { style: { fontWeight: 600, minWidth: 35 }}, '#' + (i + 1)),
                  React.createElement('span', { style: { color: 'var(--text-secondary)' }}, '接口 ' + dep.fromSeq + '.' + dep.fromPath),
                  React.createElement('span', { style: { color: '#e74c3c' }}, '-->'),
                  React.createElement('span', { style: { color: 'var(--text-secondary)' }}, '接口 ' + dep.toSeq + '.' + dep.toLocation),
                  React.createElement('span', { className: 'tag tag-info', style: { marginLeft: 'auto' }}, '手动'),
                  React.createElement('button', {
                    className: 'btn btn-sm', onClick: () => removeManualDep(i),
                    style: { padding: '2px 6px', fontSize: 11, color: '#e74c3c' },
                  }, '删除'),
                ])
              )
            ),
      ]),
    ]),

    // Tab content: 串联规则
    activeTab === 'chain' && React.createElement('div', { key: 'chain-content' }, [
      React.createElement('p', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 } },
        '串联规则用于将前面接口的响应值传递到后续接口的参数中。配置完成后需保存到输出目录。'),
      React.createElement(ChainRuleEditor, {
        records,
        chainRules,
        onSave: handleSaveChainRules,
        onClose: () => setActiveTab('auto'),
      }),
    ]),

    // Add manual dep modal (shared across tabs)
    showAddDep && React.createElement('div', {
      className: 'modal-overlay', key: 'add-modal',
      style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
      onClick: () => setShowAddDep(false),
    }, React.createElement('div', {
      style: { background: 'var(--bg)', padding: 24, borderRadius: 8, minWidth: 500 },
      onClick: e => e.stopPropagation(),
    }, [
      React.createElement('h4', { key: 't', style: { marginBottom: 16 }}, '添加手动关联'),
      React.createElement('div', { key: 'from', style: { marginBottom: 12 }}, [
        React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}, '来源接口'),
        React.createElement('select', {
          value: newDep.fromSeq,
          onChange: e => setNewDep({ ...newDep, fromSeq: e.target.value }),
          style: { width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
        }, [
          React.createElement('option', { value: '', key: '' }, '选择来源接口...'),
          ...(records || []).map(r =>
            React.createElement('option', { key: r.seq, value: String(r.seq) },
              `Seq ${r.seq}: ${r.method || ''} ${(r.path || r.name || '').slice(0, 40)}`)
          ),
        ]),
      ]),
      React.createElement('div', { key: 'fp', style: { marginBottom: 12 }}, [
        React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}, '来源响应字段路径'),
        React.createElement('input', {
          type: 'text', value: newDep.fromPath,
          onChange: e => setNewDep({ ...newDep, fromPath: e.target.value }),
          style: { width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
          placeholder: 'responseBody.data.token',
        }),
      ]),
      React.createElement('div', { key: 'to', style: { marginBottom: 12 }}, [
        React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}, '目标接口'),
        React.createElement('select', {
          value: newDep.toSeq,
          onChange: e => setNewDep({ ...newDep, toSeq: e.target.value }),
          style: { width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
        }, [
          React.createElement('option', { value: '', key: '' }, '选择目标接口...'),
          ...(records || []).map(r =>
            React.createElement('option', { key: r.seq, value: String(r.seq) },
              `Seq ${r.seq}: ${r.method || ''} ${(r.path || r.name || '').slice(0, 40)}`)
          ),
        ]),
      ]),
      React.createElement('div', { key: 'tl', style: { marginBottom: 16 }}, [
        React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}, '目标位置'),
        React.createElement('input', {
          type: 'text', value: newDep.toLocation,
          onChange: e => setNewDep({ ...newDep, toLocation: e.target.value }),
          style: { width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
          placeholder: 'requestHeaders.X-Token 或 requestBody.userId 或 url',
        }),
      ]),
      React.createElement('div', { key: 'btns', style: { display: 'flex', gap: 8, justifyContent: 'flex-end' }}, [
        React.createElement('button', { className: 'btn btn-sm', onClick: () => setShowAddDep(false) }, '取消'),
        React.createElement('button', { className: 'btn btn-primary btn-sm', onClick: addManualDep }, '添加'),
      ]),
    ])),

    // Batch edit modal
    showBatchEdit && React.createElement('div', {
      className: 'modal-overlay', key: 'batch-modal',
      style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
      onClick: () => setShowBatchEdit(false),
    }, React.createElement('div', {
      style: { background: 'var(--bg)', padding: 24, borderRadius: 8, minWidth: 500 },
      onClick: e => e.stopPropagation(),
    }, [
      React.createElement('h4', { key: 't', style: { marginBottom: 16 }}, '批量编辑串联规则'),
      chainRules.length === 0
        ? React.createElement('p', { key: 'e', style: { color: 'var(--text-secondary)', fontSize: 13 } }, '暂无串联规则') :
        React.createElement('div', { key: 'list' },
          chainRules.map((rule, i) =>
            React.createElement('div', {
              key: i,
              style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 },
            }, [
              React.createElement('input', {
                type: 'checkbox', checked: rule.enabled !== false,
                onChange: () => {
                  const updated = chainRules.map((r, j) => j === i ? { ...r, enabled: !r.enabled } : r);
                  setChainRules(updated);
                },
                key: 'cb', style: { cursor: 'pointer' },
              }),
              React.createElement('span', { style: { flex: 1, color: rule.enabled !== false ? 'var(--text)' : 'var(--text-secondary)' } }, rule.name || '未命名规则'),
              React.createElement('span', { className: 'tag tag-sm', key: 'src' }, 'Seq ' + rule.sourceApiSeq + ' → Seq ' + rule.targetApiSeq),
              React.createElement('button', {
                className: 'btn btn-sm btn-danger',
                onClick: () => {
                  const updated = chainRules.filter((_, j) => j !== i);
                  setChainRules(updated);
                },
                style: { padding: '2px 6px', fontSize: 11 },
              }, '删除'),
            ])
          )
        ),
      React.createElement('div', { key: 'btns', style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}, [
        React.createElement('button', { className: 'btn btn-sm', onClick: () => setShowBatchEdit(false) }, '关闭'),
        React.createElement('button', { className: 'btn btn-primary btn-sm', onClick: () => {
          handleSaveChainRules(chainRules);
          setShowBatchEdit(false);
        }}, '保存更改'),
      ]),
    ])),

    // Bottom actions
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'center', gap: 16, marginTop: 24 },
      key: 'actions',
    }, [
      React.createElement('button', { className: 'btn btn-primary btn-lg', onClick: () => goToPage('review'), style: { minWidth: 150 }}, '进入智能审查'),
      React.createElement('button', { className: 'btn', onClick: () => goToPage('pipeline'), key: 'back' }, '返回管道'),
    ]),
  ]);
};
