// VariableSelector.js - 变量选择器组件
// 支持两种模式:
//    dropdown (默认): [插入变量 ▼] 按钮 + 弹出层级菜单
//    card: 完整面板展示（用于独立页面）
// 5 个命名空间按作用域分层: 上下文 → 数据池 → 响应引用 → 环境变量 → 系统函数
const VariableSelector = ({ onSelect, context, compact, mode = 'card', label = '插入变量', buttonStyle }) => {
  const [expanded, setExpanded] = React.useState({});
  const [searchTerm, setSearchTerm] = React.useState('');
  const [sysFunctions, setSysFunctions] = React.useState([]);
  const [envVars, setEnvVars] = React.useState([]);
  const [seqVars, setSeqVars] = React.useState([]);
  const [dataVars, setDataVars] = React.useState([]);
  const [dataPoolName, setDataPoolName] = React.useState('');
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef(null);

  // 命名空间定义（含 emoji + 颜色，对应 5.4.3 节设计）
  const namespaces = [
    { key: 'ctx', label: '上下文变量', emoji: '\uD83D\uDFE2', color: '#16a34a', bg: '#f0fdf4' },
    { key: 'data', label: '数据池', emoji: '\uD83D\uDD35', color: '#2563eb', bg: '#eff6ff' },
    { key: 'seq', label: '响应引用', emoji: '\uD83D\uDFE1', color: '#ca8a04', bg: '#fefce8' },
    { key: 'env', label: '环境变量', emoji: '\uD83D\uDFE3', color: '#9333ea', bg: '#faf5ff' },
    { key: 'sys', label: '系统函数', emoji: '\uD83D\uDD34', color: '#dc2626', bg: '#fef2f2' },
  ];

  // 系统内置函数兜底列表（当 IPC 加载失败时使用）
  const builtInFunctions = [
    { name: 'phone', description: '生成 11 位手机号', category: 'random' },
    { name: 'email', description: '生成随机邮箱地址', category: 'random' },
    { name: 'idCard', description: '生成模拟身份证号', category: 'random' },
    { name: 'randStr', description: 'N 位随机字符串 randStr(N)', category: 'random' },
    { name: 'randNum', description: 'M~N 随机整数 randNum(M,N)', category: 'random' },
    { name: 'uuid', description: '标准 UUID v4', category: 'random' },
    { name: 'timestamp', description: '当前毫秒级时间戳', category: 'time' },
    { name: 'date', description: '日期格式化 date(fmt)', category: 'time' },
    { name: 'time', description: '时间格式化 time(fmt)', category: 'time' },
    { name: 'now', description: 'ISO 时间字符串', category: 'time' },
    { name: 'nowPlus', description: '当前时间+N天 nowPlus(days)', category: 'time' },
    { name: 'base64', description: 'Base64 编码 base64(str)', category: 'encode' },
    { name: 'md5', description: 'MD5 哈希 md5(str)', category: 'encode' },
    { name: 'sha256', description: 'SHA-256 哈希 sha256(str)', category: 'encode' },
    { name: 'substring', description: '字符串截取 substr(str,start,end)', category: 'string' },
    { name: 'concat', description: '字符串拼接 concat(a,b,...)', category: 'string' },
    { name: 'replace', description: '字符串替换 replace(str,from,to)', category: 'string' },
    { name: 'json', description: '对象转 JSON json(obj)', category: 'string' },
    { name: 'if', description: '条件选择 if(cond,t,f)', category: 'logic' },
    { name: 'eq', description: '等于判断 eq(a,b)', category: 'logic' },
  ];

  const getDisplayFunctions = () => {
    const source = sysFunctions.length > 0 ? sysFunctions : builtInFunctions;
    if (!searchTerm) return source;
    const q = searchTerm.toLowerCase();
    return source.filter(f =>
      (f.name || '').toLowerCase().includes(q) ||
      (f.description || '').toLowerCase().includes(q)
    );
  };

  // 加载系统函数列表
  React.useEffect(() => {
    (async () => {
      try {
        const funcs = await window.appApi.listFunctions();
        if (Array.isArray(funcs)) setSysFunctions(funcs);
      } catch {}
    })();
  }, []);

  // 解析上下文环境变量 / seq响应值 / data行数据
  React.useEffect(() => {
    if (!context) return;
    const env = context.envConfig || {};
    const envList = [];
    Object.keys(env).forEach(k => {
      if (typeof env[k] !== 'object') envList.push({ name: k, value: String(env[k]) });
    });
    setEnvVars(envList);

    const seqResponses = context.seqResponses || context.linkedRecords || [];
    const seqList = [];
    (Array.isArray(seqResponses) ? seqResponses : []).forEach(rec => {
      const seq = rec.seq;
      const response = rec.response;
      if (response && response.body) {
        const body = typeof response.body === 'object' ? response.body : {};
        Object.keys(body).forEach(k => {
          const v = body[k];
          if (typeof v !== 'object' && v !== null) {
            seqList.push({ seq, path: k, value: String(v) });
          }
        });
      }
    });
    setSeqVars(seqList);

    // data 变量: 优先从 context.dataPoolName 获取池名
    const dataRow = context.dataRow || {};
    const poolName = context.dataPoolName || context.selectedPoolName || '当前池';
    setDataPoolName(poolName);
    const dataList = [];
    Object.keys(dataRow).forEach(k => {
      const v = dataRow[k];
      if (v !== null && v !== undefined) {
        dataList.push({ name: k, value: String(v), poolName });
      }
    });
    setDataVars(dataList);
  }, [context]);

  // 点击外部关闭下拉
  React.useEffect(() => {
    if (mode !== 'dropdown') return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mode]);

  const toggleNs = (key) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelect = (varExpr) => {
    if (onSelect) onSelect(varExpr);
    if (mode === 'dropdown') setDropdownOpen(false);
  };

  const getFilteredFunctions = () => {
    if (!searchTerm) return sysFunctions;
    const q = searchTerm.toLowerCase();
    return sysFunctions.filter(f =>
      (f.name || '').toLowerCase().includes(q) ||
      (f.description || '').toLowerCase().includes(q)
    );
  };

  // 渲染单个命名空间的变量列表
  const renderNsVars = (nsKey) => {
    const open = expanded[nsKey];

    switch (nsKey) {
      case 'env':
        return React.createElement('div', { key: 'env-body', style: { padding: '2px 0' } },
          !open
            ? React.createElement('span', { style: { fontSize: 11, color: 'var(--text-secondary)', padding: '0 8px' } }, `${envVars.length} 个变量`)
            : envVars.length === 0
              ? React.createElement('div', { style: { padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)' } }, '暂无环境变量')
              : envVars.map(v =>
                  React.createElement('div', {
                    key: v.name,
                    style: nsVarItemStyle,
                    onMouseEnter: e => e.currentTarget.style.background = 'var(--bg-secondary)',
                    onMouseLeave: e => e.currentTarget.style.background = 'transparent',
                    onClick: () => handleSelect(`\${env.${v.name}}`),
                    title: `点击插入 \${env.${v.name}}`,
                  }, [
                    React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 11, flex: 1 } }, `\${env.${v.name}}`),
                    React.createElement('span', { style: { fontSize: 10, color: 'var(--text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 8 } }, v.value),
                  ])
              )
        );

      case 'seq':
        return React.createElement('div', { key: 'seq-body', style: { padding: '2px 0' } },
          !open
            ? React.createElement('span', { style: { fontSize: 11, color: 'var(--text-secondary)', padding: '0 8px' } }, `${seqVars.length} 个变量`)
            : seqVars.length === 0
              ? React.createElement('div', { style: { padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)' } }, '暂无响应值（需先完成管道处理）')
              : seqVars.map(v =>
                  React.createElement('div', {
                    key: `${v.seq}_${v.path}`,
                    style: nsVarItemStyle,
                    onMouseEnter: e => e.currentTarget.style.background = 'var(--bg-secondary)',
                    onMouseLeave: e => e.currentTarget.style.background = 'transparent',
                    onClick: () => handleSelect(`\${seq.${v.seq}.${v.path}}`),
                    title: `点击插入 \${seq.${v.seq}.${v.path}}`,
                  }, [
                    React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 11, flex: 1 } }, `\${seq.${v.seq}.${v.path}}`),
                    React.createElement('span', { style: { fontSize: 10, color: 'var(--text-secondary)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 8 } }, v.value),
                  ])
              )
        );

      case 'data':
        return React.createElement('div', { key: 'data-body', style: { padding: '2px 0' } },
          !open
            ? React.createElement('span', { style: { fontSize: 11, color: 'var(--text-secondary)', padding: '0 8px' } }, `${dataVars.length} 个变量`)
            : dataVars.length === 0
              ? React.createElement('div', { style: { padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)' } }, '暂无数据行变量（需绑定数据池）')
              : dataVars.map(v =>
                  React.createElement('div', {
                    key: v.name,
                    style: nsVarItemStyle,
                    onMouseEnter: e => e.currentTarget.style.background = 'var(--bg-secondary)',
                    onMouseLeave: e => e.currentTarget.style.background = 'transparent',
                    onClick: () => handleSelect(`\${data.${v.poolName || dataPoolName}.${v.name}}`),
                    title: `点击插入 \${data.${v.poolName || dataPoolName}.${v.name}}`,
                  }, [
                    React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 11, flex: 1 } }, `\${data.${v.poolName || dataPoolName}.${v.name}}`),
                    React.createElement('span', { style: { fontSize: 10, color: 'var(--text-secondary)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 8 } }, v.value),
                  ])
              )
        );

      case 'ctx':
        return React.createElement('div', { key: 'ctx-body', style: { padding: '2px 0' } },
          React.createElement('div', { style: { padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)' } },
            '上下文变量在管道运行过程中动态生成。'),
          React.createElement('div', { style: { padding: '2px 8px' } }, [
            React.createElement('div', { style: { ...nsVarItemStyle, fontFamily: 'monospace', fontSize: 11 },
              onClick: () => handleSelect('\${ctx.customVar}'),
            }, '\${ctx.customVar}'),
            React.createElement('div', { style: { ...nsVarItemStyle, fontFamily: 'monospace', fontSize: 11 },
              onClick: () => handleSelect('\${ctx.loopIndex}'),
            }, '\${ctx.loopIndex}  \u2014 循环索引'),
            React.createElement('div', { style: { ...nsVarItemStyle, fontFamily: 'monospace', fontSize: 11 },
              onClick: () => handleSelect('\${ctx.totalRows}'),
            }, '\${ctx.totalRows} \u2014 总行数'),
          ])
        );

      case 'sys':
        return React.createElement('div', { key: 'sys-body', style: { padding: '2px 0' } },
          React.createElement('div', { style: { padding: '4px 8px' } },
            React.createElement('input', {
              style: { width: '100%', padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' },
              placeholder: '\uD83D\uDD0D 搜索函数...',
              value: searchTerm,
              onChange: e => setSearchTerm(e.target.value),
            })
          ),
          !open
            ? React.createElement('span', { style: { padding: '0 8px', fontSize: 11, color: 'var(--text-secondary)' } }, `${getDisplayFunctions().length} 个函数`)
            : getDisplayFunctions().length === 0
              ? React.createElement('div', { style: { padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)' } }, '无匹配函数')
              : getDisplayFunctions().map(f =>
                  React.createElement('div', {
                    key: f.name,
                    style: nsVarItemStyle,
                    onMouseEnter: e => e.currentTarget.style.background = 'var(--bg-secondary)',
                    onMouseLeave: e => e.currentTarget.style.background = 'transparent',
                    onClick: () => handleSelect(`\${sys.${f.name}()}`),
                    title: f.description || `\${sys.${f.name}()}`,
                  }, [
                    React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 11, flex: 1 } }, `\${sys.${f.name}()}`),
                    f.description && React.createElement('span', { style: { fontSize: 10, color: 'var(--text-secondary)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 8 } }, f.description),
                  ])
              )
        );

      default:
        return null;
    }
  };

  const nsVarItemStyle = {
    padding: '5px 8px',
    cursor: 'pointer',
    borderRadius: 4,
    fontSize: 12,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    transition: 'background 0.1s',
  };

  // ========== DROPDOWN 模式 ==========
  if (mode === 'dropdown') {
    return React.createElement('div', {
      ref: dropdownRef,
      style: { position: 'relative', display: 'inline-block' },
    }, [
      // 触发按钮
      React.createElement('button', {
        key: 'btn',
        className: 'btn btn-sm',
        style: {
          ...buttonStyle,
          padding: '6px 12px',
          fontSize: 12,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          cursor: 'pointer',
          color: 'var(--text)',
          transition: 'all 0.15s',
        },
        onClick: () => setDropdownOpen(!dropdownOpen),
        onMouseEnter: e => e.currentTarget.style.borderColor = 'var(--primary)',
        onMouseLeave: e => e.currentTarget.style.borderColor = 'var(--border)',
      }, [
        React.createElement('span', { style: { fontSize: 14 } }, '\u2190\uFE0F'),
        React.createElement('span', { style: { marginLeft: 2 } }, label),
        React.createElement('span', { style: { marginLeft: 4, fontSize: 10, color: 'var(--text-secondary)' } }, dropdownOpen ? '\u25B2' : '\u25BC'),
      ]),
      // 下拉面板
      dropdownOpen && React.createElement('div', {
        key: 'panel',
        style: {
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 4,
          minWidth: 320,
          maxWidth: 420,
          maxHeight: 480,
          overflowY: 'auto',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          zIndex: 2000,
          padding: '8px 0',
        },
      },
        namespaces.map(ns => {
          const count = ns.key === 'env' ? envVars.length
            : ns.key === 'seq' ? seqVars.length
            : ns.key === 'data' ? dataVars.length
            : ns.key === 'sys' ? getDisplayFunctions().length
            : 0;
          const isExpanded = expanded[ns.key];

          return React.createElement('div', {
            key: ns.key,
            style: { borderLeft: `3px solid ${ns.color}`, marginBottom: 4 },
          }, [
            // 命名空间头部
            React.createElement('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                cursor: 'pointer',
                userSelect: 'none',
                borderRadius: '0 4px 4px 0',
              },
              onClick: () => toggleNs(ns.key),
              onMouseEnter: e => e.currentTarget.style.background = 'var(--bg-secondary)',
              onMouseLeave: e => e.currentTarget.style.background = 'transparent',
            }, [
              React.createElement('span', { style: { fontSize: 14 } }, ns.emoji),
              React.createElement('span', { style: { fontWeight: 600, fontSize: 12, color: ns.color } }, ns.label),
              React.createElement('span', {
                style: {
                  marginLeft: 4,
                  padding: '0 6px',
                  fontSize: 10,
                  borderRadius: 8,
                  background: ns.bg,
                  color: ns.color,
                  fontWeight: 600,
                },
              }, count),
              React.createElement('span', { style: { marginLeft: 'auto', fontSize: 10, color: 'var(--text-secondary)' } },
                isExpanded ? '\u25B2' : '\u25BC'),
            ]),
            // 变量列表
            isExpanded && renderNsVars(ns.key),
          ]);
        })
      ),
    ]);
  }

  // ========== CARD 模式（原有） ==========
  const cardStyle = compact
    ? { marginBottom: 8, fontSize: 12 }
    : { marginBottom: 12 };

  return React.createElement('div', { className: 'variable-selector', style: { fontSize: 13 } },
    namespaces.map(ns => {
      const count = ns.key === 'env' ? envVars.length
        : ns.key === 'seq' ? seqVars.length
        : ns.key === 'data' ? dataVars.length
        : ns.key === 'sys' ? getDisplayFunctions().length
        : 0;

      return React.createElement('div', {
        key: ns.key,
        className: 'card',
        style: { ...cardStyle, borderLeft: `3px solid ${ns.color}` },
      }, [
        React.createElement('div', {
          className: 'card-header',
          style: { cursor: 'pointer', padding: '6px 12px' },
          onClick: () => toggleNs(ns.key),
        }, [
          React.createElement('div', { className: 'card-title', style: { fontSize: 13, color: ns.color, display: 'flex', alignItems: 'center', gap: 6 } }, [
            React.createElement('span', { style: { fontSize: 14 } }, ns.emoji),
            ns.label,
            React.createElement('span', {
              className: 'tag tag-sm',
              style: { marginLeft: 4, background: ns.bg, color: ns.color, fontSize: 10 },
            }, count),
          ]),
          React.createElement('span', { style: { color: 'var(--text-secondary)', fontSize: 11 } },
            expanded[ns.key] ? '收起 \u25B2' : '展开 \u25BC'),
        ]),
        expanded[ns.key] && renderNsVars(ns.key),
      ]);
    })
  );
};