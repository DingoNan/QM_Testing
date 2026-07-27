// PipelinePage.jsx - Modern Pipeline Page
const PipelinePage = () => {
  const state = pipelineStore.getState();
  const [stages, setStages] = React.useState(state.pipelineState?.stages || [
    { agentId: 'cleaner', name: '数据清洗', status: 'pending' },
    { agentId: 'env-analyzer', name: '环境识别', status: 'pending' },
    { agentId: 'linker', name: '跨接口关联', status: 'pending' },
    { agentId: 'assembler', name: '用例拼装', status: 'pending' },
  ]);
  const [progress, setProgress] = React.useState({});
  const [running, setRunning] = React.useState(false);
  const [completed, setCompleted] = React.useState(false);
  const [hasRecordings, setHasRecordings] = React.useState(!!state.recording);
  const [envConfig, setEnvConfig] = React.useState(state.envConfig);
  const [showEnvForm, setShowEnvForm] = React.useState(false);
  const [outDir, setOutDir] = React.useState(state.outDir || '');
  const [dataPools, setDataPools] = React.useState([]);
  const [showDataBinding, setShowDataBinding] = React.useState(false);
  const dbResult = pipelineStore.getState().pipelineResult;
  const [pipelineResult, setPipelineResult] = React.useState(dbResult);

  // 统计：从录制到用例的数据变化
  const [dataSummary, setDataSummary] = React.useState({
    cleaned: 0, linked: 0, cases: 0,
  });

  React.useEffect(() => {
    (async () => {
      try {
        const pools = await window.appApi.dataPoolList();
        if (Array.isArray(pools)) setDataPools(pools);
      } catch {}
    })();
  }, []);

  React.useEffect(() => {
    const unsub = pipelineStore.subscribe((s) => {
      setHasRecordings(!!s.recording);
      if (s.envConfig) setEnvConfig(s.envConfig);
    });
    return unsub;
  }, []);

  // 监听管道阶段事件（实时进度）
  React.useEffect(() => {
    const unsubList = [];

    // 阶段开始
    const offStart = window.appApi.onPipelineStageStart((msg) => {
      setStages(prev => prev.map(s =>
        s.agentId === (msg.agentId || msg.agent)
          ? { ...s, status: 'running' }
          : s
      ));
    });
    unsubList.push(offStart);

    // 阶段完成
    const offComplete = window.appApi.onPipelineStageComplete((msg) => {
      setStages(prev => prev.map(s =>
        s.agentId === (msg.agentId || msg.agent)
          ? { ...s, status: 'completed' }
          : s
      ));
    });
    unsubList.push(offComplete);

    // 阶段失败
    const offError = window.appApi.onPipelineStageError((msg) => {
      setStages(prev => prev.map(s =>
        s.agentId === (msg.agentId || msg.agent)
          ? { ...s, status: 'failed' }
          : s
      ));
    });
    unsubList.push(offError);

    // 管道完成
    const offEnd = window.appApi.onPipelineComplete(() => {
      setStages(prev => prev.map(s =>
        s.status === 'running' ? { ...s, status: 'completed' } : s
      ));
    });
    unsubList.push(offEnd);

    // 进度更新
    const offProgress = window.appApi.onPipelineProgress((msg) => {
      if (msg && msg.agentId && msg.percent !== undefined) {
        setProgress(prev => ({ ...prev, [msg.agentId]: msg.percent }));
      }
    });
    unsubList.push(offProgress);

    return () => { unsubList.forEach(fn => fn()); };
  }, []);

  const handleStart = async () => {
    setRunning(true);
    setCompleted(false);
    setStages(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'running' } : { ...s, status: 'pending' }));
    try {
      const state = pipelineStore.getState();
      const result = await window.appApi.startPipeline({
        recordingPath: state.recordingPath,
        envConfig,
        inputData: state.recording,
      });
      if (result && result.success) {
        setOutDir(result.outDir || '');
        window.appApi.showToast('管道处理完成', 'success');
        setStages(prev => prev.map(s => ({ ...s, status: 'completed' })));

        // 加载真实数据
        if (result.outDir) {
          try {
            const pipelineResult = await window.appApi.readPipelineResult(result.outDir);
            if (pipelineResult && pipelineResult.success) {
              const cv = pipelineResult.caseVo;
              if (cv) {
                setDataSummary({
                  cleaned: pipelineResult.cleanedCount || 0,
                  linked: pipelineResult.linkedCount || 0,
                  cases: cv.apiCount || 0,
                });
              }
              // 保存到全局 store，供 ReviewPage 使用
              pipelineStore.setState({ pipelineResult, outDir: result.outDir });
              setPipelineResult(pipelineResult);

            // 自动填充环境配置（管道输出的环境信息）
            const envData = pipelineResult.envConfig || await (async () => {
              try {
                const envPath = result.outDir + '/env-config.json';
                const data = await window.appApi.readFile(envPath);
                return data && data.baseURL ? data : null;
              } catch { return null; }
            })();
            if (envData) {
              setEnvConfig(envData);
              pipelineStore.setState({ envConfig: envData });
            }

              // 持久化项目记录
              try {
                await window.appApi.saveProject({
                  outDir: result.outDir,
                  name: cv.name || '未命名用例',
                  apiCount: cv.apiCount || 0,
                  recordingPath: state.recordingPath,
                  stats: pipelineResult,
                });
              } catch (e) {
                console.warn('保存项目记录失败:', e);
              }
            }
          } catch (e) {
            console.warn('读取管道结果失败:', e);
          }
        }

        setCompleted(true);
      } else {
        window.appApi.showToast('管道处理失败: ' + (result?.error || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('管道处理失败: ' + e.message, 'error');
    }
    setRunning(false);
  };

  const handleSaveEnv = (config) => {
    setEnvConfig(config);
    pipelineStore.setState({ envConfig: config });
    // 持久化到磁盘（优先用局部 state 的 outDir，回退到 store 中的 outDir）
    const targetDir = outDir || pipelineStore.getState().outDir;
    if (targetDir) {
      try {
        window.appApi.writeFile(targetDir + '/env-config.json', config);
      } catch (e) {
        console.warn('保存环境配置文件失败:', e);
      }
    }
    setShowEnvForm(false);
    window.appApi.showToast('环境配置已保存', 'success');
  };

  const goToPage = (page) => {
    pipelineStore.setState({ currentPage: page });
  };

  return React.createElement('div', null, [
    React.createElement('div', { className: 'page-header', key: 'h' }, [
      React.createElement('h2', { key: 't' }, '管道处理'),
      React.createElement('div', { className: 'page-header-actions', key: 'a' }, [
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 }, key: 'env-wrap' }, [
          React.createElement('button', {
            className: 'btn' + (envConfig ? ' btn-success' : ''),
            onClick: () => setShowEnvForm(!showEnvForm),
          }, showEnvForm ? '隐藏配置' : '🌐 环境配置'),
          envConfig
            ? React.createElement('span', { className: 'badge badge-success', style: { fontSize: 11 } }, '已识别')
            : React.createElement('span', { className: 'badge badge-warning', style: { fontSize: 11 } }, '待识别'),
        ]),
        React.createElement('button', {
          className: 'btn btn-primary',
          onClick: handleStart,
          disabled: running || !hasRecordings,
        }, running ? '处理中...' : '🚀 启动管道'),
      ]),
    ]),

    // Environment Config
    showEnvForm &&
      React.createElement(EnvForm, {
        envConfig,
        onSave: handleSaveEnv,
        onClose: () => setShowEnvForm(false),
        key: 'env',
      }),

    // 数据池信息展示
    dataPools.length > 0 && React.createElement('div', { className: 'card', key: 'dp' }, [
      React.createElement('div', { className: 'card-header', key: 'h' },
        React.createElement('div', { className: 'card-title', key: 't' }, '📊 数据池 (' + dataPools.length + ')'),
      ),
      React.createElement('div', { key: 'body', style: { padding: '8px 16px', fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap' } },
        dataPools.slice(0, 5).map(p =>
          React.createElement('span', {
            key: p.id,
            style: {
              padding: '4px 10px', borderRadius: 14, fontSize: 11,
              border: '1px solid var(--border)', background: 'var(--surface)',
            },
          }, [
            p.name || '未命名',
            React.createElement('span', { style: { marginLeft: 4, fontSize: 10, color: 'var(--text-secondary)' } },
              `(${p.fieldCount || 0}字段, ${p.rowCount || 0}行)`),
          ])
        ),
        dataPools.length > 5 &&
          React.createElement('span', { style: { fontSize: 11, color: 'var(--text-secondary)', alignSelf: 'center' } },
            `... 还有 ${dataPools.length - 5} 个`),
      ),
    ]),

    // 已保存的环境配置摘要
    envConfig && !showEnvForm &&
      React.createElement('div', { className: 'card', key: 'cfg' }, [
        React.createElement('div', { className: 'card-header', key: 'h' },
          React.createElement('div', { className: 'card-title', key: 't' }, '当前环境配置'),
        ),
        React.createElement('div', { className: 'config-display', key: 'body' }, [
          React.createElement('span', { className: 'label' }, '环境名称'),
          React.createElement('span', { className: 'value' }, envConfig.name || '-'),
          React.createElement('span', { className: 'label' }, 'Base URL'),
          React.createElement('span', { className: 'value', style: { fontFamily: 'monospace' } }, envConfig.baseURL || '-'),
          React.createElement('span', { className: 'label' }, '认证方式'),
          React.createElement('span', { className: 'value' }, envConfig.authType === 'none' ? '无认证' : envConfig.authType),
        ]),
      ]),

    // Pipeline Stepper Progress
    React.createElement(PipelineProgress, { stages, progress, running, key: 'prog' }),

    // Data Summary
    React.createElement('div', { className: 'stats-grid', key: 'sum' }, [
      React.createElement('div', { className: 'stat-card', key: 'clean' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon blue' }, 'K')),
        React.createElement('div', { className: 'stat-value' }, dataSummary.cleaned || '-'),
        React.createElement('div', { className: 'stat-label' }, '清洗后接口数'),
      ]),
      React.createElement('div', { className: 'stat-card', key: 'link' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon cyan' }, 'L')),
        React.createElement('div', { className: 'stat-value' }, dataSummary.linked || '-'),
        React.createElement('div', { className: 'stat-label' }, '关联后接口数'),
      ]),
      React.createElement('div', { className: 'stat-card', key: 'case' }, [
        React.createElement('div', { className: 'stat-card-header' },
          React.createElement('div', { className: 'stat-icon green' }, 'C')),
        React.createElement('div', { className: 'stat-value' }, dataSummary.cases || '-'),
        React.createElement('div', { className: 'stat-label' }, '生成的用例数'),
      ]),
    ]),

    // 完成后操作 — 线性步骤导航
    completed &&
      React.createElement('div', { key: 'post-actions', style: { marginTop: 24 } }, [
        // 步骤指示器
        React.createElement('div', {
          style: {
            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0,
            marginBottom: 20, fontSize: 13,
          },
          key: 'steps',
        }, [
          ['绑定数据', '🔗', !showDataBinding && 'pending', 'data-bind'],
          ['智能审查', '🔍', !showDataBinding && 'active', 'review'],
          ['导出用例', '📤', !showDataBinding && 'pending', 'export'],
        ].map(([label, icon, status, key], idx) =>
          React.createElement(React.Fragment, { key }, [
            idx > 0 && React.createElement('div', {
              style: {
                width: 40, height: 2,
                background: status === 'active' ? 'var(--primary)' : 'var(--border)',
                margin: '0 4px',
              },
            }),
            React.createElement('div', {
              onClick: () => {
                if (key === 'data-bind') setShowDataBinding(!showDataBinding);
                if (key === 'review') goToPage('review');
                if (key === 'export') goToPage('export');
              },
              style: {
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px',
                borderRadius: 20,
                cursor: 'pointer',
                background: status === 'active' ? 'var(--primary)' : 'var(--surface)',
                color: status === 'active' ? '#fff' : 'var(--text)',
                border: '1px solid ' + (status === 'active' ? 'var(--primary)' : 'var(--border)'),
                transition: 'all 0.2s',
                opacity: status === 'pending' ? 0.6 : 1,
                fontWeight: status === 'active' ? 600 : 400,
              },
              onMouseEnter: e => { if (status !== 'active') e.currentTarget.style.borderColor = 'var(--primary)'; },
              onMouseLeave: e => { if (status !== 'active') e.currentTarget.style.borderColor = 'var(--border)'; },
            }, [
              React.createElement('span', { style: { fontSize: 16 } }, icon),
              React.createElement('span', null, label),
            ]),
          ])
        )),

        // Data binding 按钮（步骤下方辅助）
        React.createElement('div', {
          style: { display: 'flex', justifyContent: 'center', gap: 12 },
          key: 'actions',
        }, [
          React.createElement('button', {
            className: 'btn',
            onClick: () => setShowDataBinding(!showDataBinding),
            style: { minWidth: 140, fontSize: 12 },
            key: 'databind',
          }, showDataBinding ? '✕ 关闭绑定' : '🔗 绑定测试数据'),
          React.createElement('button', {
            className: 'btn btn-primary',
            onClick: () => goToPage('review'),
            style: { minWidth: 140, fontSize: 12 },
            key: 'review',
          }, '进入智能审查 →'),
          React.createElement('button', {
            className: 'btn',
            onClick: () => goToPage('import'),
            style: { minWidth: 100, fontSize: 12 },
            key: 'back',
          }, '重新导入'),
        ]),
      ]),

    // Data binding wizard
    showDataBinding && completed && React.createElement(DataBindingWizard, {
      key: 'dbw',
      dataPools,
      records: pipelineResult?.caseVo?.apiVos || [],
      onComplete: async (result) => {
        setShowDataBinding(false);
        if (result && result.mappings) {
          const state = pipelineStore.getState();
          if (state.outDir) {
            try {
              await window.appApi.writeFile(state.outDir + '/data-bindings.json', result);
            } catch (e) {
              console.warn('保存数据绑定失败:', e);
            }
          }

          const iterationMode = result.settings?.iterationMode || 'expand';
          const poolId = result.dataPoolId;

          if (iterationMode === 'expand' && poolId && state.outDir) {
            // 展开模式：重新运行 Assembler 生成多 CaseVo
            try {
              window.appApi.showToast('正在展开数据生成用例...', 'info');
              const poolResult = await window.appApi.dataPoolGet(poolId);
              if (poolResult && poolResult.success && poolResult.pool) {
                const pool = poolResult.pool;
                const expandResult = await window.appApi.rerunAssembler({
                  outDir: state.outDir,
                  dataPoolConfig: pool,
                  iterationMode: 'expand',
                  chainRules: result.chainRules || [],
                });
                if (expandResult && expandResult.success) {
                  // 更新 pipelineStore 中的 result
                  const pr = pipelineStore.getState().pipelineResult || {};
                  // 展开模式可能返回多个 CaseVo，存储完整列表供 ReviewPage/RegressionPage 切换
                  const caseVoArray = Array.isArray(expandResult.caseVo) ? expandResult.caseVo : null;
                  const caseVo = Array.isArray(expandResult.caseVo) ? expandResult.caseVo[0] : expandResult.caseVo;
                  const updatedResult = { ...pr, caseVo, caseVoList: caseVoArray };
                  pipelineStore.setState({ pipelineResult: updatedResult });
                  setPipelineResult(updatedResult);
                  const totalCases = expandResult.stats?.totalCaseCount || expandResult.stats?.rowCount || 0;
                  window.appApi.showToast(
                    '数据展开完成: 生成 ' + totalCases + ' 个用例', 'success');
                } else {
                  window.appApi.showToast('展开失败: ' + (expandResult?.error || '未知错误'), 'error');
                }
              }
            } catch (e) {
              console.warn('展开模式执行失败:', e);
              window.appApi.showToast('展开模式执行失败: ' + e.message, 'error');
            }
          } else if (iterationMode === 'loop' && poolId && state.outDir) {
            // 循环模式：保存数据池配置到 pipelineStore
            try {
              const poolResult = await window.appApi.dataPoolGet(poolId);
              if (poolResult && poolResult.success && poolResult.pool) {
                const pr = pipelineStore.getState().pipelineResult || {};
                const updatedResult = {
                  ...pr,
                  dataPoolConfig: poolResult.pool,
                  iterationMode: 'loop',
                };
                pipelineStore.setState({ pipelineResult: updatedResult });
              }
            } catch (e) {
              console.warn('保存循环模式配置失败:', e);
            }
            window.appApi.showToast('循环模式绑定完成: ' + result.mappings.length + ' 个映射', 'success');
          } else {
            window.appApi.showToast('数据绑定完成: ' + result.mappings.length + ' 个映射', 'success');
          }
        }
      },
      onClose: () => setShowDataBinding(false),
    }),
  ]);
};
