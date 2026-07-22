// SettingsPage.js - AI 模型配置与 Token 统计设置页
const SettingsPage = () => {
  const [providers, setProviders] = React.useState([]);
  const [providerTypes, setProviderTypes] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [editingProvider, setEditingProvider] = React.useState(null);
  const [tokenStats, setTokenStats] = React.useState(null);
  const [timeStats, setTimeStats] = React.useState(null);
  const [activeTab, setActiveTab] = React.useState('providers');
  const [testingId, setTestingId] = React.useState(null);
  const [testResult, setTestResult] = React.useState(null);
  const [formData, setFormData] = React.useState(getDefaultForm());

  function getDefaultForm() {
    return { id: '', name: '', type: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', defaultModel: '', isActive: true };
  }

  // 加载数据
  React.useEffect(() => {
    (async () => {
      try {
        const [p, pt, ts, tt] = await Promise.all([
          window.appApi.getAiProviders(),
          window.appApi.getAiProviderTypes(),
          window.appApi.getTokenStats(),
          window.appApi.getTokenTimeStats(),
        ]);
        setProviders(p || []);
        setProviderTypes(pt || {});
        setTokenStats(ts);
        setTimeStats(tt);
      } catch (e) {
        console.error('Failed to load settings:', e);
        window.appApi.showToast('加载设置失败: ' + e.message, 'error');
      }
      setLoading(false);
    })();
  }, []);

  // 打开新增表单
  const handleAdd = () => {
    setEditingProvider(null);
    setFormData(getDefaultForm());
    setTestResult(null);
    setShowForm(true);
  };

  // 打开编辑表单
  const handleEdit = (provider) => {
    setEditingProvider(provider);
    setFormData({ ...provider });
    setTestResult(null);
    setShowForm(true);
  };

  // 表单输入变更
  const handleFormChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // 类型变更时自动填充默认 URL
  const handleTypeChange = (type) => {
    const types = providerTypes;
    const typeInfo = types[type];
    setFormData((prev) => ({
      ...prev,
      type,
      baseUrl: typeInfo ? typeInfo.defaultBaseUrl : '',
      apiKey: typeInfo && typeInfo.needsApiKey ? prev.apiKey : '',
    }));
  };

  // 保存 Provider
  const handleSave = async () => {
    if (!formData.name.trim()) {
      window.appApi.showToast('请输入 Provider 名称', 'warning');
      return;
    }
    if (!formData.baseUrl.trim()) {
      window.appApi.showToast('请输入 API 地址', 'warning');
      return;
    }

    const provider = {
      ...formData,
      id: editingProvider ? editingProvider.id : 'provider-' + Date.now(),
      name: formData.name.trim(),
      baseUrl: formData.baseUrl.trim().replace(/\/+$/, ''),
      defaultModel: formData.defaultModel.trim(),
    };

    try {
      const result = await window.appApi.saveAiProvider(provider);
      if (result.ok) {
        window.appApi.showToast('保存成功', 'success');
        setShowForm(false);
        // 刷新列表
        const p = await window.appApi.getAiProviders();
        setProviders(p || []);
      } else {
        window.appApi.showToast('保存失败', 'error');
      }
    } catch (e) {
      window.appApi.showToast('保存失败: ' + e.message, 'error');
    }
  };

  // 删除 Provider
  const handleDelete = async (id, name) => {
    if (!confirm('确认删除 Provider "' + name + '" 吗？')) return;
    try {
      const result = await window.appApi.deleteAiProvider(id);
      if (result.ok) {
        window.appApi.showToast('已删除', 'success');
        const p = await window.appApi.getAiProviders();
        setProviders(p || []);
      }
    } catch (e) {
      window.appApi.showToast('删除失败: ' + e.message, 'error');
    }
  };

  // 测试连通性
  const handleTestConnection = async (provider) => {
    setTestingId(provider.id);
    setTestResult(null);
    try {
      const result = await window.appApi.testAiConnection(provider.id);
      setTestResult(result);
      // 测试完成后更新列表中状态
      if (result.ok) {
        window.appApi.showToast(result.message || '连接成功', 'success');
      } else {
        window.appApi.showToast(result.message || '连接失败', 'error');
      }
    } catch (e) {
      setTestResult({ ok: false, message: e.message });
      window.appApi.showToast('连接测试异常: ' + e.message, 'error');
    }
    setTestingId(null);
  };

  // 从当前表单测试
  const handleTestCurrent = async () => {
    if (!formData.baseUrl.trim()) {
      window.appApi.showToast('请先填写 API 地址', 'warning');
      return;
    }
    // 使用当前表单数据创建临时 Provider 测试
    const tempProvider = {
      id: '__test__',
      name: formData.name || '测试',
      type: formData.type,
      baseUrl: formData.baseUrl.replace(/\/+$/, ''),
      apiKey: formData.apiKey,
      defaultModel: formData.defaultModel || 'deepseek-chat',
      isActive: true,
    };

    setTestResult(null);
    try {
      const result = await window.appApi.testAiConnectionDirect(tempProvider);
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, message: e.message });
    }
  };

  // 移动优先级
  const handleMovePriority = async (idx, direction) => {
    const list = [...providers];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    [list[idx], list[targetIdx]] = [list[targetIdx], list[idx]];
    setProviders(list);
    try {
      await window.appApi.reorderAiProviders(list.map((p) => p.id));
    } catch (e) {
      // 回滚
      const p = await window.appApi.getAiProviders();
      setProviders(p || []);
    }
  };

  // 切换激活状态
  const handleToggleActive = async (provider) => {
    const updated = { ...provider, isActive: !provider.isActive };
    try {
      await window.appApi.saveAiProvider(updated);
      const p = await window.appApi.getAiProviders();
      setProviders(p || []);
    } catch (e) {
      window.appApi.showToast('切换失败: ' + e.message, 'error');
    }
  };

  // 清空 Token 统计
  const handleClearTokenStats = async () => {
    if (!confirm('确认清空所有 Token 统计数据吗？此操作不可撤销。')) return;
    try {
      await window.appApi.clearTokenStats();
      const [ts, tt] = await Promise.all([
        window.appApi.getTokenStats(),
        window.appApi.getTokenTimeStats(),
      ]);
      setTokenStats(ts);
      setTimeStats(tt);
      window.appApi.showToast('Token 统计已清空', 'success');
    } catch (e) {
      window.appApi.showToast('清空失败: ' + e.message, 'error');
    }
  };

  // 刷新数据
  const handleRefresh = async () => {
    setLoading(true);
    try {
      const [p, ts, tt] = await Promise.all([
        window.appApi.getAiProviders(),
        window.appApi.getTokenStats(),
        window.appApi.getTokenTimeStats(),
      ]);
      setProviders(p || []);
      setTokenStats(ts);
      setTimeStats(tt);
    } catch (e) {
      window.appApi.showToast('刷新失败: ' + e.message, 'error');
    }
    setLoading(false);
  };

  if (loading) {
    return React.createElement('div', { className: 'page-container' },
      React.createElement('h3', null, '⚙️ 设置')
    );
  }

  // 根据 tab 加载 Provider 或 Token 统计
  const renderProviders = () => {
    return React.createElement('div', { key: 'providers' }, [
      // Toolbar
      React.createElement('div', { className: 'settings-toolbar', key: 'toolbar' }, [
        React.createElement('h3', { key: 't' }, 'AI 模型提供商'),
        React.createElement('div', { key: 'actions' }, [
          React.createElement('button', {
            className: 'btn btn-primary',
            onClick: handleAdd,
            style: { marginRight: 8 },
          }, '+ 添加 Provider'),
          React.createElement('button', {
            className: 'btn btn-ghost',
            onClick: handleRefresh,
          }, '🔄 刷新'),
        ]),
      ]),

      // Provider 列表
      providers.length === 0
        ? React.createElement('div', { className: 'empty-state', key: 'empty' }, [
            React.createElement('span', { className: 'empty-state-icon' }, '🤖'),
            React.createElement('h3', null, '暂无 AI 模型配置'),
            React.createElement('p', null, '添加一个 Provider 来配置 AI 模型服务'),
          ])
        : React.createElement('div', { className: 'provider-list', key: 'list' },
            providers.map((p, idx) =>
              React.createElement('div', {
                className: 'provider-card',
                key: p.id,
              }, [
                // 优先级排序按钮
                React.createElement('div', { className: 'provider-priority', key: 'pri' }, [
                  React.createElement('button', {
                    className: 'btn-icon',
                    onClick: () => handleMovePriority(idx, -1),
                    disabled: idx === 0,
                    title: '上移',
                  }, '▲'),
                  React.createElement('span', { className: 'priority-num' }, idx + 1),
                  React.createElement('button', {
                    className: 'btn-icon',
                    onClick: () => handleMovePriority(idx, 1),
                    disabled: idx === providers.length - 1,
                    title: '下移',
                  }, '▼'),
                ]),

                // Provider 信息
                React.createElement('div', { className: 'provider-info', key: 'info' }, [
                  React.createElement('div', { className: 'provider-name-row', key: 'row' }, [
                    React.createElement('strong', { key: 'name' }, p.name),
                    React.createElement('span', {
                      className: 'badge ' + (p.isActive ? 'badge-success' : 'badge-muted'),
                      key: 'status',
                    }, p.isActive ? '已启用' : '已禁用'),
                  ]),
                  React.createElement('div', { className: 'provider-details', key: 'details' }, [
                    React.createElement('span', { key: 'type' },
                      providerTypes[p.type] ? providerTypes[p.type].label : p.type),
                    p.defaultModel && React.createElement('span', { key: 'model', style: { marginLeft: 12 } },
                      '模型: ' + p.defaultModel),
                  ]),
                  React.createElement('div', { className: 'provider-url', key: 'url' }, p.baseUrl),
                ]),

                // 操作按钮
                React.createElement('div', { className: 'provider-actions', key: 'actions' }, [
                  React.createElement('button', {
                    className: 'btn btn-sm',
                    onClick: () => handleTestConnection(p),
                    disabled: testingId === p.id,
                    title: '测试连通性',
                  }, testingId === p.id ? '⏳ 测试中...' : '🔌 测试'),
                  React.createElement('button', {
                    className: 'btn btn-sm',
                    onClick: () => handleToggleActive(p),
                    title: p.isActive ? '禁用' : '启用',
                  }, p.isActive ? '⏸ 禁用' : '▶ 启用'),
                  React.createElement('button', {
                    className: 'btn btn-sm',
                    onClick: () => handleEdit(p),
                    title: '编辑',
                  }, '✏️ 编辑'),
                  React.createElement('button', {
                    className: 'btn btn-sm btn-danger',
                    onClick: () => handleDelete(p.id, p.name),
                    title: '删除',
                  }, '🗑 删除'),
                ]),
              ])
            )
          ),
    ]);
  };

  const typeInfo = providerTypes[formData.type] || {};

  // 配置表单 Modal
  const renderForm = () => {
    if (!showForm) return null;

    return React.createElement('div', {
      className: 'modal-overlay',
      key: 'modal',
      onClick: (e) => { if (e.target.className === 'modal-overlay') setShowForm(false); },
    },
      React.createElement('div', { className: 'modal' }, [
        React.createElement('div', { className: 'modal-header', key: 'h' },
          React.createElement('h3', null, editingProvider ? '编辑 Provider' : '添加 Provider'),
        ),
        React.createElement('div', { className: 'modal-body', key: 'b' }, [
          // 名称
          React.createElement('div', { className: 'form-group', key: 'name' }, [
            React.createElement('label', null, '名称'),
            React.createElement('input', {
              type: 'text',
              className: 'form-input',
              value: formData.name,
              onChange: (e) => handleFormChange('name', e.target.value),
              placeholder: '例如: 本地 Ollama',
            }),
          ]),

          // 类型
          React.createElement('div', { className: 'form-group', key: 'type' }, [
            React.createElement('label', null, '类型'),
            React.createElement('select', {
              className: 'form-input',
              value: formData.type,
              onChange: (e) => handleTypeChange(e.target.value),
            }, Object.entries(providerTypes).map(([k, v]) =>
              React.createElement('option', { key: k, value: k }, v.label)
            )),
          ]),

          // Base URL
          React.createElement('div', { className: 'form-group', key: 'url' }, [
            React.createElement('label', null, 'API 地址'),
            React.createElement('input', {
              type: 'text',
              className: 'form-input',
              value: formData.baseUrl,
              onChange: (e) => handleFormChange('baseUrl', e.target.value),
              placeholder: typeInfo.defaultBaseUrl || 'http://localhost:11434',
            }),
          ]),

          // API Key (仅 OpenAI 兼容需要)
          typeInfo.needsApiKey !== false && React.createElement('div', { className: 'form-group', key: 'key' }, [
            React.createElement('label', null, 'API Key'),
            React.createElement('input', {
              type: 'password',
              className: 'form-input',
              value: formData.apiKey,
              onChange: (e) => handleFormChange('apiKey', e.target.value),
              placeholder: '输入 API Key',
            }),
          ]),

          // 默认模型
          React.createElement('div', { className: 'form-group', key: 'model' }, [
            React.createElement('label', null, '默认模型'),
            React.createElement('input', {
              type: 'text',
              className: 'form-input',
              value: formData.defaultModel,
              onChange: (e) => handleFormChange('defaultModel', e.target.value),
              placeholder: '例如: qwen3:8b 或 deepseek-v4-flash',
            }),
          ]),

          // 测试结果
          testResult && React.createElement('div', {
            className: 'test-result ' + (testResult.ok ? 'test-ok' : 'test-fail'),
            key: 'test',
          }, testResult.message),
        ]),

        React.createElement('div', { className: 'modal-footer', key: 'f' }, [
          React.createElement('button', {
            className: 'btn btn-ghost',
            onClick: () => setShowForm(false),
          }, '取消'),
          React.createElement('button', {
            className: 'btn btn-secondary',
            onClick: handleTestCurrent,
            style: { marginRight: 8 },
          }, '🔌 测试连接'),
          React.createElement('button', {
            className: 'btn btn-primary',
            onClick: handleSave,
          }, '保存'),
        ]),
      ])
    );
  };

  // Token 统计面板
  const renderTokenStats = () => {
    const ts = tokenStats;
    const tt = timeStats;

    return React.createElement('div', { key: 'token-stats' }, [
      React.createElement('div', { className: 'settings-toolbar', key: 'toolbar' }, [
        React.createElement('h3', null, 'Token 使用统计'),
        React.createElement('button', {
          className: 'btn btn-sm btn-danger',
          onClick: handleClearTokenStats,
        }, '🗑 清空统计'),
      ]),

      // 时间范围卡片
      React.createElement('div', { className: 'stats-grid', key: 'time-cards' }, [
        React.createElement('div', { className: 'stat-card', key: 'today' }, [
          React.createElement('div', { className: 'stat-card-header' },
            React.createElement('div', { className: 'stat-icon blue' }, '📅')),
          React.createElement('div', { className: 'stat-value' }, formatTokens(tt?.today?.totalTokens || 0)),
          React.createElement('div', { className: 'stat-label' }, '今日 Token'),
          React.createElement('div', { className: 'stat-sub' }, (tt?.today?.requests || 0) + ' 次请求'),
        ]),
        React.createElement('div', { className: 'stat-card', key: 'week' }, [
          React.createElement('div', { className: 'stat-card-header' },
            React.createElement('div', { className: 'stat-icon cyan' }, '📊')),
          React.createElement('div', { className: 'stat-value' }, formatTokens(tt?.thisWeek?.totalTokens || 0)),
          React.createElement('div', { className: 'stat-label' }, '本周 Token'),
          React.createElement('div', { className: 'stat-sub' }, (tt?.thisWeek?.requests || 0) + ' 次请求'),
        ]),
        React.createElement('div', { className: 'stat-card', key: 'month' }, [
          React.createElement('div', { className: 'stat-card-header' },
            React.createElement('div', { className: 'stat-icon green' }, '📈')),
          React.createElement('div', { className: 'stat-value' }, formatTokens(tt?.thisMonth?.totalTokens || 0)),
          React.createElement('div', { className: 'stat-label' }, '本月 Token'),
          React.createElement('div', { className: 'stat-sub' }, (tt?.thisMonth?.requests || 0) + ' 次请求'),
        ]),
        React.createElement('div', { className: 'stat-card', key: 'all' }, [
          React.createElement('div', { className: 'stat-card-header' },
            React.createElement('div', { className: 'stat-icon amber' }, '📦')),
          React.createElement('div', { className: 'stat-value' }, formatTokens(tt?.all?.totalTokens || 0)),
          React.createElement('div', { className: 'stat-label' }, '总计 Token'),
          React.createElement('div', { className: 'stat-sub' }, '费用 $' + (tt?.all?.cost || 0).toFixed(6)),
        ]),
      ]),

      // 按 Provider 统计
      React.createElement('div', { className: 'card', key: 'provider-stats', style: { marginTop: 20 } }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title' }, '按 Provider 统计')),
        ts?.byProvider && ts.byProvider.length > 0
          ? React.createElement('table', { className: 'stats-table', key: 'table' }, [
              React.createElement('thead', { key: 'thead' },
                React.createElement('tr', null, [
                  React.createElement('th', { key: 'n' }, 'Provider'),
                  React.createElement('th', { key: 'r' }, '请求数'),
                  React.createElement('th', { key: 't' }, 'Token 数'),
                  React.createElement('th', { key: 'p' }, '占比'),
                ])
              ),
              React.createElement('tbody', { key: 'tbody' },
                ts.byProvider.map((item, i) =>
                  React.createElement('tr', { key: i }, [
                    React.createElement('td', null, item.providerName),
                    React.createElement('td', null, item.requests),
                    React.createElement('td', null, formatTokens(item.tokens)),
                    React.createElement('td', null,
                      ((item.tokens / (ts.totalTokens || 1)) * 100).toFixed(1) + '%'),
                  ])
                )
              ),
            ])
          : React.createElement('div', { className: 'empty-state', key: 'empty' },
              React.createElement('p', null, '暂无 Token 使用记录')),
      ]),

      // 按模型统计
      React.createElement('div', { className: 'card', key: 'model-stats', style: { marginTop: 12 } }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title' }, '按模型统计')),
        ts?.byModel && ts.byModel.length > 0
          ? React.createElement('table', { className: 'stats-table', key: 'table' }, [
              React.createElement('thead', { key: 'thead' },
                React.createElement('tr', null, [
                  React.createElement('th', { key: 'm' }, '模型'),
                  React.createElement('th', { key: 'r' }, '请求数'),
                  React.createElement('th', { key: 'i' }, '输入 Token'),
                  React.createElement('th', { key: 'o' }, '输出 Token'),
                  React.createElement('th', { key: 't' }, '总计 Token'),
                ])
              ),
              React.createElement('tbody', { key: 'tbody' },
                ts.byModel.map((item, i) =>
                  React.createElement('tr', { key: i }, [
                    React.createElement('td', { style: { fontWeight: 500 } }, item.model),
                    React.createElement('td', null, item.requests),
                    React.createElement('td', null, formatTokens(item.promptTokens)),
                    React.createElement('td', null, formatTokens(item.completionTokens)),
                    React.createElement('td', null, formatTokens(item.totalTokens)),
                  ])
                )
              ),
            ])
          : React.createElement('div', { className: 'empty-state', key: 'empty' },
              React.createElement('p', null, '暂无按模型统计数据')),
      ]),
    ]);
  };

  // 选项卡内容
  const tabContent = activeTab === 'providers' ? renderProviders() : renderTokenStats();

  return React.createElement('div', { className: 'page-container' }, [
    // 选项卡导航
    React.createElement('div', { className: 'settings-tab-bar', key: 'tabs' }, [
      React.createElement('button', {
        className: 'settings-tab-btn' + (activeTab === 'providers' ? ' active' : ''),
        onClick: () => setActiveTab('providers'),
      }, '🤖 AI 模型配置'),
      React.createElement('button', {
        className: 'settings-tab-btn' + (activeTab === 'token' ? ' active' : ''),
        onClick: () => setActiveTab('token'),
      }, '📊 Token 统计'),
    ]),

    // 内容区
    React.createElement('div', { className: 'settings-content', key: 'content' },
      tabContent
    ),

    // Modal
    renderForm(),
  ]);
};

// 辅助: 格式化 Token 数字
function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
