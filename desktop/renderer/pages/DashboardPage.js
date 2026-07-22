// DashboardPage.jsx - 炫酷仪表盘首页
const DashboardPage = () => {
  const [data, setData] = React.useState({ loading: true });
  const [animate, setAnimate] = React.useState(false);
  const [aiInfo, setAiInfo] = React.useState({ providers: 0, activeProvider: null, todayTokens: 0 });

  React.useEffect(() => {
    (async () => {
      const state = pipelineStore.getState();
      const stats = state.stats || {};
      const recording = state.recording;

      // 读取已保存的数据
      let caseVo = null, candidates = [], envConfig = null;
      const stateOutDir = state.outDir || 'out';
      try { caseVo = await window.appApi.readFile(stateOutDir + '/case-save.json'); } catch {}
      try {
        const c = await window.appApi.readFile(stateOutDir + '/candidates.json');
        if (c) candidates = Array.isArray(c) ? c : [];
      } catch {}
      try { envConfig = await window.appApi.readFile(stateOutDir + '/env-config.json'); } catch {}

      // 获取历史记录数量
      let historyCount = 0;
      try {
        const files = await window.appApi.dirList('out');
        const exclude = new Set(['cleaned.json','linked.json','case-save.json','env-config.json','stats.json','deps.json','deps-graph.json']);
        historyCount = files ? files.filter(f => f.endsWith('.json') && !exclude.has(f)).length : 0;
      } catch {}

      // 统计接口方法分布（优先从录制数据，兜底从 case-save.json）
      const methodCount = {};
      const scenarios = Array.isArray(recording) ? recording : [];
      scenarios.forEach(sc => {
        const reqs = sc.requests || sc.apiList || [];
        reqs.forEach(r => {
          const m = (r.method || r.requestMethod || 'GET').toUpperCase();
          methodCount[m] = (methodCount[m] || 0) + 1;
        });
      });

      // 如果录制数据为空，从 case-save.json 兜底统计
      if (Object.keys(methodCount).length === 0 && caseVo && caseVo.apiVos) {
        caseVo.apiVos.forEach(api => {
          const m = (api.apiMethod || 'GET').toUpperCase();
          methodCount[m] = (methodCount[m] || 0) + 1;
        });
      }

      // 如果 still empty，尝试从 linked.json 或 cleaned.json 统计
      if (Object.keys(methodCount).length === 0 && stateOutDir) {
        try {
          const linked = await window.appApi.readFile(stateOutDir + '/linked.json');
          if (Array.isArray(linked)) {
            linked.forEach(r => {
              const m = (r.method || r.requestMethod || 'GET').toUpperCase();
              methodCount[m] = (methodCount[m] || 0) + 1;
            });
          }
        } catch {}
      }
      const totalMethods = Object.values(methodCount).reduce((a, b) => a + b, 0);
      const methodList = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
        .filter(m => methodCount[m])
        .map(m => ({ method: m, count: methodCount[m], pct: totalMethods > 0 ? Math.round((methodCount[m] / totalMethods) * 100) : 0 }));

      setData({
        loading: false,
        scenarios: scenarios.length,
        totalApis: stats.totalRequests || 0,
        pipelineRuns: historyCount || 0,
        reviewCount: candidates.length || 0,
        hasEnv: !!envConfig,
        methodList,
        hasRecording: !!recording,
        hasCase: !!caseVo,
        caseName: caseVo?.name || null,
      });

      // 获取 AI 配置和 Token 统计
      try {
        const [providers, timeStats] = await Promise.all([
          window.appApi.getAiProviders(),
          window.appApi.getTokenTimeStats(),
        ]);
        const activeArr = Array.isArray(providers) ? providers.filter(p => p.isActive) : [];
        const active = activeArr.length > 0 ? activeArr[0] : null;
        setAiInfo({
          providers: activeArr.length,  // 只统计启用的
          activeProvider: active,
          activeCount: activeArr.length,
          todayTokens: timeStats?.today?.totalTokens || 0,
          todayRequests: timeStats?.today?.requests || 0,
        });
      } catch {}

      // 触发条形图动画
      setTimeout(() => setAnimate(true), 200);
    })();
  }, []);

  // Agent 定义
  const agents = [
    { icon: '📦', label: '录制导入', gradient: 'linear-gradient(135deg, #6366F1, #818CF8)', key: 'import' },
    { icon: '🧹', label: '数据清洗', gradient: 'linear-gradient(135deg, #06B6D4, #22D3EE)', key: 'cleaner' },
    { icon: '🌐', label: '环境识别', gradient: 'linear-gradient(135deg, #10B981, #34D399)', key: 'env' },
    { icon: '🔗', label: '跨接口关联', gradient: 'linear-gradient(135deg, #F59E0B, #FBBF24)', key: 'linker' },
    { icon: '🧩', label: '用例拼装', gradient: 'linear-gradient(135deg, #8B5CF6, #A78BFA)', key: 'assembler' },
    { icon: '🔍', label: '智能审查', gradient: 'linear-gradient(135deg, #EC4899, #F472B6)', key: 'review' },
    { icon: '🏃', label: '回归验证', gradient: 'linear-gradient(135deg, #EF4444, #F87171)', key: 'run' },
    { icon: '📤', label: '平台导出', gradient: 'linear-gradient(135deg, #64748B, #94A3B8)', key: 'export' },
  ];

  // 根据是否有录制数据决定哪些 Agent 激活
  const activeCount = data.hasRecording ? 3 : 0; // 有录制则前3个激活
  const activeTill = data.hasCase ? 5 : activeCount;

  // 最近活动
  const recentActivities = [];
  if (data.hasRecording && data.scenarios > 0) {
    recentActivities.push({ time: '最新', type: 'pipeline', title: '管道处理可运行', desc: data.scenarios + ' 场景, ' + data.totalApis + ' 接口', tag: 'info', tagText: '就绪' });
  }
  if (data.hasCase) {
    recentActivities.push({ time: '最新', type: 'export', title: '用例已生成', desc: data.caseName || 'API 自动化测试用例', tag: 'success', tagText: '完成' });
  }
  if (data.reviewCount > 0) {
    recentActivities.push({ time: '待处理', type: 'review', title: '智能审查发现 ' + data.reviewCount + ' 项建议', desc: '请前往智能审查页面查看详情', tag: 'warning', tagText: '待处理' });
  }
  if (!data.hasRecording) {
    recentActivities.push({ time: '提示', type: 'import', title: '开始使用 QM-Testing', desc: '导入录制文件以启动 API 自动化测试流程', tag: 'info', tagText: '开始' });
  }

  if (data.loading) {
    return React.createElement('div', null,
      React.createElement('div', { className: 'dashboard-greeting' }, [
        React.createElement('h2', { key: 't' }, '🏠 仪表盘'),
        React.createElement('p', { key: 'd' }, '加载中...'),
      ])
    );
  }

  return React.createElement('div', null, [
    // Greeting
    React.createElement('div', { className: 'dashboard-greeting', key: 'greeting' }, [
      React.createElement('h2', { key: 't' }, '🏠 仪表盘'),
      React.createElement('p', { key: 'd' },
        '共处理 ' + (data.pipelineRuns || 0) + ' 次流水线 · ' +
        (data.scenarios || 0) + ' 个场景 · ' +
        (data.totalApis || 0) + ' 个接口'),
    ]),

    // Multi-Agent Pipeline 示意图
    React.createElement('div', { className: 'agent-pipeline', key: 'pipeline' }, [
      React.createElement('div', { className: 'agent-pipeline-title', key: 'h' }, [
        React.createElement('h3', { key: 't' }, [
          '⚡ Multi-Agent 流水线',
          React.createElement('span', { style: { fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 400, marginLeft: 8 } },
            '7 个 Agent 协同处理'),
        ]),
        React.createElement('span', { className: 'badge-soft', key: 'b' },
          data.hasRecording ? '已就绪' : '待启动'),
      ]),
      React.createElement('div', { className: 'agent-flow', key: 'flow' },
        agents.map((agent, i) => {
          const isActive = i <= activeTill;
          const cls = 'agent-node' + (isActive ? ' active' : ' inactive');
          const connCls = 'agent-connector' + (i < activeTill ? ' active' : ' inactive');
          return [
            React.createElement('div', { className: cls, key: 'node-' + i }, [
              React.createElement('div', {
                className: 'agent-node-icon',
                style: { background: agent.gradient },
              }, agent.icon),
              React.createElement('span', { className: 'agent-node-label' }, agent.label),
            ]),
            i < agents.length - 1 &&
              React.createElement('div', { className: connCls, key: 'conn-' + i }, [
                React.createElement('div', { className: 'agent-connector-line' }),
              ]),
          ];
        })
      ),
    ]),

    // Stats Cards
    React.createElement('div', { className: 'stats-grid', key: 'stats' }, [
      React.createElement('div', { className: 'stat-card', key: 'sc' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon blue' }, '📋')),
        React.createElement('div', { className: 'stat-value' }, data.scenarios),
        React.createElement('div', { className: 'stat-label' }, '录制场景'),
      ]),
      React.createElement('div', { className: 'stat-card', key: 'api' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon cyan' }, '🔗')),
        React.createElement('div', { className: 'stat-value' }, data.totalApis),
        React.createElement('div', { className: 'stat-label' }, 'API 接口'),
      ]),
      React.createElement('div', { className: 'stat-card', key: 'run' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon green' }, '⚡')),
        React.createElement('div', { className: 'stat-value' }, data.pipelineRuns),
        React.createElement('div', { className: 'stat-label' }, '流水线运行'),
      ]),
      React.createElement('div', { className: 'stat-card', key: 'rev' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon amber' }, '🔍')),
        React.createElement('div', { className: 'stat-value' }, data.reviewCount),
        React.createElement('div', { className: 'stat-label' }, '审查建议'),
      ]),
      React.createElement('div', { className: 'stat-card', key: 'env' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon' + (data.hasEnv ? ' blue' : '') },
            data.hasEnv ? '🌐' : '⋯')),
        React.createElement('div', { className: 'stat-value' }, data.hasEnv ? '已配置' : '未配置'),
        React.createElement('div', { className: 'stat-label' }, '环境配置'),
      ]),
    ]),

    // AI Status Row
    React.createElement('div', { className: 'stats-grid', key: 'ai-stats', style: { marginTop: 8 } }, [
      React.createElement('div', { className: 'stat-card', key: 'ai-providers' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon purple' }, '🤖')),
        React.createElement('div', { className: 'stat-value' }, aiInfo.providers),
        React.createElement('div', { className: 'stat-label' }, 'AI Provider'),
        React.createElement('div', { className: 'stat-sub', style: { fontSize: 11, color: 'rgba(255,255,255,0.4)' } },
          aiInfo.activeProvider
            ? '默认: ' + aiInfo.activeProvider.defaultModel || aiInfo.activeProvider.name
            : '未配置默认模型'),
      ]),
      React.createElement('div', { className: 'stat-card', key: 'ai-model' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon cyan' }, '🧠')),
        React.createElement('div', { className: 'stat-value', style: { fontSize: 14 } },
          aiInfo.activeProvider ? (aiInfo.activeProvider.defaultModel || '未设置') : '—'),
        React.createElement('div', { className: 'stat-label' }, '默认 AI 模型'),
      ]),
      React.createElement('div', { className: 'stat-card', key: 'ai-tokens' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon amber' }, '📊')),
        React.createElement('div', { className: 'stat-value' }, formatTokens(aiInfo.todayTokens)),
        React.createElement('div', { className: 'stat-label' }, '今日 Token'),
        React.createElement('div', { className: 'stat-sub', style: { fontSize: 11, color: 'rgba(255,255,255,0.4)' } },
          (aiInfo.todayRequests || 0) + ' 次请求'),
      ]),
      React.createElement('div', { className: 'stat-card', key: 'ai-settings',
        style: { cursor: 'pointer' },
        onClick: () => pipelineStore.setState({ currentPage: 'settings' }),
      }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon blue' }, '⚙️')),
        React.createElement('div', { className: 'stat-value', style: { fontSize: 14 } }, '管理设置'),
        React.createElement('div', { className: 'stat-label' }, 'AI 模型配置'),
        React.createElement('div', { className: 'stat-sub', style: { fontSize: 11, color: 'rgba(255,255,255,0.4)' } },
          '点击配置 >'),
      ]),
    ]),

    // Charts Row
    React.createElement('div', { className: 'dashboard-charts', key: 'charts' }, [
      // Method Distribution Bar Chart
      React.createElement('div', { className: 'chart-card', key: 'methods' }, [
        React.createElement('div', { className: 'chart-card-header' },
          React.createElement('h4', null, '📊 请求方法分布')),
        data.methodList.length > 0
          ? React.createElement('div', { className: 'bar-chart' },
              data.methodList.map((item, i) =>
                React.createElement('div', { className: 'bar-row', key: i }, [
                  React.createElement('span', {
                    className: 'bar-label method-badge ' + item.method.toLowerCase(),
                  }, item.method),
                  React.createElement('div', { className: 'bar-track' },
                    React.createElement('div', {
                      className: 'bar-fill ' + item.method.toLowerCase(),
                      style: { width: (animate ? item.pct : 0) + '%' },
                    },
                      item.pct > 15 &&
                        React.createElement('span', { className: 'bar-pct' }, item.pct + '%'),
                    ),
                  ),
                  React.createElement('span', { className: 'bar-value' }, item.count),
                ])
              )
            )
          : React.createElement('div', { className: 'empty-state', style: { padding: '16px 0' } },
            React.createElement('p', null, '暂无接口数据，请先导入录制')),
      ]),

      // Status / Quick Info
      React.createElement('div', { className: 'chart-card', key: 'status' }, [
        React.createElement('div', { className: 'chart-card-header' },
          React.createElement('h4', null, '📈 系统状态')),
        React.createElement('div', { className: 'bar-chart' }, [
          React.createElement('div', { className: 'bar-row', key: 'rec' }, [
            React.createElement('span', { className: 'bar-label', style: { color: 'var(--text)' } }, '录制'),
            React.createElement('div', { className: 'bar-track' },
              React.createElement('div', {
                className: 'bar-fill' + (data.hasRecording ? ' get' : ''),
                style: { width: (animate ? (data.hasRecording ? 100 : 10) : 0) + '%' },
              },
                React.createElement('span', { className: 'bar-pct' },
                  data.hasRecording ? '✅ 就绪' : '⏳ 待导入')),
            ),
          ]),
          React.createElement('div', { className: 'bar-row', key: 'env' }, [
            React.createElement('span', { className: 'bar-label', style: { color: 'var(--text)' } }, '环境'),
            React.createElement('div', { className: 'bar-track' },
              React.createElement('div', {
                className: 'bar-fill' + (data.hasEnv ? ' post' : ''),
                style: { width: (animate ? (data.hasEnv ? 100 : 10) : 0) + '%' },
              },
                React.createElement('span', { className: 'bar-pct' },
                  data.hasEnv ? '✅ 已配置' : '⏳ 待配置')),
            ),
          ]),
          React.createElement('div', { className: 'bar-row', key: 'case' }, [
            React.createElement('span', { className: 'bar-label', style: { color: 'var(--text)' } }, '用例'),
            React.createElement('div', { className: 'bar-track' },
              React.createElement('div', {
                className: 'bar-fill' + (data.hasCase ? ' put' : ''),
                style: { width: (animate ? (data.hasCase ? 100 : 10) : 0) + '%' },
              },
                React.createElement('span', { className: 'bar-pct' },
                  data.hasCase ? '✅ 已生成' : '⏳ 待生成')),
            ),
          ]),
          React.createElement('div', { className: 'bar-row', key: 'review' }, [
            React.createElement('span', { className: 'bar-label', style: { color: 'var(--text)' } }, '审查'),
            React.createElement('div', { className: 'bar-track' },
              React.createElement('div', {
                className: 'bar-fill' + (data.reviewCount > 0 ? ' delete' : ''),
                style: { width: (animate ? (data.reviewCount > 0 ? 100 : 10) : 0) + '%' },
              },
                React.createElement('span', { className: 'bar-pct' },
                  data.reviewCount > 0 ? '✅ 完成' : '⏳ 待审查')),
            ),
          ]),
        ]),
      ]),
    ]),

    // Recent Activity
    React.createElement('div', { className: 'card', key: 'activity' }, [
      React.createElement('div', { className: 'card-header', key: 'h' },
        React.createElement('div', { className: 'card-title', key: 't' }, [
          '📋 活动概览',
          React.createElement('span', { className: 'badge', key: 'b' }, recentActivities.length + ' 项'),
        ]),
      ),
      recentActivities.length > 0
        ? React.createElement('div', { className: 'activity-feed', key: 'feed' },
            recentActivities.map((act, i) =>
              React.createElement('div', { className: 'activity-item', key: i }, [
                React.createElement('span', { className: 'activity-time' }, act.time),
                React.createElement('span', { className: 'activity-dot ' + act.type }),
                React.createElement('div', { className: 'activity-content' }, [
                  React.createElement('div', { className: 'title' }, act.title),
                  React.createElement('div', { className: 'desc' }, act.desc),
                ]),
                React.createElement('span', { className: 'activity-tag ' + act.tag }, act.tagText),
              ])
            )
          )
        : React.createElement('div', { className: 'empty-state', key: 'empty' }, [
            React.createElement('span', { className: 'empty-state-icon' }, '📋'),
            React.createElement('h3', null, '欢迎使用 QM-Testing'),
            React.createElement('p', null, '导入录制文件开始你的第一个 API 自动化测试流程'),
          ]),
    ]),

    // Quick Action
    !data.hasRecording &&
      React.createElement('div', {
        style: { textAlign: 'center', marginTop: 20 },
        key: 'cta',
      }, [
        React.createElement('button', {
          className: 'btn btn-primary btn-lg',
          onClick: () => pipelineStore.setState({ currentPage: 'import' }),
          style: { minWidth: 240 },
        }, '📂 导入录制 → 开始使用'),
      ]),
  ]);
};

// 辅助: 格式化 Token 数字
function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

