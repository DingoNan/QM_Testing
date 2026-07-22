// DataBindingWizard.js - 数据绑定向导组件
// 步骤 1: 选择数据池
// 步骤 2: 字段映射 (数据池字段 → 接口参数/URL/Header/Body)
// 步骤 3: 高级设置 (iterationMode, 行超出处理, 排序模式, 共享模式)
// 步骤 4: 预览生成的用例结构
const DataBindingWizard = ({ dataPools, records, onComplete, onClose }) => {
  const [step, setStep] = React.useState(1);
  const [pools, setPools] = React.useState(dataPools || []);
  const [selectedPoolId, setSelectedPoolId] = React.useState('');
  const [selectedPool, setSelectedPool] = React.useState(null);
  const [mappings, setMappings] = React.useState([]);
  const [advSettings, setAdvSettings] = React.useState({
    iterationMode: 'expand',
    recycleOnEnd: true,
    randomOrder: false,
    sharingMode: 'all',
    rowLimit: 0,
  });
  const [preview, setPreview] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [autoMapped, setAutoMapped] = React.useState(false);

  // 自动映射 (Section 9 决策2): 字段名相似度匹配
  const handleAutoMapping = () => {
    if (!selectedPool || !records) return;
    const fields = (selectedPool.fields || []).map(f => f.name || f);
    const apis = records || [];
    const newMappings = [];

    fields.forEach(f => {
      const fLower = f.toLowerCase();
      let bestMatch = null;
      // 在 records 中搜索同名/相似参数
      apis.forEach(api => {
        // 检查 requestBody
        const body = api.requestBody || {};
        if (typeof body === 'object') {
          Object.keys(body).forEach(k => {
            if (k.toLowerCase() === fLower || fLower.includes(k.toLowerCase()) || k.toLowerCase().includes(fLower)) {
              if (!bestMatch || k.toLowerCase() === fLower) bestMatch = { targetApi: String(api.seq), targetLocation: 'requestBody.', similarity: k.toLowerCase() === fLower ? 100 : 70 };
            }
          });
        }
        // 检查 URL query 参数
        const url = api.path || api.name || '';
        if (url.includes('{') && url.includes('}')) {
          const urlParams = url.match(/\{(\w+)\}/g) || [];
          urlParams.forEach(up => {
            const pName = up.slice(1, -1);
            if (pName.toLowerCase() === fLower) {
              if (!bestMatch || bestMatch.similarity < 100) bestMatch = { targetApi: String(api.seq), targetLocation: 'url', similarity: 90 };
            }
          });
        }
        // 检查 requestHeaders
        const headers = api.requestHeaders || {};
        if (typeof headers === 'object') {
          Object.keys(headers).forEach(k => {
            if (k.toLowerCase() === fLower) {
              if (!bestMatch || bestMatch.similarity < 100) bestMatch = { targetApi: String(api.seq), targetLocation: 'requestHeaders.', similarity: 80 };
            }
          });
        }
      });

      if (bestMatch) {
        newMappings.push({
          field: f,
          targetApi: bestMatch.targetApi,
          targetLocation: bestMatch.targetLocation,
          expression: `\${data.${f}}`,
        });
      } else {
        newMappings.push({
          field: f,
          targetApi: '',
          targetLocation: '',
          expression: `\${data.${f}}`,
        });
      }
    });
    setMappings(newMappings);
    setAutoMapped(true);
    const matched = newMappings.filter(m => m.targetApi).length;
    window.appApi.showToast(`自动映射完成：${matched}/${fields.length} 个字段匹配成功`, matched > 0 ? 'success' : 'info');
  };

  React.useEffect(() => {
    (async () => {
      try {
        const list = await window.appApi.dataPoolList();
        if (Array.isArray(list) && list.length > 0) {
          setPools(list);
        }
      } catch {}
    })();
  }, []);

  // Step 1: 选择数据池
  const handleSelectPool = async (poolId) => {
    setSelectedPoolId(poolId);
    try {
      const result = await window.appApi.dataPoolGet(poolId);
      if (result && result.success && result.pool) {
        setSelectedPool(result.pool);
        // 初始化字段映射
        const fields = (result.pool.fields || []).map(f => f.name || f);
        const apis = records || [];
        const initialMappings = fields.map(f => ({
          field: f,
          targetApi: '',
          targetLocation: '',
          expression: `\${data.${f}}`,
        }));
        setMappings(initialMappings);
      }
    } catch (e) {
      window.appApi.showToast('加载数据池失败: ' + e.message, 'error');
    }
  };

  // Step 2: 字段映射
  const updateMapping = (idx, key, value) => {
    setMappings(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [key]: value };
      return updated;
    });
  };

  const addMapping = () => {
    setMappings(prev => [...prev, {
      field: '',
      targetApi: '',
      targetLocation: '',
      expression: '',
    }]);
  };

  const removeMapping = (idx) => {
    setMappings(prev => prev.filter((_, i) => i !== idx));
  };

  const handleVarSelect = (idx, varExpr) => {
    setMappings(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], expression: (updated[idx].expression || '') + varExpr };
      return updated;
    });
  };

  // Step 4: 生成预览
  const generatePreview = async () => {
    setLoading(true);
    try {
      const activeMappings = mappings.filter(m => m.field && m.targetApi);
      const poolData = selectedPool;
      const rowCount = (poolData?.rows || []).length;
      const totalCases = advSettings.iterationMode === 'expand' ? (rowCount || 1) : 1;

      setPreview({
        poolName: poolData?.name || '未命名',
        fieldCount: (poolData?.fields || []).length,
        rowCount,
        totalCases,
        mappings: activeMappings,
        iterationMode: advSettings.iterationMode,
        recycleOnEnd: advSettings.recycleOnEnd,
        randomOrder: advSettings.randomOrder,
        sharingMode: advSettings.sharingMode,
      });
      setStep(4);
    } catch (e) {
      window.appApi.showToast('生成预览失败: ' + e.message, 'error');
    }
    setLoading(false);
  };

  const handleComplete = () => {
    const activeMappings = mappings.filter(m => m.field && m.targetApi);
    const result = {
      dataPoolId: selectedPoolId,
      dataPoolName: selectedPool?.name || '',
      mappings: activeMappings,
      settings: advSettings,
    };
    if (onComplete) onComplete(result);
  };

  const getTargetLocationOptions = () => [
    { value: 'url', label: 'URL 参数' },
    { value: 'requestHeaders.', label: '请求头' },
    { value: 'requestBody.', label: '请求体' },
    { value: 'assert.N.expectValue', label: '断言预期值' },
    { value: 'assert.N.expression', label: '断言表达式' },
  ];

  return React.createElement('div', { className: 'data-binding-wizard' }, [
    // Step indicator
    React.createElement('div', {
      key: 'steps',
      style: { display: 'flex', gap: 4, marginBottom: 20, fontSize: 12 },
    }, [
      ['📋 选择数据池', '🔗 字段映射', '⚙️ 高级设置', '👁 预览'].map((label, i) => {
        const stepNum = i + 1;
        const isActive = step === stepNum;
        const isDone = step > stepNum;
        return React.createElement('div', {
          key: i,
          style: {
            flex: 1, padding: '10px 12px', textAlign: 'center',
            borderRadius: 8, fontWeight: isActive ? 700 : 400,
            background: isActive ? 'var(--primary)' : isDone ? '#dcfce7' : 'var(--bg-secondary)',
            color: isActive ? '#fff' : isDone ? '#166534' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s',
            border: isActive ? '2px solid var(--primary-dark)' : '2px solid transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          },
          onClick: () => { if (isDone) setStep(stepNum); },
        }, [
          React.createElement('span', {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: isActive ? 'rgba(255,255,255,0.25)' : isDone ? '#166534' : 'var(--border)',
              color: isActive ? '#fff' : isDone ? '#fff' : 'var(--text-secondary)',
              fontSize: 11,
              fontWeight: 700,
            },
          }, stepNum),
          React.createElement('span', { style: { fontSize: 13 } }, label),
        ]);
      }),
    ]),

    // Step 1: 选择数据池
    step === 1 && React.createElement('div', { key: 's1' }, [
      React.createElement('h4', { style: { marginBottom: 12, fontSize: 14 } }, '选择数据池'),
      pools.length === 0
        ? React.createElement('div', { style: { padding: 24, textAlign: 'center', color: 'var(--text-secondary)' } }, [
            React.createElement('p', { key: 't' }, '暂无数据池'),
            React.createElement('button', {
              className: 'btn btn-primary btn-sm',
              onClick: () => pipelineStore.setState({ currentPage: 'data-pools' }),
              style: { marginTop: 8 },
            }, '前往创建数据池'),
          ])
        : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 } },
            pools.map(p => {
              const isSelected = selectedPoolId === p.id;
              return React.createElement('div', {
                key: p.id,
                style: {
                  padding: 12, borderRadius: 8, cursor: 'pointer',
                  border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                  background: isSelected ? 'var(--primary-bg, #f0f7ff)' : 'var(--bg)',
                  transition: 'all 0.15s',
                },
                onClick: () => handleSelectPool(p.id),
              }, [
                React.createElement('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, p.name || '未命名'),
                React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)' } }, [
                  React.createElement('span', null, `${p.fieldCount || 0} 字段, ${p.rowCount || 0} 行`),
                  React.createElement('span', { style: { marginLeft: 8 } }, `来源: ${p.source || 'manual'}`),
                ]),
                isSelected && React.createElement('div', { style: { marginTop: 6, fontSize: 11, color: 'var(--primary)' } }, '✓ 已选择'),
              ]);
            })
          ),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 } }, [
        onClose && React.createElement('button', { className: 'btn btn-sm', onClick: onClose }, '取消'),
        React.createElement('button', {
          className: 'btn btn-primary btn-sm',
          disabled: !selectedPoolId,
          onClick: () => setStep(2),
        }, '下一步 →'),
      ]),
    ]),

    // Step 2: 字段映射
    step === 2 && React.createElement('div', { key: 's2' }, [
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } }, [
        React.createElement('h4', { style: { fontSize: 14 } }, '字段映射'),
        React.createElement('div', { style: { display: 'flex', gap: 6 } }, [
          React.createElement('button', {
            className: 'btn btn-sm',
            onClick: handleAutoMapping,
            style: { color: 'var(--primary)', fontSize: 11, border: '1px solid var(--primary)' },
          }, '🤖 自动映射'),
          React.createElement('button', { className: 'btn btn-sm', onClick: addMapping }, '+ 添加映射'),
        ]),
      ]),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 } },
        '将数据池字段映射到接口参数。变量引用格式如 ',
        React.createElement('code', { style: { fontSize: 10 } }, '${data.username}'),
        ' 表示从当前数据行取值。'),
      mappings.length === 0
        ? React.createElement('div', { style: { padding: 20, textAlign: 'center', color: 'var(--text-secondary)' } }, '暂无映射，点击 "+ 添加映射" 开始配置')
        : React.createElement('div', { style: { overflowX: 'auto' } },
            React.createElement('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse' } }, [
              React.createElement('thead', { key: 'th' },
                React.createElement('tr', { style: { background: 'var(--bg-secondary)' } }, [
                  React.createElement('th', { style: { padding: '6px 8px', textAlign: 'left' } }, '数据池字段'),
                  React.createElement('th', { style: { padding: '6px 8px', textAlign: 'left' } }, '目标接口(Seq)'),
                  React.createElement('th', { style: { padding: '6px 8px', textAlign: 'left' } }, '目标位置'),
                  React.createElement('th', { style: { padding: '6px 8px', textAlign: 'left' } }, '变量表达式'),
                  React.createElement('th', { style: { padding: '6px 8px', width: 40 } }, ''),
                ])
              ),
              React.createElement('tbody', { key: 'tb' },
                mappings.map((m, i) =>
                  React.createElement('tr', { key: i, style: { borderBottom: '1px solid var(--border)' } }, [
                    // Field selector
                    React.createElement('td', { style: { padding: '4px 6px' } },
                      React.createElement('select', {
                        value: m.field,
                        onChange: e => updateMapping(i, 'field', e.target.value),
                        style: { width: '100%', padding: '4px 6px', fontSize: 11 },
                      }, [
                        React.createElement('option', { value: '', key: '' }, '选择字段...'),
                        ...(selectedPool?.fields || []).map(f => {
                          const name = f.name || f;
                          return React.createElement('option', { key: name, value: name }, name);
                        }),
                      ])
                    ),
                    // Target API seq
                    React.createElement('td', { style: { padding: '4px 6px' } },
                      React.createElement('input', {
                        value: m.targetApi,
                        onChange: e => updateMapping(i, 'targetApi', e.target.value),
                        placeholder: '如 1, 2, 3',
                        style: { width: '100%', padding: '4px 6px', fontSize: 11 },
                      })
                    ),
                    // Target location
                    React.createElement('td', { style: { padding: '4px 6px' } },
                      React.createElement('select', {
                        value: m.targetLocation,
                        onChange: e => updateMapping(i, 'targetLocation', e.target.value),
                        style: { width: '100%', padding: '4px 6px', fontSize: 11 },
                      }, [
                        React.createElement('option', { value: '', key: '' }, '选择位置...'),
                        ...getTargetLocationOptions().map(opt =>
                          React.createElement('option', { key: opt.value, value: opt.value }, opt.label)
                        ),
                      ])
                    ),
                    // Expression (read-only display of variable reference)
                    React.createElement('td', { style: { padding: '4px 6px' } },
                      React.createElement('input', {
                        value: m.expression,
                        onChange: e => updateMapping(i, 'expression', e.target.value),
                        style: { width: '100%', padding: '4px 6px', fontSize: 11, fontFamily: 'monospace' },
                        placeholder: '${data.fieldName}',
                      })
                    ),
                    // Remove
                    React.createElement('td', { style: { padding: '4px 6px' } },
                      React.createElement('button', {
                        className: 'btn btn-sm btn-danger',
                        onClick: () => removeMapping(i),
                        style: { padding: '2px 6px', fontSize: 11 },
                      }, 'X'),
                    ),
                  ])
                )
              ),
            ])
          ),
      // Quick variable selector (simplified)
      React.createElement('div', {
        style: { marginTop: 12, padding: 12, background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' },
      }, [
        React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } }, '快速变量引用'),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 } },
          '点击下方变量名快速插入到表达式输入框（选中输入框后点击）'),
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
          (selectedPool?.fields || []).map(f => {
            const name = f.name || f;
            return React.createElement('span', {
              key: name,
              className: 'tag tag-info tag-sm',
              style: { cursor: 'pointer', fontSize: 10 },
              onClick: () => {
                // Find first mapping with empty expression or focused
                const idx = mappings.findIndex(m => !m.expression);
                if (idx >= 0) handleVarSelect(idx, `\${data.${name}}`);
              },
            }, `\${data.${name}}`);
          })
        ),
      ]),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 } }, [
        React.createElement('button', { className: 'btn btn-sm', onClick: () => setStep(1) }, '← 上一步'),
        React.createElement('button', {
          className: 'btn btn-primary btn-sm',
          onClick: () => setStep(3),
        }, '下一步 →'),
      ]),
    ]),

    // Step 3: 高级设置
    step === 3 && React.createElement('div', { key: 's3' }, [
      React.createElement('h4', { style: { fontSize: 14, marginBottom: 16 } }, '高级设置'),
      React.createElement('div', { className: 'card', style: { padding: 16, marginBottom: 12 } }, [
        React.createElement('div', { className: 'form-row', style: { gap: 16 } }, [
          React.createElement('div', { className: 'form-group', key: 'mode', style: { flex: 1 } },
            React.createElement('label', null, '迭代模式'),
            React.createElement('select', {
              value: advSettings.iterationMode,
              onChange: e => setAdvSettings({ ...advSettings, iterationMode: e.target.value }),
              style: { width: '100%' },
            }, [
              React.createElement('option', { value: 'expand' }, '展开模式 — 每行生成独立用例'),
              React.createElement('option', { value: 'loop' }, '循环模式 — 单用例循环取数'),
              React.createElement('option', { value: 'none' }, '不启用'),
            ]),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 } },
              advSettings.iterationMode === 'expand'
                ? 'N 行数据生成 N 个 CaseVo，每个独立执行'
                : advSettings.iterationMode === 'loop'
                  ? '单个 CaseVo 携带 dataPoolId，Runner 逐行循环'
                  : '不使用数据池'),
          ),
        ]),
        React.createElement('div', { className: 'form-row', style: { gap: 16, marginTop: 12 } }, [
          React.createElement('div', { className: 'form-group', key: 'recycle', style: { flex: 1 } },
            React.createElement('label', null, '数据行超出时'),
            React.createElement('select', {
              value: advSettings.recycleOnEnd ? 'recycle' : 'stop',
              onChange: e => setAdvSettings({ ...advSettings, recycleOnEnd: e.target.value === 'recycle' }),
              style: { width: '100%' },
            }, [
              React.createElement('option', { value: 'recycle' }, '重新从头读取 (recycle)'),
              React.createElement('option', { value: 'stop' }, '停止取数'),
            ]),
          ),
          React.createElement('div', { className: 'form-group', key: 'order', style: { flex: 1 } },
            React.createElement('label', null, '排序模式'),
            React.createElement('select', {
              value: advSettings.randomOrder ? 'random' : 'sequential',
              onChange: e => setAdvSettings({ ...advSettings, randomOrder: e.target.value === 'random' }),
              style: { width: '100%' },
            }, [
              React.createElement('option', { value: 'sequential' }, '顺序读取'),
              React.createElement('option', { value: 'random' }, '随机取行'),
            ]),
          ),
          React.createElement('div', { className: 'form-group', key: 'share', style: { flex: 1 } },
            React.createElement('label', null, '共享模式'),
            React.createElement('select', {
              value: advSettings.sharingMode,
              onChange: e => setAdvSettings({ ...advSettings, sharingMode: e.target.value }),
              style: { width: '100%' },
            }, [
              React.createElement('option', { value: 'all' }, '所有实例共享'),
              React.createElement('option', { value: 'thread' }, '当前实例独立'),
              React.createElement('option', { value: 'copy' }, '每实例一份副本'),
            ]),
          ),
        ]),
        React.createElement('div', { className: 'form-group', key: 'limit', style: { marginTop: 12 } },
          React.createElement('label', null, '最大行数限制（0 表示不限制）'),
          React.createElement('input', {
            type: 'number', min: 0,
            value: advSettings.rowLimit,
            onChange: e => setAdvSettings({ ...advSettings, rowLimit: parseInt(e.target.value) || 0 }),
            style: { width: '100%' },
          }),
        ),
      ]),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 } }, [
        React.createElement('button', { className: 'btn btn-sm', onClick: () => setStep(2) }, '← 上一步'),
        React.createElement('button', {
          className: 'btn btn-primary btn-sm',
          onClick: generatePreview,
          disabled: loading,
        }, loading ? '生成中...' : '生成预览 →'),
      ]),
    ]),

    // Step 4: 预览
    step === 4 && preview && React.createElement('div', { key: 's4' }, [
      React.createElement('h4', { style: { fontSize: 14, marginBottom: 12 } }, '数据绑定预览'),
      React.createElement('div', { className: 'card', style: { padding: 16, marginBottom: 12 } }, [
        React.createElement('div', { className: 'stats-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 12 } }, [
          React.createElement('div', { className: 'stat-card', style: { textAlign: 'center', padding: 10 } }, [
            React.createElement('div', { style: { fontSize: 18, fontWeight: 700, color: 'var(--primary)' } }, preview.poolName),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 } }, '数据池'),
          ]),
          React.createElement('div', { className: 'stat-card', style: { textAlign: 'center', padding: 10 } }, [
            React.createElement('div', { style: { display: 'flex', justifyContent: 'center', gap: 16 } }, [
              React.createElement('div', null, [
                React.createElement('div', { style: { fontSize: 18, fontWeight: 700 } }, preview.fieldCount),
                React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)' } }, '字段'),
              ]),
              React.createElement('div', null, [
                React.createElement('div', { style: { fontSize: 18, fontWeight: 700 } }, preview.rowCount),
                React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)' } }, '数据行'),
              ]),
            ]),
          ]),
          React.createElement('div', { className: 'stat-card', style: { textAlign: 'center', padding: 10 } }, [
            React.createElement('div', { style: { fontSize: 18, fontWeight: 700, color: '#16a34a' } }, preview.totalCases),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 } }, '生成用例数'),
            React.createElement('div', { style: { fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 } },
              [preview.iterationMode === 'expand' ? '展开' : preview.iterationMode === 'loop' ? '循环' : '不启用',
               preview.recycleOnEnd ? '可循环' : '不循环',
               preview.randomOrder ? '随机' : '顺序',
               '共享: ' + (preview.sharingMode === 'all' ? '全部' : preview.sharingMode)].join(' | ')),
          ]),
        ]),
      ]),
      // Mappings summary
      React.createElement('div', { className: 'card', style: { padding: 16, marginBottom: 12 } }, [
        React.createElement('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 8 } },
          `字段映射 (${preview.mappings.length} 条)`),
        preview.mappings.length === 0
          ? React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)' } }, '暂无字段映射')
          : React.createElement('div', { style: { overflowX: 'auto' } },
              React.createElement('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse' } }, [
                React.createElement('thead', { key: 'th' },
                  React.createElement('tr', { style: { background: 'var(--bg-secondary)' } }, [
                    React.createElement('th', { style: { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' } }, '字段'),
                    React.createElement('th', { style: { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' } }, '目标接口'),
                    React.createElement('th', { style: { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' } }, '目标位置'),
                    React.createElement('th', { style: { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' } }, '表达式'),
                  ])
                ),
                React.createElement('tbody', { key: 'tb' },
                  preview.mappings.map((m, i) =>
                    React.createElement('tr', { key: i, style: { borderBottom: '1px solid var(--border)', transition: 'background 0.1s', cursor: 'default' },
                      onMouseEnter: e => e.currentTarget.style.background = 'var(--bg-secondary)',
                      onMouseLeave: e => e.currentTarget.style.background = 'transparent',
                    }, [
                      React.createElement('td', { style: { padding: '8px 12px', fontWeight: 600 } }, m.field),
                      React.createElement('td', { style: { padding: '8px 12px' } }, `Seq ${m.targetApi}`),
                      React.createElement('td', { style: { padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 } }, m.targetLocation || '-'),
                      React.createElement('td', { style: { padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--primary)' } }, m.expression || '-'),
                    ])
                  )
                ),
              ])
            ),
      ]),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 } }, [
        React.createElement('button', { className: 'btn btn-sm', onClick: () => setStep(3) }, '← 上一步'),
        React.createElement('div', { style: { display: 'flex', gap: 8 } }, [
          React.createElement('button', { className: 'btn btn-sm', onClick: onClose }, '取消'),
          React.createElement('button', {
            className: 'btn btn-sm',
            onClick: () => { if (onComplete) onComplete({ skipped: true }); },
            style: { color: 'var(--text-secondary)' },
          }, '跳过，直接审核'),
          React.createElement('button', { className: 'btn btn-primary btn-sm', onClick: handleComplete }, '✓ 确认绑定并生成'),
        ]),
      ]),
    ]),
  ]);
};
