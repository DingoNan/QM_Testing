// HistoryPage.js - 历史记录页面
// 从持久化存储加载项目历史，支持加载到管道继续操作
const HistoryPage = () => {
  const [projects, setProjects] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedItems, setSelectedItems] = React.useState({});

  React.useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const list = await window.appApi.listProjects();
      if (Array.isArray(list)) {
        setProjects(list);
      }
    } catch (e) {
      console.warn('加载项目列表失败:', e);
    }
    setLoading(false);
  };

  const toggleSelect = (outDir) => {
    setSelectedItems(prev => ({ ...prev, [outDir]: !prev[outDir] }));
  };

  const toggleSelectAll = () => {
    const allSelected = projects.length > 0 && projects.every(p => selectedItems[p.outDir]);
    if (allSelected) {
      setSelectedItems({});
    } else {
      const all = {};
      projects.forEach(p => { all[p.outDir] = true; });
      setSelectedItems(all);
    }
  };

  const selectedCount = Object.values(selectedItems).filter(Boolean).length;

  const handleBatchDelete = async () => {
    const toDelete = projects.filter(p => selectedItems[p.outDir]);
    if (toDelete.length === 0) {
      window.appApi.showToast('请先选择要删除的项', 'warning');
      return;
    }
    if (!confirm('确定删除选中的 ' + toDelete.length + ' 项历史记录吗？')) return;
    let successCount = 0;
    for (const proj of toDelete) {
      try {
        await window.appApi.deleteProject(proj.outDir);
        successCount++;
      } catch {}
    }
    setSelectedItems({});
    setProjects(prev => prev.filter(p => !selectedItems[p.outDir]));
    window.appApi.showToast('已删除 ' + successCount + '/' + toDelete.length + ' 项', successCount > 0 ? 'success' : 'error');
  };

  const handleLoad = async (proj) => {
    try {
      const result = await window.appApi.readPipelineResult(proj.outDir);
      if (result && result.success) {
        pipelineStore.setState({
          pipelineResult: result,
          outDir: proj.outDir,
          currentPage: 'review',
        });
        window.appApi.showToast('已加载: ' + (proj.name || '未命名'), 'success');
      } else {
        window.appApi.showToast('无法读取项目数据: ' + (result?.error || '文件可能已被删除'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('加载失败: ' + e.message, 'error');
    }
  };

  const handleDelete = async (proj) => {
    try {
      await window.appApi.deleteProject(proj.outDir);
      setProjects(prev => prev.filter(p => p.outDir !== proj.outDir));
      window.appApi.showToast('已删除', 'info');
    } catch (e) {
      window.appApi.showToast('删除失败: ' + e.message, 'error');
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };

  return React.createElement('div', null, [
    React.createElement('div', { className: 'page-header', key: 'h' }, [
      React.createElement('h2', { key: 't' }, '历史记录'),
      React.createElement('button', {
        className: 'btn btn-sm',
        onClick: loadProjects,
        key: 'refresh',
      }, '刷新'),
    ]),

    React.createElement('div', { className: 'card', key: 'content' }, [
      React.createElement('div', { className: 'card-header', key: 'h' }, [
        React.createElement('div', { className: 'card-title', key: 't' }, [
          '处理历史',
          React.createElement('span', { className: 'badge', key: 'b' }, projects.length + ' 项'),
        ]),
        React.createElement('div', { key: 'actions', style: { display: 'flex', gap: 6, alignItems: 'center' } },
          selectedCount > 0
            ? React.createElement('span', { style: { fontSize: 12, color: 'var(--warning)', marginRight: 4 } }, '已选 ' + selectedCount)
            : null,
          React.createElement('button', {
            className: 'btn btn-sm',
            onClick: handleBatchDelete,
            disabled: selectedCount === 0,
            style: { color: selectedCount > 0 ? '#e74c3c' : 'var(--text-secondary)', fontSize: 12 },
            key: 'batch-del',
          }, '批量删除'),
        ),
      ]),

      loading
        ? React.createElement('div', { className: 'page-loading', key: 'load' }, '加载中...')
        : projects.length === 0
          ? React.createElement('div', { className: 'empty-state', key: 'e' }, [
              React.createElement('span', { className: 'empty-state-icon' }, ''),
              React.createElement('h3', null, '暂无历史记录'),
              React.createElement('p', null, '完成管道处理后，项目记录将自动保存到这里，重启后也不会丢失'),
            ])
          : React.createElement('div', { className: 'table-wrapper', key: 'tbl' },
              React.createElement('table', { className: 'table' }, [
                React.createElement('thead', { key: 'th' },
                  React.createElement('tr', null, [
                    React.createElement('th', { key: 'cb', style: { width: 36 } },
                      React.createElement('input', {
                        type: 'checkbox',
                        checked: projects.length > 0 && projects.every(p => selectedItems[p.outDir]),
                        onChange: toggleSelectAll,
                      }),
                    ),
                    React.createElement('th', { key: 'name' }, '用例名称'),
                    React.createElement('th', { key: 'time' }, '处理时间'),
                    React.createElement('th', { key: 'apis' }, '接口数'),
                    React.createElement('th', { key: 'src' }, '来源'),
                    React.createElement('th', { key: 'act', style: { width: 160 } }, '操作'),
                  ]),
                ),
                React.createElement('tbody', { key: 'tb' },
                  projects.map((p, i) =>
                    React.createElement('tr', { key: i,
                      style: { background: selectedItems[p.outDir] ? 'var(--bg-selected, rgba(99,102,241,0.08))' : '' },
                    }, [
                      React.createElement('td', { key: 'cb' },
                        React.createElement('input', {
                          type: 'checkbox',
                          checked: !!selectedItems[p.outDir],
                          onChange: () => toggleSelect(p.outDir),
                        }),
                      ),
                      React.createElement('td', {
                        style: { fontWeight: 500 },
                      }, p.name || '未命名'),
                      React.createElement('td', {
                        style: { color: 'var(--text-secondary)', fontSize: 12 },
                      }, formatDate(p.savedAt)),
                      React.createElement('td', null, p.apiCount || '-'),
                      React.createElement('td', {
                        style: { fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                      }, p.recordingPath || p.outDir || '-'),
                      React.createElement('td', null, [
                        React.createElement('button', {
                          className: 'btn btn-sm btn-primary',
                          onClick: () => handleLoad(p),
                          key: 'load',
                          style: { marginRight: 6 },
                        }, '加载'),
                        React.createElement('button', {
                          className: 'btn btn-sm',
                          onClick: () => handleDelete(p),
                          key: 'del',
                          style: { color: 'var(--danger)' },
                        }, '删除'),
                      ]),
                    ])
                  )
                ),
              ])
            ),
    ]),
  ]);
};
