// LogViewerPage.js - 日志查看器（类似终端控制台）
const LogViewerPage = () => {
  const [logs, setLogs] = React.useState([]);
  const [filteredLogs, setFilteredLogs] = React.useState([]);
  const [levelFilter, setLevelFilter] = React.useState('ALL');
  const [searchText, setSearchText] = React.useState('');
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [logConfig, setLogConfig] = React.useState(null);
  const [clearing, setClearing] = React.useState(false);
  const listRef = React.useRef(null);

  // 日志级别颜色映射
  const levelColors = {
    DEBUG: { bg: '#1e293b', color: '#64748b', label: 'DEBG' },
    INFO: { bg: '#0f3b2e', color: '#22c55e', label: 'INFO' },
    WARN: { bg: '#422006', color: '#f59e0b', label: 'WARN' },
    ERROR: { bg: '#450a0a', color: '#ef4444', label: 'ERRO' },
    FATAL: { bg: '#4c0519', color: '#ec4899', label: 'FATA' },
  };
  const defaultLevel = { bg: '#1e293b', color: '#94a3b8', label: '????' };

  React.useEffect(() => {
    // 加载历史日志
    (async () => {
      try {
        const recent = await window.appApi.logRecent();
        if (recent && recent.length > 0) {
          const parsed = recent.map(line => parseLogLine(line));
          setLogs(parsed);
        }
      } catch { /* 非 Electron 或 IPC 不支持 */ }
      try {
        const cfg = await window.appApi.logConfig();
        if (cfg) setLogConfig(cfg);
      } catch {}
    })();

    // 监听实时日志推送
    let unsub = null;
    try {
      unsub = window.appApi.onLogEntry((entry) => {
        setLogs(prev => {
          const next = [...prev, entry];
          if (next.length > 2000) return next.slice(-2000);
          return next;
        });
      });
    } catch { /* 无 IPC 支持 */ }

    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  // 解析日志行（从历史文件读取的纯文本）
  function parseLogLine(line) {
    const match = line.match(/^\[(.+?)\]\s+\[(.+?)\]\s+\[(.+?)\]\s+(.+)$/);
    if (match) {
      return {
        timestamp: match[1],
        level: match[2],
        module: match[3],
        message: match[4],
      };
    }
    return { timestamp: '', level: 'INFO', module: '', message: line };
  }

  // 过滤
  React.useEffect(() => {
    let result = logs;
    if (levelFilter !== 'ALL') {
      result = result.filter(l => l.level === levelFilter);
    }
    if (searchText.trim()) {
      const kw = searchText.toLowerCase();
      result = result.filter(l =>
        l.message.toLowerCase().includes(kw) ||
        l.module.toLowerCase().includes(kw)
      );
    }
    setFilteredLogs(result);
  }, [logs, levelFilter, searchText]);

  // 自动滚动
  React.useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filteredLogs.length, autoScroll]);

  const levels = ['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

  return React.createElement('div', { className: 'page-container', key: 'log-page' }, [
    // Header
    React.createElement('div', { className: 'page-header', key: 'h' }, [
      React.createElement('h2', { key: 't' }, '📋 运行日志'),
      logConfig && React.createElement('span', {
        className: 'tag tag-info',
        style: { marginLeft: 12, fontSize: 11 },
        key: 'cfg',
      }, `${logConfig.level} · ${logConfig.dir}`),
    ]),

    // Filters
    React.createElement('div', {
      className: 'card',
      style: { padding: '10px 16px', marginBottom: 16 },
      key: 'filters',
    }, [
      React.createElement('div', {
        style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      }, [
        React.createElement('span', { key: 'lbl', style: { fontSize: 12, color: '#94a3b8' } }, '级别:'),
        ...levels.map(lv =>
          React.createElement('button', {
            key: lv,
            className: 'btn btn-sm' + (levelFilter === lv ? ' btn-primary' : ''),
            onClick: () => setLevelFilter(lv),
            style: { fontSize: 11, padding: '3px 10px' },
          }, lv === 'ALL' ? '全部' : lv)
        ),
        React.createElement('span', { key: 'spl', style: { fontSize: 12, color: '#94a3b8', marginLeft: 12 } }, '搜索:'),
        React.createElement('input', {
          key: 'search',
          type: 'text',
          placeholder: '关键词...',
          value: searchText,
          onChange: e => setSearchText(e.target.value),
          style: {
            padding: '4px 10px', background: '#1e293b', border: '1px solid #334155',
            borderRadius: 6, color: '#e2e8f0', fontSize: 12, fontFamily: 'inherit',
            outline: 'none', width: 200,
          },
        }),
        React.createElement('label', {
          key: 'autoscroll',
          style: { marginLeft: 12, fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' },
        }, [
          React.createElement('input', {
            type: 'checkbox',
            checked: autoScroll,
            onChange: e => setAutoScroll(e.target.checked),
            style: { accentColor: '#6366f1' },
          }),
          '自动滚动',
        ]),
        React.createElement('span', {
          key: 'count',
          style: { marginLeft: 'auto', fontSize: 11, color: '#64748b' },
        }, `${filteredLogs.length} 条`),
      ]),
    ]),

    // Log Console
    React.createElement('div', {
      className: 'card',
      key: 'console',
      style: { padding: 0, overflow: 'hidden' },
    }, [
      React.createElement('div', {
        ref: listRef,
        style: {
          height: 'calc(100vh - 300px)', minHeight: 300, overflowY: 'auto',
          background: '#0b1120', fontFamily: "'Cascadia Code','Fira Code','Consolas',monospace",
          fontSize: 12, lineHeight: 1.6, padding: '8px 0',
        },
      }, [
        filteredLogs.length === 0 &&
          React.createElement('div', {
            style: { textAlign: 'center', padding: 60, color: '#475569' },
          }, [
            React.createElement('div', { style: { fontSize: 32, marginBottom: 8 } }, '📭'),
            React.createElement('div', null, '暂无日志记录'),
            React.createElement('div', { style: { fontSize: 11, marginTop: 4 } },
              '启动管道处理后将自动生成日志'),
          ]),
        ...filteredLogs.map((log, i) => {
          const lc = levelColors[log.level] || defaultLevel;
          return React.createElement('div', {
            key: i,
            style: {
              display: 'flex', gap: 8, padding: '1px 16px',
              background: log.level === 'ERROR' || log.level === 'FATAL' ? 'rgba(239,68,68,0.05)' : 'transparent',
              hover: { background: 'rgba(99,102,241,0.05)' },
            },
            onMouseEnter: e => e.currentTarget.style.background = 'rgba(99,102,241,0.08)',
            onMouseLeave: e => e.currentTarget.style.background = 'transparent',
          }, [
            // Level badge
            React.createElement('span', {
              style: {
                flexShrink: 0, minWidth: 40, textAlign: 'center',
                background: lc.bg, color: lc.color,
                borderRadius: 3, padding: '0 4px', fontSize: 10,
                fontWeight: 700, alignSelf: 'center',
              },
            }, lc.label),
            // Timestamp
            React.createElement('span', {
              style: { flexShrink: 0, color: '#475569', fontSize: 11, minWidth: 180 },
            }, log.timestamp || ''),
            // Module
            React.createElement('span', {
              style: {
                flexShrink: 0, color: '#818cf8', minWidth: 100,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              },
            }, log.module || ''),
            // Message
            React.createElement('span', {
              style: {
                flex: 1, color: log.level === 'ERROR' ? '#fca5a5'
                      : log.level === 'WARN' ? '#fcd34d'
                      : log.level === 'DEBUG' ? '#94a3b8'
                      : '#e2e8f0',
                wordBreak: 'break-all',
              },
            }, log.message || ''),
          ]);
        }),
      ]),
    ]),

    // Footer actions
    React.createElement('div', {
      style: { display: 'flex', gap: 8, marginTop: 12 },
      key: 'actions',
    }, [
      React.createElement('button', {
        className: 'btn btn-sm',
        onClick: () => setLogs([]),
        style: { fontSize: 12 },
      }, '\uD83D\uDDD1 清屏'),
      React.createElement('button', {
        className: 'btn btn-sm',
        onClick: async () => {
          if (!window.confirm('\u786E\u8BA4\u6E05\u7406\u6240\u6709\u65E5\u5FD7\u6587\u4EF6\uFF1F\u6B64\u64CD\u4F5C\u5C06\u7269\u7406\u5220\u9664\u78C1\u76D8\u4E0A\u7684\u65E5\u5FD7\u6587\u4EF6\uFF0C\u4E0D\u53EF\u6062\u590D\u3002')) return;
          setClearing(true);
          try {
            const result = await window.appApi.clearLogs();
            if (result.success) {
              setLogs([]);
              window.appApi.showToast('\u5DF2\u6E05\u7406 ' + result.deletedCount + ' \u4E2A\u65E5\u5FD7\u6587\u4EF6', 'success');
            } else {
              window.appApi.showToast('\u6E05\u7406\u5931\u8D25: ' + (result.error || '\u672A\u77E5\u9519\u8BEF'), 'error');
            }
          } catch (e) {
            window.appApi.showToast('\u6E05\u7406\u5931\u8D25: ' + e.message, 'error');
          }
          setClearing(false);
        },
        disabled: clearing,
        style: { fontSize: 12, color: 'var(--danger)' },
      }, clearing ? '\u6E05\u7406\u4E2D...' : '\uD83D\uDDD1 清理日志'),
      React.createElement('button', {
        className: 'btn btn-sm',
        onClick: async () => {
          try {
            const recent = await window.appApi.logRecent();
            if (recent) {
              const parsed = recent.map(line => parseLogLine(line));
              setLogs(parsed);
            }
          } catch {}
        },
        style: { fontSize: 12 },
      }, '\uD83D\uDD04 刷新'),
      React.createElement('button', {
        className: 'btn btn-sm',
        onClick: () => {
          const text = filteredLogs.map(l =>
            l.timestamp + ' [' + l.level + '] [' + l.module + '] ' + l.message
          ).join('\n');
          navigator.clipboard.writeText(text).then(() => {
            window.appApi.showToast('已复制日志', 'success');
          }).catch(() => {});
        },
        style: { fontSize: 12 },
      }, '\uD83D\uDCCB 复制选中'),
    ]),
  ]);
};
