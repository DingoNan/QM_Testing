// TestDataManager.js - 测试数据管理组件
// 功能：数据池 CRUD、CSV/TXT 导入、批量粘贴、数据编辑、高级控制
const TestDataManager = ({ dataPools, onSave, onDelete, onImportCsv, onImportTxt }) => {
  const [pools, setPools] = React.useState(dataPools || []);
  const [showCreate, setShowCreate] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [importMode, setImportMode] = React.useState('csv');
  const [editPool, setEditPool] = React.useState(null);
  const [editingPool, setEditingPool] = React.useState(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [preview, setPreview] = React.useState(null);

  const inputCellStyle = { width: '100%', minWidth: 60, padding: '3px 6px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg)', color: 'var(--text)' };

  // 创建新数据池
  const [newPool, setNewPool] = React.useState({
    name: '', description: '', source: 'manual',
    fields: [{ name: 'field_1', type: 'string', alias: [], defaultValue: '', description: '' }],
    rows: [],
    tags: [],
    control: { recycleOnEnd: true, randomOrder: false, sharingMode: 'all' },
  });

  React.useEffect(() => {
    if (dataPools) setPools(dataPools);
  }, [dataPools]);

  const addField = () => {
    const idx = newPool.fields.length;
    setNewPool(prev => ({
      ...prev,
      fields: [...prev.fields, { name: `field_${idx + 1}`, type: 'string', alias: [], defaultValue: '', description: '' }],
    }));
  };

  const removeField = (idx) => {
    setNewPool(prev => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== idx),
      rows: prev.rows.map(r => {
        const fName = prev.fields[idx].name;
        const { [fName]: _, ...rest } = r.values;
        return { ...r, values: rest };
      }),
    }));
  };

  const updateField = (idx, key, value) => {
    setNewPool(prev => {
      const fields = [...prev.fields];
      fields[idx] = { ...fields[idx], [key]: value };
      return { ...prev, fields };
    });
  };

  const addRow = () => {
    const values = {};
    newPool.fields.forEach(f => { values[f.name] = f.defaultValue || ''; });
    setNewPool(prev => ({ ...prev, rows: [...prev.rows, { values, enabled: true }] }));
  };

  const removeRow = (idx) => {
    setNewPool(prev => ({ ...prev, rows: prev.rows.filter((_, i) => i !== idx) }));
  };

  const updateRowValue = (rowIdx, fieldName, value) => {
    setNewPool(prev => {
      const rows = [...prev.rows];
      rows[rowIdx] = { ...rows[rowIdx], values: { ...rows[rowIdx].values, [fieldName]: value } };
      return { ...prev, rows };
    });
  };

  const handleCreatePool = () => {
    if (!newPool.name.trim()) { window.appApi.showToast('\u8BF7\u8F93\u5165\u6570\u636E\u6C60\u540D\u79F0', 'warning'); return; }
    const poolToSave = editingPool ? { ...editingPool, ...newPool } : newPool;
    onSave(poolToSave);
    setShowCreate(false);
    setEditingPool(null);
    setNewPool({
      name: '', description: '', source: 'manual',
      fields: [{ name: 'field_1', type: 'string', alias: [], defaultValue: '', description: '' }],
      rows: [], tags: [], control: { recycleOnEnd: true, randomOrder: false, sharingMode: 'all' },
    });
  };

  const handleImportCsv = async () => {
    const result = await onImportCsv({ name: '' });
    if (result && result.success && result.preview) {
      setPreview(result.preview);
      setNewPool(prev => ({
        ...prev,
        name: result.pool.name,
        source: 'csv',
        fields: result.pool.fields,
        rows: result.pool.rows,
        control: result.pool.control,
      }));
      setShowImport(false);
      setShowCreate(true);
    } else if (result && result.canceled) {
      // user cancelled
    } else {
      window.appApi.showToast('导入失败: ' + (result?.error || '未知错误'), 'error');
    }
  };

  const handleImportTxt = async () => {
    const result = await onImportTxt({});
    if (result && result.success && result.preview) {
      setPreview(result.preview);
      setNewPool(prev => ({
        ...prev,
        name: result.pool.name,
        source: 'txt',
        fields: result.pool.fields,
        rows: result.pool.rows,
        control: result.pool.control,
      }));
      setShowImport(false);
      setShowCreate(true);
    } else if (result && result.canceled) {
      // user cancelled
    } else {
      window.appApi.showToast('导入失败: ' + (result?.error || '未知错误'), 'error');
    }
  };

  const handlePasteImport = (content) => {
    if (!content || !content.trim()) {
      window.appApi.showToast('请输入数据', 'warning');
      return;
    }
    // 内联解析逻辑（替代 require models/TestDataPool）
    const lines = content.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 1) { window.appApi.showToast('无有效数据', 'warning'); return; }
    const hasCommas = content.includes(',');
    const hasTabs = content.includes('\t');
    const delimiter = hasCommas ? ',' : (hasTabs ? '\t' : null);
    let fields, rows;
    if (delimiter === null) {
      // JSON 数组格式
      try {
        const jsonData = JSON.parse(content);
        if (!Array.isArray(jsonData) || jsonData.length === 0) throw new Error('JSON 数组为空');
        const keys = Object.keys(jsonData[0]);
        fields = keys.map(k => ({ name: k, type: 'string', alias: [], defaultValue: '', description: '' }));
        rows = jsonData.map(item => ({ values: Object.fromEntries(keys.map(k => [k, String(item[k] ?? '')])), enabled: true }));
      } catch (e) {
        window.appApi.showToast('解析失败: ' + e.message, 'error');
        return;
      }
    } else {
      // CSV/TXT 格式
      const headerTokens = lines[0].split(delimiter).map(t => t.trim());
      fields = headerTokens.map(h => {
        const isChinese = /[\u4e00-\u9fa5]/.test(h);
        return { name: isChinese ? 'field_' + fields.indexOf(h) : h, type: 'string', alias: isChinese ? [h] : [], defaultValue: '', description: isChinese ? h : '' };
      });
      // 修正 field名称生成（上面用 indexOf 不可靠，这里重新生成）
      fields = headerTokens.map((h, i) => {
        const isChinese = /[\u4e00-\u9fa5]/.test(h);
        return { name: isChinese ? 'field_' + i : h, type: 'string', alias: isChinese ? [h] : [], defaultValue: '', description: isChinese ? h : '' };
      });
      rows = [];
      for (let i = 1; i < lines.length; i++) {
        const tokens = lines[i].split(delimiter);
        const values = {};
        fields.forEach((f, j) => { values[f.name] = (tokens[j] || '').trim(); });
        rows.push({ values, enabled: true });
      }
    }
    const pool = {
      name: '粘贴导入数据', source: 'paste', fields, rows,
      control: { recycleOnEnd: true, randomOrder: false, sharingMode: 'all' },
    };
    setNewPool(prev => ({ ...prev, ...pool }));
    setPreview({ fields: fields.map(f => f.name), rows: rows.slice(0, 5).map(r => r.values), totalRows: rows.length });
    setShowImport(false);
    setShowCreate(true);
  };

  const handleEditClick = async (e, pool) => {
    e.stopPropagation();
    let sourceData = pool;
    if (editPool?.id === pool.id) {
      sourceData = editPool;
    } else if (!pool.fields && window.appApi?.dataPoolGet) {
      try {
        const result = await window.appApi.dataPoolGet(pool.id);
        if (result && result.success && result.pool) {
          sourceData = result.pool;
        }
      } catch (err) { console.warn('\u52A0\u8F7D\u6570\u636E\u6C60\u8BE6\u60C5\u5931\u8D25:', err); }
    }
    setNewPool({
      name: sourceData.name || '',
      description: sourceData.description || '',
      source: sourceData.source || 'manual',
      fields: sourceData.fields || [],
      rows: sourceData.rows || [],
      tags: sourceData.tags || [],
      control: sourceData.control || { recycleOnEnd: true, randomOrder: false, sharingMode: 'all' },
    });
    setEditingPool(sourceData);
    setShowCreate(true);
  };

  const filteredPools = pools.filter(p =>
    !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.tags || []).some(t => t.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // === RENDER ===
  return React.createElement('div', null, [
    // Header
    React.createElement('div', { className: 'page-header', key: 'h' }, [
      React.createElement('h2', { key: 't' }, '测试数据管理'),
      React.createElement('div', { className: 'page-header-actions', key: 'a' }, [
        React.createElement('button', {
          className: 'btn btn-sm', onClick: () => setShowImport(!showImport), key: 'import',
        }, '导入数据'),
        React.createElement('button', {
          className: 'btn btn-primary btn-sm', onClick: () => setShowCreate(!showCreate), key: 'create',
        }, showCreate ? '取消' : '+ 新建数据池'),
      ]),
    ]),

    // Import panel
    showImport && React.createElement('div', { className: 'card', key: 'import', style: { marginBottom: 16 } }, [
      React.createElement('div', { className: 'card-header', key: 'h' },
        React.createElement('div', { className: 'card-title' }, '导入测试数据')),
      React.createElement('div', { key: 'body', style: { padding: 12 } }, [
        // Mode tabs
        React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 12 } }, [
          ['csv', 'CSV 文件'], ['txt', 'TXT 文件'], ['paste', '批量粘贴'],
        ].map(([mode, label]) =>
          React.createElement('button', {
            key: mode, className: 'btn btn-sm' + (importMode === mode ? ' btn-primary' : ''),
            onClick: () => setImportMode(mode),
          }, label)
        )),
        // CSV / TXT
        (importMode === 'csv' || importMode === 'txt') &&
          React.createElement('div', null, [
            React.createElement('p', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 } },
              importMode === 'csv' ? '选择 CSV 文件（首行自动识别为字段名）' : '选择 TXT 文件（空格/制表符分隔）'),
            React.createElement('button', {
              className: 'btn btn-primary',
              onClick: importMode === 'csv' ? handleImportCsv : handleImportTxt,
            }, '选择文件并导入'),
          ]),
        // Paste
        importMode === 'paste' &&
          React.createElement('div', null, [
            React.createElement('p', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 } },
              '粘贴 CSV 或 TXT 格式数据，首行自动识别为字段名'),
            React.createElement('textarea', {
              style: { width: '100%', minHeight: 100, padding: 8, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' },
              placeholder: 'username,password,remark\nadmin,123456,管理员\nguest,guest123,访客',
              onBlur: e => { if (e.target.value.trim()) handlePasteImport(e.target.value); },
            }),
          ]),
        // Preview
        preview && React.createElement('div', { style: { marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' } },
          `检测到 ${preview.fields.length} 个字段，${preview.totalRows} 行数据`),
      ]),
    ]),

    // Search
    React.createElement('div', { key: 'search', style: { marginBottom: 12 } },
      React.createElement('input', {
        style: { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
        placeholder: '搜索数据池名称或标签...',
        value: searchTerm,
        onChange: e => setSearchTerm(e.target.value),
      })
    ),

    // Pool list
    React.createElement('div', { key: 'list' },
      filteredPools.length === 0
        ? React.createElement('div', { className: 'empty-state', style: { padding: 40 } }, [
            React.createElement('span', { className: 'empty-state-icon', key: 'ic' }, '\uD83D\uDCC1'),
            React.createElement('h3', { key: 't' }, '暂无数据池'),
            React.createElement('p', { key: 'd' }, '点击"导入数据"从 CSV/TXT 文件导入，或点击"+ 新建数据池"手动创建。'),
          ])
        : filteredPools.map(pool =>
            React.createElement('div', {
              key: pool.id,
              className: 'card',
              style: { marginBottom: 8, cursor: 'pointer' },
              onClick: async () => {
                if (editPool?.id === pool.id) { setEditPool(null); return; }
                // 列表摘要数据无 fields/rows，展开时异步加载完整数据
                if (!pool.fields && window.appApi?.dataPoolGet) {
                  try {
                    const full = await window.appApi.dataPoolGet(pool.id);
                    if (full && full.success && full.pool) {
                      setEditPool(full.pool);
                      return;
                    }
                  } catch (e) { console.warn('加载数据池详情失败:', e); }
                }
                setEditPool(pool);
              },
            }, [
              React.createElement('div', { className: 'card-header', key: 'h' }, [
                React.createElement('div', { className: 'card-title', key: 't' }, [
                  pool.name || '\u672A\u547D\u540D',
                  React.createElement('span', { className: 'tag tag-sm tag-info', style: { marginLeft: 8, fontSize: 10 } }, pool.source || 'manual'),
                  !pool.source && React.createElement('span', { className: 'tag tag-sm tag-warning', style: { marginLeft: 8, fontSize: 10 } }, '\u624B\u52A8'),
                ]),
                React.createElement('div', { key: 'actions', style: { display: 'flex', gap: 4 } }, [
                  React.createElement('button', {
                    className: 'btn btn-sm',
                    style: { padding: '2px 8px', fontSize: 11 },
                    onClick: e => handleEditClick(e, pool),
                  }, '\u7F16\u8F91'),
                  React.createElement('button', {
                    className: 'btn btn-sm btn-danger',
                    style: { padding: '2px 8px', fontSize: 11 },
                    onClick: e => { e.stopPropagation(); onDelete(pool.id); },
                  }, '\u5220\u9664'),
                ]),
              ]),
              React.createElement('div', { key: 'body', style: { padding: '8px 16px', fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 16 } },
                pool.fieldCount !== undefined
                  ? React.createElement('span', null, `${pool.fieldCount} 字段, ${pool.rowCount} 行`)
                  : React.createElement('span', null, `${(pool.fields || []).length} 字段, ${(pool.rows || []).length} 行`),
                pool.tags && pool.tags.length > 0 &&
                  React.createElement('span', null, pool.tags.map(t => React.createElement('span', { key: t, className: 'tag tag-sm', style: { marginRight: 4 } }, t))),
              ),
              // Expanded detail
              editPool?.id === pool.id &&
                React.createElement('div', { key: 'detail', style: { padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 12 } }, [
                  // 使用 editPool（完整数据）而非 pool（列表摘要）
                  React.createElement('div', { style: { marginBottom: 8, color: 'var(--text-secondary)' } },
                    editPool.description || '暂无描述'),
                  // Control settings
                  React.createElement('div', { style: { marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' } }, [
                    React.createElement('span', { key: 'r' }, `超出行为: ${editPool.control?.recycleOnEnd ? '循环' : editPool.control?.useExistingOnly ? '仅现有' : '报错'}`),
                    React.createElement('span', { key: 'rd' }, `排序: ${editPool.control?.randomOrder ? '随机' : '顺序'}`),
                    React.createElement('span', { key: 's' }, `共享: ${editPool.control?.sharingMode === 'all' ? '全部共享' : editPool.control?.sharingMode === 'thread' ? '独立' : '副本'}`),
                  ]),
                  // Fields preview
                  React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, '字段:'),
                  React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
                    (editPool.fields || []).map(f =>
                      React.createElement('span', { key: f.name, className: 'tag tag-info tag-sm', style: { fontSize: 10 } },
                        `${f.name} (${f.type || 'string'})`)
                    )
                  ),
                  // Variable reference format (Section 3.3 design)
                  React.createElement('div', { style: { fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)', fontSize: 11 } }, '变量引用格式:'),
                  React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
                    (editPool.fields || []).map(f =>
                      React.createElement('code', { key: f.name, style: { fontSize: 10, padding: '2px 6px', background: 'var(--surface)', borderRadius: 4, border: '1px solid var(--border)', color: 'var(--primary)' } },
                        '${data.' + editPool.name + '.' + f.name + '}')
                    )
                  ),
                  // Data preview (first 3 rows)
                  React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, '数据预览:'),
                  React.createElement('div', { style: { overflowX: 'auto' } },
                    React.createElement('table', { style: { width: '100%', fontSize: 11, borderCollapse: 'collapse' } }, [
                      React.createElement('thead', { key: 'th' },
                        React.createElement('tr', { style: { background: 'var(--bg-secondary)' } },
                          React.createElement('th', { style: { padding: '4px 8px', width: 28 } }, ''),
                          (editPool.fields || []).map(f =>
                            React.createElement('th', { key: f.name, style: { padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap' } }, f.name)
                          )
                        )
                      ),
                      React.createElement('tbody', { key: 'tb' },
                        (editPool.rows || []).slice(0, 3).map((row, i) =>
                          React.createElement('tr', { key: i, style: { borderBottom: '1px solid var(--border)', opacity: row.enabled !== false ? 1 : 0.4 } },
                            React.createElement('td', { style: { padding: '4px 8px', textAlign: 'center' } },
                              React.createElement('span', { style: { color: row.enabled !== false ? '#16a34a' : '#ccc', fontSize: 12 } }, row.enabled !== false ? '✓' : '✗')
                            ),
                            (editPool.fields || []).map(f =>
                              React.createElement('td', { key: f.name, style: { padding: '4px 8px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                                String(row.values[f.name] ?? row[f.name] ?? '')
                              )
                            )
                          )
                        )
                      ),
                    ])
                  ),
                  (editPool.rows || []).length > 3 &&
                    React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 } },
                      `... 还有 ${(editPool.rows || []).length - 3} 行`),
                ]),
            ])
        ),
    ),

    // Create / Edit form modal
    showCreate && React.createElement('div', {
      className: 'modal-overlay', key: 'create-modal',
      style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, overflow: 'auto', padding: 20 },
      onClick: () => { setShowCreate(false); setEditingPool(null); },
    }, React.createElement('div', {
      style: { background: 'var(--bg)', padding: 24, borderRadius: 8, minWidth: 600, maxWidth: 800, maxHeight: '80vh', overflow: 'auto' },
      onClick: e => e.stopPropagation(),
    }, [
      React.createElement('h4', { key: 't', style: { marginBottom: 16 } }, editingPool ? '\u7F16\u8F91\u6570\u636E\u6C60' : '\u65B0\u5EFA\u6570\u636E\u6C60'),
      // Name
      React.createElement('div', { className: 'form-row', key: 'name-row' }, [
        React.createElement('div', { className: 'form-group', key: 'name', style: { flex: 2 } },
          React.createElement('label', null, '数据池名称'),
          React.createElement('input', {
            value: newPool.name, placeholder: '如: 登录用户列表',
            onChange: e => setNewPool({ ...newPool, name: e.target.value }),
            style: { width: '100%' },
          }),
        ),
        React.createElement('div', { className: 'form-group', key: 'src', style: { flex: 1 } },
          React.createElement('label', null, '来源'),
          React.createElement('input', { value: newPool.source, disabled: true, style: { width: '100%', opacity: 0.7 } }),
        ),
      ]),
      // Description
      React.createElement('div', { className: 'form-group', key: 'desc', style: { marginBottom: 12 } },
        React.createElement('label', null, '描述'),
        React.createElement('input', {
          value: newPool.description, placeholder: '可选描述',
          onChange: e => setNewPool({ ...newPool, description: e.target.value }),
          style: { width: '100%' },
        }),
      ),
      // Fields
      React.createElement('div', { key: 'fields-section', style: { marginBottom: 12 } }, [
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
          React.createElement('label', { style: { fontWeight: 600, fontSize: 13 } }, '字段定义'),
          React.createElement('button', { className: 'btn btn-sm', onClick: addField }, '+ 添加字段'),
        ),
        newPool.fields.map((f, i) =>
          React.createElement('div', { key: i, style: { display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' } }, [
            React.createElement('input', {
              value: f.name, placeholder: '字段名',
              onChange: e => updateField(i, 'name', e.target.value),
              style: { flex: 2, padding: '4px 8px', fontSize: 12 },
            }),
            React.createElement('select', {
              value: f.type,
              onChange: e => updateField(i, 'type', e.target.value),
              style: { flex: 1, padding: '4px 8px', fontSize: 12 },
            }, ['string', 'number', 'boolean', 'json', 'expression'].map(t =>
              React.createElement('option', { key: t, value: t }, t + (t === 'expression' ? ' 🔑' : ''))
            )),
            React.createElement('input', {
              value: f.defaultValue, placeholder: '默认值',
              onChange: e => updateField(i, 'defaultValue', e.target.value),
              style: { flex: 1, padding: '4px 8px', fontSize: 12 },
            }),
            newPool.fields.length > 1 &&
              React.createElement('button', {
                className: 'btn btn-sm btn-danger',
                onClick: () => removeField(i),
                style: { padding: '2px 6px', fontSize: 11 },
              }, 'X'),
          ])
        ),
      ]),
      // Rows
      React.createElement('div', { key: 'rows-section', style: { marginBottom: 12 } }, [
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
          React.createElement('label', { style: { fontWeight: 600, fontSize: 13 } }, `数据行 (${newPool.rows.length})`),
          React.createElement('button', { className: 'btn btn-sm', onClick: addRow }, '+ 添加行'),
        ),
        newPool.rows.length > 0 && React.createElement('div', { style: { overflowX: 'auto' } },
          React.createElement('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse' } }, [
            React.createElement('thead', { key: 'th' },
              React.createElement('tr', { style: { background: 'var(--bg-secondary)' } }, [
                React.createElement('th', { style: { padding: '4px 8px', width: 32, textAlign: 'center' } }, '✅'),
                ...newPool.fields.map(f =>
                  React.createElement('th', { key: f.name, style: { padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap' } }, f.name)
                ),
                React.createElement('th', { style: { padding: '4px 8px', width: 40 } }, ''),
              ])
            ),
            React.createElement('tbody', { key: 'tb' },
              newPool.rows.map((row, i) =>
                React.createElement('tr', { key: i, style: { borderBottom: '1px solid var(--border)', opacity: row.enabled !== false ? 1 : 0.5 } },
                  React.createElement('td', { style: { padding: '2px 4px', textAlign: 'center' } },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: row.enabled !== false,
                      onChange: () => {
                        setNewPool(prev => {
                          const rows = [...prev.rows];
                          rows[i] = { ...rows[i], enabled: !rows[i].enabled };
                          return { ...prev, rows };
                        });
                      },
                      style: { cursor: 'pointer', width: 16, height: 16 },
                    })
                  ),
                  newPool.fields.map(f =>
                    React.createElement('td', { key: f.name, style: { padding: '2px 4px' } },
                      React.createElement('input', {
                        value: row.values[f.name] ?? '',
                        onChange: e => updateRowValue(i, f.name, e.target.value),
                        style: inputCellStyle,
                      })
                    )
                  ),
                  React.createElement('td', { style: { padding: '2px 4px' } },
                    React.createElement('button', {
                      className: 'btn btn-sm btn-danger',
                      onClick: () => removeRow(i),
                      style: { padding: '2px 6px', fontSize: 11 },
                    }, 'X')),
                )
              )
            ),
          ])
        ),
      ]),
      // Advanced control
      React.createElement('div', { key: 'ctrl', className: 'card', style: { padding: 12, marginBottom: 12, background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' } }, [
        React.createElement('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 8 } }, '高级控制'),
        React.createElement('div', { className: 'form-row', style: { gap: 16 } }, [
          React.createElement('div', { className: 'form-group', key: 'recycle', style: { flex: 1 } },
            React.createElement('label', null, '数据行超出时'),
            React.createElement('select', {
              value: newPool.control.recycleOnEnd ? 'recycle' : (newPool.control.useExistingOnly ? 'existing' : 'stop'),
              onChange: e => setNewPool({ ...newPool, control: { ...newPool.control, recycleOnEnd: e.target.value === 'recycle', useExistingOnly: e.target.value === 'existing' } }),
              style: { width: '100%' },
            }, [
              React.createElement('option', { value: 'recycle' }, '重新从头读取 (recycle)'),
              React.createElement('option', { value: 'existing' }, '只使用现有行'),
              React.createElement('option', { value: 'stop' }, '报错停止（stop on EOF）'),
            ]),
          ),
          React.createElement('div', { className: 'form-group', key: 'order', style: { flex: 1 } },
            React.createElement('label', null, '排序模式'),
            React.createElement('select', {
              value: newPool.control.randomOrder ? 'random' : 'sequential',
              onChange: e => setNewPool({ ...newPool, control: { ...newPool.control, randomOrder: e.target.value === 'random' } }),
              style: { width: '100%' },
            }, [
              React.createElement('option', { value: 'sequential' }, '顺序读取'),
              React.createElement('option', { value: 'random' }, '随机取行'),
            ]),
          ),
          React.createElement('div', { className: 'form-group', key: 'share', style: { flex: 1 } },
            React.createElement('label', null, '共享模式'),
            React.createElement('select', {
              value: newPool.control.sharingMode,
              onChange: e => setNewPool({ ...newPool, control: { ...newPool.control, sharingMode: e.target.value } }),
              style: { width: '100%' },
            }, [
              React.createElement('option', { value: 'all' }, '所有实例共享'),
              React.createElement('option', { value: 'thread' }, '当前实例独立'),
              React.createElement('option', { value: 'copy' }, '每实例一份副本'),
            ]),
          ),
        ]),
      ]),
      // Tags
      React.createElement('div', { className: 'form-group', key: 'tags', style: { marginBottom: 12 } },
        React.createElement('label', null, '标签（逗号分隔）'),
        React.createElement('input', {
          value: (newPool.tags || []).join(','), placeholder: '如: 登录, 生产数据',
          onChange: e => setNewPool({ ...newPool, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }),
          style: { width: '100%' },
        }),
      ),
      // Actions
      React.createElement('div', { key: 'actions', style: { display: 'flex', gap: 12, justifyContent: 'flex-end' } }, [
        React.createElement('button', { className: 'btn', onClick: () => { setShowCreate(false); setEditingPool(null); } }, '\u53D6\u6D88'),
        React.createElement('button', { className: 'btn btn-primary', onClick: handleCreatePool }, '保存数据池'),
      ]),
    ])),
  ]);
};
