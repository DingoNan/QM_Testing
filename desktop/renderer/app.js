// app.js - Main Application (Modern Redesign)
const App = () => {
  // 检测运行模式
  const [mode, setMode] = React.useState('detecting');
  const [currentPage, setCurrentPage] = React.useState('dashboard');
  const [toasts, setToasts] = React.useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [showGuide, setShowGuide] = React.useState(false);

  React.useEffect(() => {
    setMode(window.appApi?.isElectron ? 'electron' : 'web');
  }, []);

  // 启动时自动加载最近的项目
  React.useEffect(() => {
    if (mode !== 'electron') return;
    (async () => {
      try {
        const list = await window.appApi.listProjects();
        if (Array.isArray(list) && list.length > 0) {
          const latest = list[0];
          const result = await window.appApi.readPipelineResult(latest.outDir);
          if (result && result.success) {
            pipelineStore.setState({
              pipelineResult: result,
              outDir: latest.outDir,
            });
          }
        }
      } catch {}
    })();
  }, [mode]);

  // 监听 pipelineStore 页面切换
  React.useEffect(() => {
    const unsub = pipelineStore.subscribe((state) => {
      if (state.currentPage) setCurrentPage(state.currentPage);
    });
    return unsub;
  }, []);

  // Toast 系统
  React.useEffect(() => {
    const handler = (e) => {
      const { message, type } = e.detail;
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev, { id, message, type: type || 'info' }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3500);
    };
    window.addEventListener('app-toast', handler);
    return () => window.removeEventListener('app-toast', handler);
  }, []);

  const navItems = [
    { key: 'dashboard', label: '仪表盘', icon: '🏠' },
    { key: 'import', label: '导入录制', icon: '📂' },
    { key: 'pipeline', label: '管道处理', icon: '🔧' },
    { key: 'review', label: '智能审查', icon: '🔍' },
    { key: 'linker', label: '接口关联', icon: '🔗' },
    { key: 'data-pools', label: '测试数据', icon: '🗄️' },
    { key: 'regression', label: '回归验证', icon: '🚀' },
    { key: 'reports', label: '测试报告', icon: '📊' },
    { key: 'export', label: '导出/导入', icon: '📤' },
    { key: 'history', label: '历史记录', icon: '📋' },
    { key: 'settings', label: '设置', icon: '⚙️' },
    { key: 'logs', label: '运行日志', icon: '📋' },
  ];

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return React.createElement(DashboardPage, { key: 'dashboard' });
      case 'import': return React.createElement(ImportPage, { key: 'import' });
      case 'pipeline': return React.createElement(PipelinePage, { key: 'pipeline' });
      case 'review': return React.createElement(ReviewPage, { key: 'review' });
      case 'linker': return React.createElement(LinkerPage, { key: 'linker' });
      case 'data-pools': return React.createElement(DataPoolsPage, { key: 'data-pools' });
      case 'regression': return React.createElement(RegressionPage, { key: 'regression' });
      case 'reports': return React.createElement(ReportsPage, { key: 'reports' });
      case 'export': return React.createElement(ExportPage, { key: 'export' });
      case 'history': return React.createElement(HistoryPage, { key: 'history' });
      case 'settings': return React.createElement(SettingsPage, { key: 'settings' });
      case 'logs': return React.createElement(LogViewerPage, { key: 'logs' });
      default: return React.createElement(DashboardPage, { key: 'dashboard' });
    }
  };

  return React.createElement('div', { className: 'app-container' }, [
    // Sidebar
    React.createElement('aside', { className: 'sidebar', key: 'sidebar' }, [
      React.createElement('div', { className: 'sidebar-header', key: 'header' }, [
        React.createElement('div', { className: 'sidebar-logo', key: 'logo' }, 'QM-Testing'),
        React.createElement('div', { className: 'sidebar-subtitle', key: 'sub' }, 'API 自动化测试'),
      ]),
      React.createElement('nav', { className: 'sidebar-nav', key: 'nav' },
        navItems.map(item =>
          React.createElement('div', {
            key: item.key,
            className: 'sidebar-link' + (currentPage === item.key ? ' active' : ''),
            onClick: () => { setCurrentPage(item.key); pipelineStore.setState({ currentPage: item.key }); },
          }, [
            React.createElement('span', { className: 'sidebar-icon', key: 'icon' }, item.icon),
            React.createElement('span', { key: 'label' }, item.label),
          ])
        )
      ),
      React.createElement('div', { className: 'sidebar-footer', key: 'footer' }, [
        React.createElement('div', { key: 'row', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 6 } }, [
          React.createElement('span', { className: 'sidebar-version', key: 'ver' }, 'v1.0.0'),
          React.createElement('span', {
            className: 'sidebar-help-btn',
            key: 'help',
            onClick: () => setShowGuide(true),
            title: '\u4F7F\u7528\u8BF4\u660E',
          }, '\uD83D\uDCD6'),
        ]),
        React.createElement('span', { className: 'mode-badge', key: 'mode' },
          mode === 'electron' ? 'Desktop' : mode === 'web' ? 'Web' : '...'),
      ]),
    ]),

    // Main Content
    React.createElement('main', { className: 'main-content', key: 'main' }, [
      mode === 'web' && React.createElement('div', { className: 'web-mode-notice', key: 'notice' },
        '🌐 Web 模式 — 部分功能受限于浏览器环境（文件读写、管道处理为模拟）'),
      React.createElement('div', { className: 'page-wrapper', key: 'page' }, renderPage()),
    ]),

    // Toast Container
    React.createElement('div', { className: 'toast-container', key: 'toasts' },
      toasts.map(t =>
        React.createElement('div', {
          className: 'toast toast-' + (t.type || 'info'),
          key: t.id,
        }, [
          React.createElement('span', { key: 'icon' },
            t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : t.type === 'warning' ? '⚠' : 'ℹ'),
          React.createElement('span', { key: 'msg' }, t.message),
        ])
      )
    ),
    showGuide && React.createElement(ToolGuide, { key: 'guide', onClose: () => setShowGuide(false) }),
  ]);
};
