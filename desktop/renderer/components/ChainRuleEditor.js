// ChainRuleEditor.js - 串联规则编辑器组件
// 可视化选择来源接口→选择响应字段→选择目标接口→选择目标位置
// TransformDef 配置面板 (none/jsonpath/regex/template/function)
// 含预览值显示和测试提取按钮 (Section 4.3 设计)
const ChainRuleEditor = ({ records, chainRules, onSave, onClose }) => {
  const [rules, setRules] = React.useState(chainRules || []);
  const [showAdd, setShowAdd] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [previewResults, setPreviewResults] = React.useState({});
  const [testingExtract, setTestingExtract] = React.useState({});
  const [newRule, setNewRule] = React.useState({
    name: '',
    sourceApiSeq: '',
    sourcePath: '',
    targetApiSeq: '',
    targetLocation: 'requestHeaders.',
    transform: { type: 'none', expression: '', params: {} },
    enabled: true,
  });

  const transformTypes = [
    { value: 'none', label: '直接传递' },
    { value: 'jsonpath', label: 'JSONPath 提取' },
    { value: 'regex', label: '正则提取' },
    { value: 'template', label: '模板拼接' },
    { value: 'function', label: '自定义函数' },
  ];

  const targetLocations = [
    { value: 'url', label: 'URL 参数' },
    { value: 'requestHeaders.', label: '请求头' },
    { value: 'requestBody.', label: '请求体' },
    { value: 'assert.N.expectValue', label: '断言预期值' },
    { value: 'assert.N.expression', label: '断言表达式' },
  ];

  // 从选中 source API 的响应体自动提取字段列表
  const getResponseFields = (seq) => {
    const record = (records || []).find(r => r.seq === parseInt(seq));
    if (!record || !record.response) return [];
    const body = typeof record.response.body === 'object' ? record.response.body : {};
    const fields = [];
    const walk = (obj, prefix) => {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(k => {
        const path = prefix ? `${prefix}.${k}` : k;
        const v = obj[k];
        if (v !== null && typeof v !== 'object') {
          fields.push({ path, value: String(v).slice(0, 60) });
        } else {
          fields.push({ path, value: typeof v });
          walk(v, path);
        }
      });
    };
    walk(body, 'responseBody');
    return fields;
  };

  const addRule = () => {
    if (!newRule.name || !newRule.sourceApiSeq || !newRule.targetApiSeq) {
      window.appApi.showToast('请填写完整规则信息', 'warning');
      return;
    }
    const rule = {
      ...newRule,
      id: 'CR_' + Date.now(),
      sourceApiSeq: parseInt(newRule.sourceApiSeq, 10),
      targetApiSeq: parseInt(newRule.targetApiSeq, 10),
    };
    setRules(prev => [...prev, rule]);
    setShowAdd(false);
    resetNewRule();
  };

  const resetNewRule = () => {
    setNewRule({
      name: '', sourceApiSeq: '', sourcePath: '', targetApiSeq: '',
      targetLocation: 'requestHeaders.',
      transform: { type: 'none', expression: '', params: {} },
      enabled: true,
    });
  };

  const removeRule = (idx) => {
    setRules(prev => prev.filter((_, i) => i !== idx));
  };

  const toggleRule = (idx) => {
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, enabled: !r.enabled } : r));
  };

  const updateRule = (idx, key, value) => {
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, [key]: value } : r));
  };

  const updateTransform = (idx, key, value) => {
    setRules(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      return { ...r, transform: { ...r.transform, [key]: value } };
    }));
  };

  const handleSave = () => {
    if (onSave) onSave(rules);
  };

  const handleEditStart = (idx) => {
    setEditing(idx);
  };

  const handleEditDone = () => {
    setEditing(null);
  };

  // 模拟预览值生成
  const generatePreviewValue = (rule) => {
    const srcRecord = recordMap[rule.sourceApiSeq];
    if (!srcRecord || !srcRecord.response) return '（无源响应数据）';
    const body = srcRecord.response.body;
    let rawValue;
    if (rule.sourcePath) {
      const parts = rule.sourcePath.replace(/^responseBody\.?/, '').split('.');
      rawValue = parts.reduce((acc, p) => (acc && typeof acc === 'object' ? acc[p] : undefined), body);
    } else {
      rawValue = body;
    }
    if (rawValue === undefined || rawValue === null) return '（字段不存在）';
    const strVal = String(rawValue);
    const tfType = (rule.transform || {}).type;
    const tfExpr = (rule.transform || {}).expression || '';
    if (tfType === 'none' || !tfType) return strVal.slice(0, 50);
    if (tfType === 'template') return tfExpr.replace('${value}', strVal).slice(0, 60);
    if (tfType === 'jsonpath') return `JSONPath: ${tfExpr}`;
    return strVal.slice(0, 50);
  };

  // 测试提取（模拟）
  const handleTestExtract = (rule) => {
    const value = generatePreviewValue(rule);
    setPreviewResults(prev => ({ ...prev, [rule.id || 'new']: value }));
    window.appApi.showToast('提取完成: ' + value, 'info');
  };

  // Create a record map for quick lookup
  const recordMap = {};
  (records || []).forEach(r => { recordMap[r.seq] = r; });

  const fieldInputStyle = { width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' };
  const selectStyle = { ...fieldInputStyle };

  return React.createElement('div', { className: 'chain-rule-editor' }, [
    // Header
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
      key: 'h',
    }, [
      React.createElement('div', { style: { fontWeight: 600, fontSize: 14 } }, [
        '串联规则 (',
        React.createElement('span', { key: 'count' }, rules.length),
        ')',
      ]),
      React.createElement('div', { style: { display: 'flex', gap: 6 } }, [
        React.createElement('button', {
          className: 'btn btn-sm',
          style: { fontSize: 11 },
          onClick: () => { if (onSave) onSave(rules); window.appApi.showToast('已重新关联', 'success'); },
        }, '自动关联'),
        React.createElement('button', {
          className: 'btn btn-primary btn-sm',
          onClick: () => setShowAdd(!showAdd),
        }, showAdd ? '取消' : '+ 添加规则'),
      ]),
    ]),

    // Add rule form
    showAdd && React.createElement('div', {
      className: 'card',
      key: 'add-form',
      style: { padding: 16, marginBottom: 12, border: '1px solid var(--primary)', borderRadius: 8 },
    }, [
      React.createElement('h5', { style: { fontSize: 13, marginBottom: 12 } }, '新建串联规则'),
      // Rule name
      React.createElement('div', { className: 'form-group', style: { marginBottom: 10 } },
        React.createElement('label', null, '规则名称'),
        React.createElement('input', {
          value: newRule.name, placeholder: '如: 登录Token传递到后续接口',
          onChange: e => setNewRule({ ...newRule, name: e.target.value }),
          style: { width: '100%' },
        }),
      ),

      // Source API - with dropdown for both seq and path
      React.createElement('div', { className: 'form-row', style: { gap: 12, marginBottom: 10 } }, [
        React.createElement('div', { className: 'form-group', key: 'src-seq', style: { flex: 1 } },
          React.createElement('label', null, '来源接口 (Seq)'),
          React.createElement('select', {
            value: newRule.sourceApiSeq,
            onChange: e => {
              setNewRule({ ...newRule, sourceApiSeq: e.target.value, sourcePath: '' });
            },
            style: { width: '100%' },
          }, [
            React.createElement('option', { value: '', key: '' }, '选择来源接口...'),
            ...(records || []).map(r =>
              React.createElement('option', { key: r.seq, value: String(r.seq) },
                `Seq ${r.seq}: ${r.method || ''} ${(r.path || r.name || '').slice(0, 40)}`)
            ),
          ]),
        ),
        React.createElement('div', { className: 'form-group', key: 'src-path', style: { flex: 2 } },
          React.createElement('label', null, '来源响应字段路径'),
          newRule.sourceApiSeq
            ? React.createElement('select', {
                value: newRule.sourcePath,
                onChange: e => setNewRule({ ...newRule, sourcePath: e.target.value }),
                style: { width: '100%', fontFamily: 'monospace', fontSize: 12 },
              }, [
                React.createElement('option', { value: '', key: '' }, '选择字段...'),
                ...getResponseFields(newRule.sourceApiSeq).map(f =>
                  React.createElement('option', { key: f.path, value: f.path },
                    `${f.path}  (${f.value})`)
                ),
                React.createElement('option', { value: '__custom__', key: '__custom__' }, '✏️ 手动输入...'),
              ])
            : React.createElement('input', {
                value: newRule.sourcePath,
                placeholder: '先选择来源接口，或手动输入路径',
                onChange: e => setNewRule({ ...newRule, sourcePath: e.target.value }),
                style: { width: '100%' },
              }),
          // 如果选择"手动输入"，显示输入框
          newRule.sourcePath === '__custom__' &&
            React.createElement('input', {
              value: '',
              placeholder: '输入自定义路径 (如 responseBody.data.token)',
              onChange: e => setNewRule({ ...newRule, sourcePath: e.target.value }),
              style: { width: '100%', marginTop: 4, padding: '4px 8px', fontSize: 12, fontFamily: 'monospace' },
            }),
        ),
      ]),

      // Target API
      React.createElement('div', { className: 'form-row', style: { gap: 12, marginBottom: 10 } }, [
        React.createElement('div', { className: 'form-group', key: 'tgt-seq', style: { flex: 1 } },
          React.createElement('label', null, '目标接口 (Seq)'),
          React.createElement('select', {
            value: newRule.targetApiSeq,
            onChange: e => setNewRule({ ...newRule, targetApiSeq: e.target.value }),
            style: { width: '100%' },
          }, [
            React.createElement('option', { value: '', key: '' }, '选择目标接口...'),
            ...(records || []).map(r =>
              React.createElement('option', { key: r.seq, value: String(r.seq) },
                `Seq ${r.seq}: ${r.method || ''} ${(r.path || r.name || '').slice(0, 40)}`)
            ),
          ]),
        ),
        React.createElement('div', { className: 'form-group', key: 'tgt-loc', style: { flex: 2 } },
          React.createElement('label', null, '目标位置'),
          React.createElement('select', {
            value: newRule.targetLocation,
            onChange: e => setNewRule({ ...newRule, targetLocation: e.target.value }),
            style: { width: '100%' },
          }, targetLocations.map(opt =>
            React.createElement('option', { key: opt.value, value: opt.value }, opt.label)
          )),
        ),
      ]),

      // Transform config with preview
      React.createElement('div', { className: 'card', style: { padding: 12, marginBottom: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 } }, [
        React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8 } }, '值转换 (Transform)'),
        React.createElement('div', { className: 'form-row', style: { gap: 12 } }, [
          React.createElement('div', { className: 'form-group', key: 'tf-type', style: { flex: 1 } },
            React.createElement('label', null, '转换类型'),
            React.createElement('select', {
              value: newRule.transform.type,
              onChange: e => setNewRule({ ...newRule, transform: { ...newRule.transform, type: e.target.value } }),
              style: { width: '100%' },
            }, transformTypes.map(t =>
              React.createElement('option', { key: t.value, value: t.value }, t.label)
            )),
          ),
          newRule.transform.type !== 'none' &&
            React.createElement('div', { className: 'form-group', key: 'tf-expr', style: { flex: 2 } },
              React.createElement('label', null, '转换表达式'),
              React.createElement('input', {
                value: newRule.transform.expression,
                placeholder: newRule.transform.type === 'jsonpath' ? '$.data.token'
                  : newRule.transform.type === 'regex' ? '(?<=token=)[^&]+'
                  : newRule.transform.type === 'template' ? 'Bearer ${value}'
                  : '函数名(args)',
                onChange: e => setNewRule({ ...newRule, transform: { ...newRule.transform, expression: e.target.value } }),
                style: { width: '100%', fontFamily: 'monospace' },
              }),
            ),
        ]),
        // 预览值 (Section 4.3 设计)
        newRule.sourcePath && newRule.sourcePath !== '__custom__' && React.createElement('div', {
          style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 },
        }, [
          React.createElement('span', { style: { fontSize: 11, color: 'var(--text-secondary)' } }, '预览值:'),
          React.createElement('code', {
            style: {
              flex: 1, padding: '3px 8px', fontSize: 11, borderRadius: 4,
              background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0',
              fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
          }, generatePreviewValue(newRule)),
        ]),
      ]),

      // Actions
      React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } }, [
        React.createElement('button', {
          className: 'btn btn-sm',
          onClick: () => handleTestExtract(newRule),
          style: { color: 'var(--primary)' },
        }, '测试提取'),
        React.createElement('button', { className: 'btn btn-sm', onClick: () => setShowAdd(false) }, '取消'),
        React.createElement('button', { className: 'btn btn-primary btn-sm', onClick: addRule }, '添加规则'),
      ]),
    ]),

    // Rule list
    React.createElement('div', { key: 'list' },
      rules.length === 0 && !showAdd
        ? React.createElement('div', { className: 'empty-state', style: { padding: 40 } }, [
            React.createElement('span', { className: 'empty-state-icon', key: 'ic' }, '\uD83D\uDD17'),
            React.createElement('h3', { key: 't' }, '暂无串联规则'),
            React.createElement('p', { key: 'd' }, '串联规则用于将前面接口的响应值传递到后续接口的参数中。'),
          ])
        : rules.map((rule, i) => {
            const isEditing = editing === i;
            const srcRecord = recordMap[rule.sourceApiSeq];
            const tgtRecord = recordMap[rule.targetApiSeq];

            return React.createElement('div', {
              key: rule.id || i,
              className: 'card',
              style: { marginBottom: 8, opacity: rule.enabled ? 1 : 0.5 },
            }, [
              // Rule header
              React.createElement('div', { className: 'card-header', key: 'h' }, [
                React.createElement('div', { className: 'card-title', key: 't' }, [
                  React.createElement('span', {
                    style: { cursor: 'pointer', fontSize: 13, color: rule.enabled ? '#16a34a' : '#ccc' },
                    onClick: () => toggleRule(i),
                  }, rule.enabled ? '✓' : '○'),
                  React.createElement('span', {
                    style: { marginLeft: 8, fontWeight: 600, fontSize: 13 },
                    onClick: () => handleEditStart(i),
                  }, rule.name || `规则 #${i + 1}`),
                  React.createElement('span', {
                    className: 'tag tag-sm',
                    style: { marginLeft: 8, fontSize: 10 },
                  }, (transformTypes.find(t => t.value === rule.transform?.type) || {}).label || '直接传递'),
                ]),
                React.createElement('button', {
                  className: 'btn btn-sm btn-danger',
                  style: { padding: '2px 8px', fontSize: 11 },
                  onClick: () => removeRule(i),
                }, '删除'),
              ]),

              // Rule body
              React.createElement('div', { key: 'body', style: { padding: '8px 16px', fontSize: 12 } }, [
                React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--text-secondary)' } }, [
                  React.createElement('span', { key: 'src' }, [
                    '来源: ',
                    React.createElement('strong', null, `Seq ${rule.sourceApiSeq}`),
                    rule.sourcePath && React.createElement('span', { style: { fontFamily: 'monospace', marginLeft: 4, color: '#16a34a' } }, `.${rule.sourcePath}`),
                  ]),
                  React.createElement('span', { key: 'arr', style: { color: '#e74c3c', fontWeight: 600 } }, '→'),
                  React.createElement('span', { key: 'tgt' }, [
                    '目标: ',
                    React.createElement('strong', null, `Seq ${rule.targetApiSeq}`),
                    React.createElement('span', { style: { fontFamily: 'monospace', marginLeft: 4, color: '#2563eb' } }, `.${rule.targetLocation}`),
                  ]),
                ]),
                srcRecord && React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 } },
                  `${srcRecord.method} ${srcRecord.path || srcRecord.name || ''}`),

                // 预览值显示 (Section 4.3)
                rule.sourcePath && React.createElement('div', {
                  style: { marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 },
                }, [
                  React.createElement('span', { style: { fontSize: 10, color: 'var(--text-secondary)' } }, '预览值:'),
                  React.createElement('code', {
                    style: {
                      padding: '2px 8px', fontSize: 10, borderRadius: 3,
                      background: '#f0fdf4', color: '#166534',
                      fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    },
                  }, generatePreviewValue(rule)),
                  React.createElement('button', {
                    className: 'btn btn-sm',
                    style: { padding: '1px 6px', fontSize: 10 },
                    onClick: () => handleTestExtract(rule),
                  }, '测试提取'),
                ]),
              ]),

              // Inline edit
              isEditing && React.createElement('div', { key: 'edit', style: { padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface)' } }, [
                React.createElement('div', { className: 'form-row', style: { gap: 12, marginBottom: 8 } }, [
                  React.createElement('div', { className: 'form-group', key: 'name', style: { flex: 1 } },
                    React.createElement('label', null, '规则名称'),
                    React.createElement('input', {
                      value: rule.name,
                      onChange: e => updateRule(i, 'name', e.target.value),
                      style: { width: '100%' },
                    }),
                  ),
                  React.createElement('div', { className: 'form-group', key: 'loc', style: { flex: 1 } },
                    React.createElement('label', null, '目标位置'),
                    React.createElement('select', {
                      value: rule.targetLocation,
                      onChange: e => updateRule(i, 'targetLocation', e.target.value),
                      style: { width: '100%' },
                    }, targetLocations.map(opt =>
                      React.createElement('option', { key: opt.value, value: opt.value }, opt.label)
                    )),
                  ),
                ]),
                React.createElement('div', { className: 'form-row', style: { gap: 12, marginBottom: 8 } }, [
                  React.createElement('div', { className: 'form-group', key: 'tf', style: { flex: 1 } },
                    React.createElement('label', null, '转换类型'),
                    React.createElement('select', {
                      value: (rule.transform || {}).type || 'none',
                      onChange: e => updateTransform(i, 'type', e.target.value),
                      style: { width: '100%' },
                    }, transformTypes.map(t =>
                      React.createElement('option', { key: t.value, value: t.value }, t.label)
                    )),
                  ),
                  (rule.transform || {}).type !== 'none' &&
                    React.createElement('div', { className: 'form-group', key: 'expr', style: { flex: 2 } },
                      React.createElement('label', null, '转换表达式'),
                      React.createElement('input', {
                        value: (rule.transform || {}).expression || '',
                        onChange: e => updateTransform(i, 'expression', e.target.value),
                        style: { width: '100%', fontFamily: 'monospace' },
                      }),
                    ),
                ]),
                // 编辑模式预览
                rule.sourcePath && React.createElement('div', {
                  style: { marginBottom: 8, fontSize: 11, color: 'var(--text-secondary)' },
                }, [
                  '预览值: ',
                  React.createElement('code', { style: { fontSize: 10, padding: '2px 6px', background: '#f0fdf4', borderRadius: 3 } }, generatePreviewValue(rule)),
                ]),
                React.createElement('button', {
                  className: 'btn btn-sm',
                  onClick: handleEditDone,
                }, '完成编辑'),
              ]),
            ]);
          })
    ),

    // Actions
    React.createElement('div', {
      key: 'actions',
      style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
    }, [
      onClose && React.createElement('button', { className: 'btn btn-sm', onClick: onClose }, '关闭'),
      React.createElement('button', {
        className: 'btn btn-primary btn-sm',
        onClick: handleSave,
      }, '保存所有规则'),
    ]),
  ]);
};