// EnvForm.jsx - Modern Environment Configuration Form
const EnvForm = ({ envConfig, onSave, onClose }) => {
  const [form, setForm] = React.useState(envConfig || {
    name: '', baseURL: '', authType: 'none',
    authConfig: { tokenPath: '', loginEndpoint: '', globalHeaders: {} },
    globalHeaders: {}, variables: {}, envType: 1,
    cookies: [], // [{key: '', value: ''}]
    // 扩展字段
    variablesDefinition: [], // [{name, value, description}]
    linkedDataPoolIds: [],
    iterationMode: 'none',
  });

  // 将 cookies 数组转为 Cookie 请求头值
  const cookiesToHeader = (cookies) => {
    if (!cookies || !Array.isArray(cookies)) return '';
    return cookies.filter(c => c.key && c.key.trim())
      .map(c => c.key.trim() + '=' + (c.value || '').trim())
      .join('; ');
  };

  // 解析 Cookie 请求头值回数组
  const headerToCookies = (headerVal) => {
    if (!headerVal) return [];
    return headerVal.split(';').map(pair => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) return { key: pair.slice(0, eqIdx).trim(), value: pair.slice(eqIdx + 1).trim() };
      return { key: pair.trim(), value: '' };
    }).filter(c => c.key);
  };

  // 初始化时从 globalHeaders 解析 Cookie
  React.useEffect(() => {
    const existingHdrs = (envConfig && typeof envConfig.globalHeaders === 'object')
      ? envConfig.globalHeaders : {};
    const cookieHeader = existingHdrs['Cookie'] || existingHdrs['cookie'] || '';
    if (cookieHeader && (!form.cookies || form.cookies.length === 0)) {
      setForm(prev => ({ ...prev, cookies: headerToCookies(cookieHeader) }));
    }
  }, []);

  // 从 variables 对象初始化 variablesDefinition（向后兼容）
  React.useEffect(() => {
    if (envConfig) {
      const varsDef = envConfig.variablesDefinition || [];
      const vars = envConfig.variables || {};
      // 如果 variablesDefinition 为空但 variables 有数据，则转换
      if (varsDef.length === 0 && Object.keys(vars).length > 0) {
        const converted = Object.entries(vars).map(([name, value]) => ({
          name,
          value: String(value ?? ''),
          description: '',
        }));
        setForm(prev => ({ ...prev, variablesDefinition: converted }));
      }
    }
  }, [envConfig]);

  const updateField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const updateAuthConfig = (key, value) =>
    setForm(prev => ({ ...prev, authConfig: { ...prev.authConfig, [key]: value } }));

  const [availablePools, setAvailablePools] = React.useState([]);

  React.useEffect(() => {
    (async () => {
      try {
        const pools = await window.appApi.dataPoolList();
        if (Array.isArray(pools)) setAvailablePools(pools);
      } catch {}
    })();
  }, []);

  // 变量定义操作
  const addVariableDef = () => {
    setForm(prev => ({
      ...prev,
      variablesDefinition: [...(prev.variablesDefinition || []), { name: '', value: '', description: '' }],
    }));
  };
  const removeVariableDef = (idx) => {
    setForm(prev => ({
      ...prev,
      variablesDefinition: (prev.variablesDefinition || []).filter((_, i) => i !== idx),
    }));
  };
  const updateVariableDef = (idx, key, val) => {
    setForm(prev => {
      const list = [...(prev.variablesDefinition || [])];
      if (!list[idx]) return prev;
      list[idx] = { ...list[idx], [key]: val };
      return { ...prev, variablesDefinition: list };
    });
  };

  // 数据池绑定操作
  // (使用 dropdown 多选，无需 toggle 函数)

  const handleSave = () => {
    // 将 cookies 数组同步到 globalHeaders
    const updatedForm = { ...form };
    let cookieVal = cookiesToHeader(form.cookies);
    // 防御：如果 cookieVal 以 "Cookie=" 开头（用户误操作导致），剥离前缀
    if (cookieVal && cookieVal.toUpperCase().startsWith('COOKIE=')) {
      cookieVal = cookieVal.substring('COOKIE='.length);
    }
    const globalHdrs = { ...(typeof form.globalHeaders === 'object' ? form.globalHeaders : {}) };
    if (cookieVal) {
      globalHdrs['Cookie'] = cookieVal;
    } else {
      delete globalHdrs['Cookie'];
    }
    updatedForm.globalHeaders = globalHdrs;

    // 同步 variablesDefinition → variables 对象
    const varsObj = {};
    (form.variablesDefinition || []).forEach(vd => {
      if (vd.name && vd.name.trim()) {
        varsObj[vd.name.trim()] = vd.value ?? '';
      }
    });
    updatedForm.variables = Object.keys(varsObj).length > 0 ? varsObj : {};

    onSave && onSave(updatedForm);
  };

  const addCookie = () => {
    setForm(prev => ({ ...prev, cookies: [...(prev.cookies || []), { key: '', value: '' }] }));
  };
  const removeCookie = (idx) => {
    setForm(prev => ({ ...prev, cookies: (prev.cookies || []).filter((_, i) => i !== idx) }));
  };
  const updateCookie = (idx, field, val) => {
    setForm(prev => {
      const cookies = [...(prev.cookies || [])];
      if (!cookies[idx]) return prev;
      cookies[idx] = { ...cookies[idx], [field]: val };
      return { ...prev, cookies };
    });
  };

  return React.createElement('div', { className: 'card' }, [
    React.createElement('div', { className: 'card-header', key: 'h' },
      React.createElement('div', { className: 'card-title', key: 't' }, '🛠 环境配置'),
    ),
    React.createElement('div', { key: 'body' }, [
      React.createElement('div', { className: 'form-row', key: 'row1' }, [
        React.createElement('div', { className: 'form-group', key: 'name' },
          React.createElement('label', null, '环境名称'),
          React.createElement('input', {
            value: form.name,
            onChange: e => updateField('name', e.target.value),
            placeholder: '如: TEST 环境',
          }),
        ),
        React.createElement('div', { className: 'form-group', key: 'type' },
          React.createElement('label', null, '环境类型'),
          React.createElement('select', {
            value: form.envType,
            onChange: e => updateField('envType', parseInt(e.target.value)),
          }, [
            React.createElement('option', { value: 0, key: 0 }, '开发环境 (DEV)'),
            React.createElement('option', { value: 1, key: 1 }, '测试环境 (TEST)'),
            React.createElement('option', { value: 2, key: 2 }, '预发布 (PRE)'),
            React.createElement('option', { value: 3, key: 3 }, '生产 (PROD)'),
          ]),
        ),
      ]),
      React.createElement('div', { className: 'form-group', key: 'url' },
        React.createElement('label', null, '基础 URL (baseURL)'),
        React.createElement('input', {
          value: form.baseURL,
          onChange: e => updateField('baseURL', e.target.value),
          placeholder: 'https://api.example.com',
          style: { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', minHeight: 36, boxSizing: 'border-box' },
        }),
      ),
      React.createElement('div', { className: 'form-group', key: 'auth' },
        React.createElement('label', null, '认证方式'),
        React.createElement('select', {
          value: form.authType,
          onChange: e => updateField('authType', e.target.value),
        }, [
          React.createElement('option', { value: 'none', key: 'none' }, '无认证'),
          React.createElement('option', { value: 'token', key: 'token' }, 'Token'),
          React.createElement('option', { value: 'cookie', key: 'cookie' }, 'Cookie'),
          React.createElement('option', { value: 'basic', key: 'basic' }, 'Basic Auth'),
        ]),
      ),
      form.authType === 'token' &&
        React.createElement('div', { className: 'form-row', key: 'token' }, [
          React.createElement('div', { className: 'form-group', key: 'tp' },
            React.createElement('label', null, 'Token 在响应中的路径'),
            React.createElement('input', {
              value: form.authConfig.tokenPath,
              onChange: e => updateAuthConfig('tokenPath', e.target.value),
              placeholder: 'data.token',
              style: { width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', minHeight: 32, boxSizing: 'border-box' },
            }),
          ),
          React.createElement('div', { className: 'form-group', key: 'le' },
            React.createElement('label', null, '登录接口路径'),
            React.createElement('input', {
              value: form.authConfig.loginEndpoint,
              onChange: e => updateAuthConfig('loginEndpoint', e.target.value),
              placeholder: '/api/login',
            }),
          ),
        ]),
      // 全局 Cookie 配置
      React.createElement('div', { className: 'card', key: 'cookies', style: { marginTop: 16, padding: 12, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' } }, [
        React.createElement('div', { className: 'card-title', key: 'title', style: { fontSize: 13, fontWeight: 600, marginBottom: 10 } }, '🍪 全局 Cookie'),
        React.createElement('div', { key: 'hint', style: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 } },
          '全局 Cookie 将自动添加到每个请求的 Cookie 请求头中。支持变量引用如 ',
          React.createElement('code', { style: { fontSize: 10 } }, '${env.baseURL}'),
          ' 或 ',
          React.createElement('code', { style: { fontSize: 10 } }, '${seq.0.data.token}'),
          '。',
        ),
        (form.cookies || []).map((ck, i) =>
          React.createElement('div', { key: i, style: { display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' } }, [
            React.createElement('input', {
              value: ck.key,
              onChange: e => updateCookie(i, 'key', e.target.value),
              placeholder: 'Cookie 名称',
              style: { flex: 1, minWidth: 80 },
            }),
            React.createElement('span', { style: { color: 'var(--text-secondary)', fontSize: 16 } }, '='),
            React.createElement('input', {
              value: ck.value,
              onChange: e => updateCookie(i, 'value', e.target.value),
              placeholder: '值',
              style: { flex: 1, minWidth: 120 },
            }),
            React.createElement('button', {
              className: 'btn btn-sm btn-danger',
              onClick: () => removeCookie(i),
              style: { padding: '4px 8px', fontSize: 12, lineHeight: 1 },
            }, '✕'),
          ])
        ),
        React.createElement('button', {
          className: 'btn btn-sm',
          onClick: addCookie,
          style: { marginTop: 6, fontSize: 12 },
        }, '+ 添加 Cookie'),
      ]),

     // 全局请求头配置
      React.createElement('div', { className: 'form-group', key: 'gheaders' },
        React.createElement('label', null, '全局请求头 (JSON)'),
        React.createElement('textarea', {
          value: typeof form.globalHeaders === 'object' ? JSON.stringify(form.globalHeaders, null, 2) : (form.globalHeaders || ''),
          onChange: e => {
            try { updateField('globalHeaders', JSON.parse(e.target.value)); }
            catch { updateField('globalHeaders', e.target.value); }
          },
          style: { width: '100%', minHeight: 60, padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' },
          placeholder: '{\n  "X-Requested-By": "QM-Testing",\n  "Accept-Language": "zh-CN"\n}',
        }),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 } },
          '全局请求头将自动添加到每个接口的请求中。支持变量引用：',
          React.createElement('code', { style: { fontSize: 10 } }, '\${env.baseURL}'),
          '(环境变量引用), ',
          React.createElement('code', { style: { fontSize: 10 } }, '\${seq.path}'),
          '(响应值引用)。'),
      ),
     
      // 变量定义区域
      React.createElement('div', { className: 'card', key: 'vardefs', style: { marginTop: 16, padding: 12, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' } }, [
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
          React.createElement('div', { className: 'card-title', style: { fontSize: 13, fontWeight: 600 } }, '📋 变量定义'),
          React.createElement('button', { className: 'btn btn-sm', onClick: addVariableDef }, '+ 添加变量'),
        ),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 } },
          '定义环境级变量，可在请求头、URL、Body 中以 ',
          React.createElement('code', { style: { fontSize: 10 } }, '\${env.xxx}'),
          ' 格式引用。'),
        (form.variablesDefinition || []).length === 0
          ? React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', padding: '8px 0' } }, '暂无变量定义') :
          (form.variablesDefinition || []).map((vd, i) =>
            React.createElement('div', { key: i, style: { display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' } }, [
              React.createElement('input', {
                value: vd.name, placeholder: '变量名',
                onChange: e => updateVariableDef(i, 'name', e.target.value),
                style: { flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', minHeight: 32, boxSizing: 'border-box' },
              }),
              React.createElement(VariableSelector, {
                mode: 'dropdown', label: '值 ▼',
                onSelect: (varExpr) => {
                  updateVariableDef(i, 'value', (vd.value || '') + varExpr);
                },
                context: { envConfig: form },
                buttonStyle: { padding: '2px 6px', fontSize: 10, whiteSpace: 'nowrap', height: 70, display: 'flex', alignItems: 'center' },
              }),
              React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 } }, [
                React.createElement('textarea', {
                  value: vd.value, placeholder: '多个值请换行输入\n如:\n00001\n00002\n00003',
                  onChange: e => updateVariableDef(i, 'value', e.target.value),
                  style: { width: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', minHeight: 68, resize: 'vertical', fontFamily: 'monospace', boxSizing: 'border-box' },
                  rows: 3,
                }),
                vd.value && vd.value.includes('\n') && React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                  vd.value.split('\n').filter(Boolean).map((val, vi) =>
                    React.createElement('span', {
                      key: vi, className: 'tag tag-sm tag-info',
                      style: { fontSize: 10, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                      title: val,
                    }, val)
                  )
                ),
              ]),
              React.createElement('input', {
                value: vd.description || '', placeholder: '描述（可选）',
                onChange: e => updateVariableDef(i, 'description', e.target.value),
                style: { flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', minHeight: 32, boxSizing: 'border-box' },
              }),
              React.createElement('button', {
                className: 'btn btn-sm btn-danger',
                onClick: () => removeVariableDef(i),
                style: { padding: '2px 6px', fontSize: 11, minHeight: 32 },
              }, 'X'),
            ])
          ),
      ]),
     
      // 数据池绑定（下拉选择器）
      React.createElement('div', { className: 'card', key: 'datapool-bind', style: { marginTop: 12, padding: 12, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' } }, [
        React.createElement('div', { className: 'card-title', style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, '🔗 数据池绑定'),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 } },
          '选择与此环境关联的数据池（按住 Ctrl 多选），运行时将自动加载对应数据。'),
        availablePools.length === 0
          ? React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)' } }, '暂无可用数据池，请先在"测试数据管理"中创建。')
          : React.createElement('select', {
            multiple: true,
            value: form.linkedDataPoolIds || [],
            onChange: e => {
              const selected = Array.from(e.target.options)
                .filter(o => o.selected)
                .map(o => o.value);
              updateField('linkedDataPoolIds', selected);
            },
            style: { width: '100%', minHeight: 80, padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--bg)', color: 'var(--text)' },
          }, [
            React.createElement('option', { key: '', value: '', disabled: true }, '选择数据池...'),
            ...availablePools.map(p =>
              React.createElement('option', {
                key: p.id,
                value: p.id,
                style: { padding: 4 },
              }, `${p.name || '未命名'} (${p.fieldCount || 0}字段, ${p.rowCount || 0}行)`)
            ),
          ]),
        (form.linkedDataPoolIds || []).length > 0 &&
          React.createElement('div', { style: { marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 } },
            (form.linkedDataPoolIds || []).map(id => {
              const pool = availablePools.find(p => p.id === id);
              return React.createElement('span', {
                key: id,
                className: 'tag tag-info tag-sm',
                style: { fontSize: 10 },
              }, `${pool ? pool.name : id}`);
            })
          ),
      ]),
     
      // 高级设置
      React.createElement('div', { className: 'card', key: 'advanced', style: { marginTop: 12, padding: 12, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' } }, [
        React.createElement('div', { className: 'card-title', style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, '⚙️ 高级'),
        React.createElement('div', { className: 'form-group', key: 'iter' },
          React.createElement('label', null, '迭代模式'),
          React.createElement('select', {
            value: form.iterationMode || 'none',
            onChange: e => updateField('iterationMode', e.target.value),
            style: { width: '100%' },
          }, [
            React.createElement('option', { value: 'none' }, '不启用'),
            React.createElement('option', { value: 'expand' }, '展开模式 — 每行生成独立用例'),
            React.createElement('option', { value: 'loop' }, '循环模式 — 单用例循环取数'),
          ]),
        ),
      ]),
     
      React.createElement('div', {
        style: { display: 'flex', gap: 12, marginTop: 20 },
        key: 'actions',
      }, [
        React.createElement('button', {
          className: 'btn btn-primary',
          onClick: handleSave,
          key: 'save',
        }, '✓ 保存配置'),
        onClose &&
          React.createElement('button', {
            className: 'btn',
            onClick: onClose,
            key: 'cancel',
          }, '取消'),
      ]),
    ]),
  ]);
};
