// ReviewPage.js - 智能审查页面
// 功能: 用例编辑、AI 规则审查、规则 CRUD、AI 优化
const ReviewPage = () => {
  const [pipelineResult, setPipelineResult] = React.useState(null);
  const [expanded, setExpanded] = React.useState({});
  const [assertions, setAssertions] = React.useState({});
  const [loading, setLoading] = React.useState(true);

  // 多用例切换（展开模式）
  const [caseList, setCaseList] = React.useState(null);
  const [currentCaseIndex, setCurrentCaseIndex] = React.useState(0);

  // 审查相关
  const [rules, setRules] = React.useState(null);      // 规则定义
  const [ruleConfigs, setRuleConfigs] = React.useState({}); // 规则配置
  const [reviewResult, setReviewResult] = React.useState(null); // 审查结果
  const [reviewing, setReviewing] = React.useState(false);
  const [showRules, setShowRules] = React.useState(false);
  const [useAI, setUseAI] = React.useState(false);
  const [aiAvailable, setAiAvailable] = React.useState(false);

  // API 编辑
  const [selectedApis, setSelectedApis] = React.useState({});
  const [editingApiIdx, setEditingApiIdx] = React.useState(null);
  const [editingApiForm, setEditingApiForm] = React.useState(null);
  const [showBatchEdit, setShowBatchEdit] = React.useState(false);
  const [batchEditMethod, setBatchEditMethod] = React.useState('');

  // AI 优化
  const [optimizing, setOptimizing] = React.useState(false);
  const [swaggerEnriching, setSwaggerEnriching] = React.useState(false);
  const [optimizeResult, setOptimizeResult] = React.useState(null);

  // 候选扫描
  const [candidates, setCandidates] = React.useState([]);
  const [selectedCandidates, setSelectedCandidates] = React.useState({});
  const [showCandidates, setShowCandidates] = React.useState(false);
  // 修改清单
  const [manifest, setManifest] = React.useState([]);
  const [brokenRefs, setBrokenRefs] = React.useState([]);
  const [showManifest, setShowManifest] = React.useState(false);

  // AI 流式日志
  const [aiLog, setAiLog] = React.useState('');
  const aiLogRef = React.useRef('');

  // 规则 CRUD
  const [customRules, setCustomRules] = React.useState([]);
  const [showRuleEditor, setShowRuleEditor] = React.useState(false);
  const [editingRule, setEditingRule] = React.useState(null);

  // 搜索、跳转、多选、拖拽
  const [searchTerm, setSearchTerm] = React.useState('');
  const [jumpToInput, setJumpToInput] = React.useState('');
  const lastClickedRef = React.useRef(-1);
  const listRef = React.useRef(null);
  const dragFromRef = React.useRef(null);

  // 修改追踪：记录当前会话中的修改
  const modificationRecordsRef = React.useRef([]);
  const trackModification = (type, apiIndices, summary, details) => {
    modificationRecordsRef.current.push({
      type, apiIndices, summary, details: details || summary,
    });
  };

  // 加载数据
  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const state = pipelineStore.getState();
        if (state.pipelineResult) {
          setPipelineResult(state.pipelineResult);
          initAssertions(state.pipelineResult);
          // 检查多 CaseVo（展开模式）
          if (state.pipelineResult.caseVoList && Array.isArray(state.pipelineResult.caseVoList)) {
            setCaseList(state.pipelineResult.caseVoList);
          }
        } else if (state.outDir) {
          const result = await window.appApi.readPipelineResult(state.outDir);
          if (result && result.success) {
            setPipelineResult(result);
            pipelineStore.setState({ pipelineResult: result });
            initAssertions(result);
          }
        }

        // 加载规则定义
        const defaultRules = await window.appApi.getReviewRules();
        if (defaultRules && Array.isArray(defaultRules)) {
          setRules(defaultRules);
          const configs = {};
          defaultRules.forEach(r => {
            configs[r.id] = { enabled: r.enabledByDefault !== false, ...r.config };
          });
          // 加载已保存的规则配置并合并（持久化）
          try {
            const savedConfigs = await window.appApi.loadRuleConfigs();
            if (savedConfigs) {
              for (const [ruleId, cfg] of Object.entries(savedConfigs)) {
                if (configs[ruleId]) {
                  configs[ruleId] = { ...configs[ruleId], ...cfg };
                }
              }
            }
          } catch {}
          setRuleConfigs(configs);
        }

        // 检查已保存的审查报告（跳过已被清除的旧报告）
        if (state.outDir) {
          const report = await window.appApi.readReviewReport(state.outDir);
          if (report && !report._cleared) {
            setReviewResult(report);
            if (report.candidates) {
              setCandidates(report.candidates);
              setShowCandidates(report.candidates.length > 0);
            }
          }
        }

        // 检查 AI Provider
        try {
          const providers = await window.appApi.getAiProviders();
          const hasActive = Array.isArray(providers) && providers.some(p => p.isActive);
          setAiAvailable(hasActive);
        } catch { setAiAvailable(false); }
      } catch (e) {
        console.warn('加载审核数据失败:', e);
      }
      setLoading(false);
    })();
  }, []);

  // 监听 AI 流式日志
  React.useEffect(() => {
    const unsub = window.appApi.onReviewAiChunk((chunk) => {
      aiLogRef.current += chunk;
      setAiLog(aiLogRef.current);
    });
    return () => { if (unsub) unsub(); };
  }, []);

  // 规则配置变更时自动持久化（跳过首次加载）
  const isFirstRuleConfig = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRuleConfig.current) {
      isFirstRuleConfig.current = false;
      return;
    }
    window.appApi.saveRuleConfigs(ruleConfigs).catch(() => {});
  }, [ruleConfigs]);

  const initAssertions = (result) => {
    const cv = result?.caseVo;
    if (!cv || !cv.apiVos) return;
    const init = {};
    cv.apiVos.forEach((api, i) => {
      if (api.assertVos) {
        api.assertVos.forEach((_, j) => {
          init[i + '-' + j] = true;
        });
      }
    });
    setAssertions(init);
  };

  const toggleExpand = (idx) => {
    setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleAssertion = (key) => {
    setAssertions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const expandAll = () => {
    const cv = pipelineResult?.caseVo;
    if (!cv?.apiVos) return;
    const all = {};
    cv.apiVos.forEach((_, i) => { all[i] = true; });
    setExpanded(all);
  };

  const collapseAll = () => {
    setExpanded({});
  };

  // ---- 规则配置 ----
  const toggleRule = (ruleId) => {
    setRuleConfigs(prev => ({
      ...prev,
      [ruleId]: { ...prev[ruleId], enabled: !prev[ruleId]?.enabled },
    }));
  };

  const updateRuleConfig = (ruleId, key, value) => {
    setRuleConfigs(prev => ({
      ...prev,
      [ruleId]: { ...prev[ruleId], [key]: value },
    }));
  };

  // ---- 执行审查 ----
  const handleRunReview = async () => {
    const state = pipelineStore.getState();
    const outDir = state.outDir;
    if (!outDir) {
      window.appApi.showToast('无输出目录，请先完成管道处理', 'error');
      return;
    }
    setReviewing(true);
    try {
      const result = await window.appApi.runReview({
        outDir,
        ruleConfigs,
        useAI,
      });
      if (result.success) {
        setReviewResult(result);
        if (result.candidates) {
          setCandidates(result.candidates);
          setShowCandidates(result.candidates.length > 0);
        }
        // 构造审查完成提示，区分 AI 状态
        const aiMsg = (() => {
          const ai = result.aiReview
          if (!ai) return useAI ? '' : '';  // 未开启AI
          if (ai.skipped) return '（AI 已跳过: ' + (ai.message || '未配置 AI Provider') + '）';
          if (ai.error) return '（AI 审查失败: ' + ai.error + '，已降级为规则审查）';
          if (ai.overall_quality) return '（AI 质量评分: ' + ai.overall_quality + '）';
          return '';
        })();
        const toastMsg = '审查完成，发现 ' + (result.stats?.failedCount || 0) + ' 个问题' + (aiMsg ? ' ' + aiMsg : '');
        window.appApi.showToast(toastMsg, result.stats?.failedCount === 0 ? 'success' : 'warning');
      } else {
        window.appApi.showToast('审查失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('审查失败: ' + e.message, 'error');
    }
    setReviewing(false);
  };

  // ---- AI 优化 ----
  const clearAiLog = () => {
    aiLogRef.current = '';
    setAiLog('');
  };

  const handleAiOptimize = async () => {
    clearAiLog();
    const state = pipelineStore.getState();
    const outDir = state.outDir;
    if (!outDir) { window.appApi.showToast('无输出目录', 'error'); return; }
    setOptimizing(true);
    try {
      const cv = pipelineResult?.caseVo;
      const result = await window.appApi.runAiOptimize({ outDir, caseVo: cv, findings: reviewResult?.findings, aiSuggestions: reviewResult?.aiReview?.suggestions });
      if (result.success) {
        setOptimizeResult(result);
        window.appApi.showToast('AI 优化完成', 'success');
      } else {
        window.appApi.showToast('AI 优化失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('AI 优化失败: ' + e.message, 'error');
    }
    setOptimizing(false);
  };

  const applyOptimized = async () => {
    if (!optimizeResult?.optimizedCase) return;
    // 标记所有接口为 AI 优化过
    const optimizedCase = optimizeResult.optimizedCase;
    // 兜底：如果 apiVos 不在预期位置（防御 AI 返回结构异常）
    let apiVos = optimizedCase.apiVos;
    if (!apiVos || !Array.isArray(apiVos)) {
      // 尝试从嵌套字段提取
      for (const key of ['caseVo', 'result', 'data']) {
        if (optimizedCase[key] && Array.isArray(optimizedCase[key].apiVos)) {
          apiVos = optimizedCase[key].apiVos;
          break;
        }
      }
    }
    if (!apiVos || !Array.isArray(apiVos)) {
      window.appApi.showToast('AI 优化结果格式异常，请重试', 'error');
      setOptimizeResult(null);
      return;
    }
    apiVos.forEach(api => { api._aiOptimized = true; });
    const updated = { ...pipelineResult, caseVo: optimizedCase };
    setPipelineResult(updated);
    pipelineStore.setState({ pipelineResult: updated });
    setOptimizeResult(null);
    initAssertions(updated);
    // 整体优化后自动持久化到文件
    const state = pipelineStore.getState();
    if (state.outDir) {
      try {
        const cv = optimizeResult.optimizedCase;
        await window.appApi.writeFile(state.outDir + '/case-save.json', cv);
        await window.appApi.writeFile(state.outDir + '/case-save-review.json', cv);
      } catch (e) {
        console.warn('自动保存 AI 优化结果失败:', e);
      }
    }
    window.appApi.showToast('已应用 AI 优化结果', 'success');
  };

  const rejectOptimized = () => {
    setOptimizeResult(null);
    window.appApi.showToast('已拒绝 AI 优化结果', 'info');
  };

  const handleApplyCandidates = async () => {
    const selectedIds = Object.entries(selectedCandidates)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (selectedIds.length === 0) {
      window.appApi.showToast('请先选择要应用的候选', 'warning');
      return;
    }
    const applyItems = candidates
      .filter(c => selectedIds.includes(c.candidate_id))
      .map(c => ({
        candidate_id: c.candidate_id,
        action: c.action,
        actionPayload: c.actionPayload,
        apiIndex: c.apiIndex,
      }));
    const state = pipelineStore.getState();
    const outDir = state.outDir;
    const caseVo = pipelineResult?.caseVo || state.pipelineResult?.caseVo;
    if (!caseVo || !outDir) {
      window.appApi.showToast('缺少用例数据或输出目录', 'error');
      return;
    }
    // 先检查引用断裂
    try {
      const checkResult = await window.appApi.checkBrokenReferences(caseVo, applyItems);
      if (checkResult.success && checkResult.broken && checkResult.broken.length > 0) {
        setBrokenRefs(checkResult.broken);
        setManifest(checkResult.manifest);
        setShowManifest(true);
        // 仍然继续执行，但提醒用户
        const refMsg = '检测到 ' + checkResult.broken.length + ' 处引用断裂（指向已删除接口），是否继续？';
        if (!confirm(refMsg)) {
          window.appApi.showToast('已取消应用', 'info');
          return;
        }
      } else if (checkResult.success) {
        setBrokenRefs([]);
        setManifest(checkResult.manifest);
      }
    } catch (e) {
      console.warn('引用断裂检查失败:', e);
    }
    try {
      const result = await window.appApi.applyCandidates(outDir, caseVo, applyItems);
      if (result.success) {
        const updated = { ...pipelineResult, caseVo: result.caseVo };
        setPipelineResult(updated);
        pipelineStore.setState({ pipelineResult: updated });
        // 清除已应用的候选
        setCandidates(prev => prev.filter(c => !selectedIds.includes(c.candidate_id)));
        setSelectedCandidates({});
        initAssertions(updated);
        window.appApi.showToast('已应用 ' + selectedIds.length + ' 项候选修改', 'success');
      } else {
        window.appApi.showToast('应用候选失败: ' + (result.error || ''), 'error');
      }
    } catch (e) {
      window.appApi.showToast('应用候选失败: ' + e.message, 'error');
    }
  };

  // ---- Swagger apiName 增强 ----
  const handleSwaggerEnrich = async () => {
    const state = pipelineStore.getState();
    const outDir = state.outDir;
    if (!outDir) { window.appApi.showToast('无输出目录', 'error'); return; }
    const caseVo = pipelineResult?.caseVo || state.pipelineResult?.caseVo;
    if (!caseVo?.apiVos?.length) { window.appApi.showToast('用例为空', 'error'); return; }
    setSwaggerEnriching(true);
    try {
      const result = await window.appApi.swaggerEnrich(outDir, caseVo, '');
      if (result.success && result.enriched) {
        const updated = { ...pipelineResult, caseVo: result.caseVo };
        setPipelineResult(updated);
        pipelineStore.setState({ pipelineResult: updated });
        initAssertions(updated);
        window.appApi.showToast(result.message, 'success');
      } else {
        window.appApi.showToast(result.message || 'Swagger 增强失败', 'info');
      }
    } catch (e) {
      window.appApi.showToast('Swagger 增强失败: ' + e.message, 'error');
    }
    setSwaggerEnriching(false);
  };

  // 单条接口 AI 优化
  const handleAiOptimizeSingle = async (apiIdx) => {
    clearAiLog();
    const state = pipelineStore.getState();
    const outDir = state.outDir;
    if (!outDir) { window.appApi.showToast('无输出目录', 'error'); return; }
    setOptimizing(true);
    try {
      const cv = pipelineResult?.caseVo;
      const result = await window.appApi.runAiOptimizeSingle({
        outDir, caseVo: cv, apiIndex: apiIdx, findings: reviewResult?.findings,
        aiSuggestions: reviewResult?.aiReview?.suggestions,
      });
      if (result.success && result.optimizedApi) {
        // 应用优化结果到当前用例的指定接口
        const updated = { ...pipelineResult };
        if (updated.caseVo.apiVos[apiIdx]) {
          Object.assign(updated.caseVo.apiVos[apiIdx], result.optimizedApi, { _aiOptimized: true });
        }
        setPipelineResult(updated);
        pipelineStore.setState({ pipelineResult: updated });
        initAssertions(updated);
        // 单条优化后自动持久化到文件
        try {
          await window.appApi.writeFile(outDir + '/case-save.json', updated.caseVo);
          await window.appApi.writeFile(outDir + '/case-save-review.json', updated.caseVo);
        } catch (e) {
          console.warn('自动保存单条优化结果失败:', e);
        }
        window.appApi.showToast('AI 单条优化完成', 'success');
      } else {
        window.appApi.showToast('AI 优化失败: ' + (result.error || result.message || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('AI 优化失败: ' + e.message, 'error');
    }
    setOptimizing(false);
  };

  // ---- API 编辑 ----
  const toggleSelectApi = (idx, shiftKey) => {
    if (shiftKey && lastClickedRef.current >= 0) {
      const from = Math.min(lastClickedRef.current, idx);
      const to = Math.max(lastClickedRef.current, idx);
      const newSel = {};
      for (let i = from; i <= to; i++) {
        if (cv?.apiVos?.[i]) newSel[i] = true;
      }
      setSelectedApis(newSel);
    } else {
      setSelectedApis(prev => ({ ...prev, [idx]: !prev[idx] }));
    }
    lastClickedRef.current = idx;
  };

  const toggleSelectAll = () => {
    const cv = pipelineResult?.caseVo;
    if (!cv?.apiVos) return;
    const allSelected = cv.apiVos.every((_, i) => selectedApis[i]);
    if (allSelected) { setSelectedApis({}); return; }
    const newSel = {};
    cv.apiVos.forEach((_, i) => { newSel[i] = true; });
    setSelectedApis(newSel);
  };

  const deleteSelectedApis = async () => {
    const indices = Object.keys(selectedApis).filter(k => selectedApis[k]).map(Number);
    if (indices.length === 0) { window.appApi.showToast('请先选择要删除的接口', 'warning'); return; }
    if (!confirm('确定删除选中的 ' + indices.length + ' 个接口吗？')) return;
    const cv = pipelineResult?.caseVo;
    if (!cv?.apiVos) return;
    indices.sort((a, b) => b - a);
    indices.forEach(i => { cv.apiVos.splice(i, 1); });
    const updated = { ...pipelineResult, caseVo: { ...cv } };
    setPipelineResult(updated);
    pipelineStore.setState({ pipelineResult: updated });
    setSelectedApis({});
    setExpanded({});
    initAssertions(updated);
    // 记录修改标签
    trackModification('delete', indices, '删除了 ' + indices.length + ' 个接口',
      '接口序号: ' + indices.map(i => '#' + (i + 1)).join(', '));
    // 删除后自动持久化到文件
    const state = pipelineStore.getState();
    if (state.outDir) {
      try {
        await window.appApi.writeFile(state.outDir + '/case-save.json', cv);
        await window.appApi.writeFile(state.outDir + '/case-save-review.json', cv);
      } catch (e) {
        console.warn('自动保存删除结果失败:', e);
      }
    }
    window.appApi.showToast('已删除 ' + indices.length + ' 个接口', 'success');
  };

  const startEditApi = (idx) => {
    const api = pipelineResult?.caseVo?.apiVos?.[idx];
    if (!api) return;
    if (!expanded[idx]) setExpanded(prev => ({ ...prev, [idx]: true }));
    setEditingApiIdx(idx);
    const apiScript = api.apiScript || { preRequest: '', postResponse: '' };
    setEditingApiForm({
      apiMethod: api.apiMethod || 'GET',
      apiUrl: api.apiUrl || '',
      requestHeaders: typeof api.requestHeaders === 'object' ? JSON.stringify(api.requestHeaders, null, 2) : (api.requestHeaders || ''),
      requestBody: typeof api.requestBody === 'object' ? JSON.stringify(api.requestBody, null, 2) : (api.requestBody || ''),
      assertVos: api.assertVos ? api.assertVos.map(a => ({ ...a })) : [],
      apiScript: { ...apiScript },
    });
  };

  const saveApiEdit = () => {
    if (editingApiIdx === null || !editingApiForm) return;
    const cv = pipelineResult?.caseVo;
    if (!cv?.apiVos) return;
    const api = cv.apiVos[editingApiIdx];
    api.apiMethod = editingApiForm.apiMethod;
    api.apiUrl = editingApiForm.apiUrl;
    try { api.requestHeaders = JSON.parse(editingApiForm.requestHeaders); } catch { api.requestHeaders = editingApiForm.requestHeaders; }
    try { api.requestBody = JSON.parse(editingApiForm.requestBody); } catch { api.requestBody = editingApiForm.requestBody; }
    api.assertVos = editingApiForm.assertVos;
    api.apiScript = editingApiForm.apiScript || { preRequest: '', postResponse: '' };
    const updated = { ...pipelineResult, caseVo: { ...cv } };
    setPipelineResult(updated);
    pipelineStore.setState({ pipelineResult: updated });
    setEditingApiIdx(null);
    setEditingApiForm(null);
    initAssertions(updated);
    // 记录修改标签
    trackModification('edit', [editingApiIdx], '编辑接口 #' + (editingApiIdx + 1),
      api.apiMethod + ' ' + api.apiUrl);
    window.appApi.showToast('接口已更新', 'success');
  };

  const batchUpdateMethod = () => {
    if (!batchEditMethod) { setShowBatchEdit(false); return; }
    const indices = Object.keys(selectedApis).filter(k => selectedApis[k]).map(Number);
    if (indices.length === 0) { window.appApi.showToast('请先选择接口', 'warning'); return; }
    const cv = pipelineResult?.caseVo;
    if (!cv?.apiVos) return;
    indices.forEach(i => { cv.apiVos[i].apiMethod = batchEditMethod; });
    const updated = { ...pipelineResult, caseVo: { ...cv } };
    setPipelineResult(updated);
    pipelineStore.setState({ pipelineResult: updated });
    setShowBatchEdit(false);
    initAssertions(updated);
    // 记录修改标签
    trackModification('batch_edit', indices, '批量修改 ' + indices.length + ' 个接口的 Method 为 ' + batchEditMethod,
      '接口: ' + indices.map(i => '#' + (i + 1)).join(', '));
    window.appApi.showToast('已批量修改 Method', 'success');
  };

  // ---- 规则 CRUD ----
  const loadCustomRules = async () => {
    try {
      const data = await window.appApi.fileRead('data/review-rules.json');
      if (data) setCustomRules(Array.isArray(data) ? data : []);
    } catch { setCustomRules([]); }
  };

  const handleCreateRule = async () => {
    const newRule = {
      id: 'CUSTOM_' + Date.now(),
      name: editingRule?.name || '新规则',
      description: editingRule?.description || '',
      severity: editingRule?.severity || 'warning',
      enabledByDefault: true,
      config: {},
      checkTemplate: editingRule?.checkTemplate || '(api, apiIndex, context) => {\n  return null;\n}',
    };
    const result = await window.appApi.createReviewRule(newRule);
    if (result.success) {
      window.appApi.showToast('规则已创建', 'success');
      setShowRuleEditor(false);
      setEditingRule(null);
    }
  };

  const handleUpdateRule = async (ruleId, updates) => {
    const result = await window.appApi.updateReviewRule(ruleId, updates);
    if (result.success) {
      window.appApi.showToast('规则已更新', 'success');
      setShowRuleEditor(false);
      setEditingRule(null);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!confirm('确定删除此规则吗？')) return;
    const result = await window.appApi.deleteReviewRule(ruleId);
    if (result.success) {
      window.appApi.showToast('规则已删除', 'success');
      loadCustomRules();
    }
  };

  // ---- 保存 ----
  const handleSave = async () => {
    const cv = pipelineResult?.caseVo;
    if (!cv) return;
    try {
      const state = pipelineStore.getState();
      const outDir = state.outDir;
      if (!outDir) { window.appApi.showToast('无法确定输出目录', 'error'); return; }
      if (cv.apiVos) {
        cv.apiVos.forEach((api, i) => {
          if (api.assertVos) {
            api.assertVos.forEach((assert, j) => {
              assert.enable = assertions[i + '-' + j] ? 1 : 0;
            });
          }
        });
      }
      // 同时保存到两个文件，确保各页面读取的数据一致
      await window.appApi.writeFile(outDir + '/case-save.json', cv);
      await window.appApi.writeFile(outDir + '/case-save-review.json', cv);

      // 提交修改追踪标签
      const records = modificationRecordsRef.current;
      if (records.length > 0) {
        for (const rec of records) {
          await window.appApi.modificationAppend(outDir, {
            stage: 'review',
            type: rec.type,
            apiIndices: rec.apiIndices,
            summary: rec.summary,
            details: rec.details,
          });
        }
        modificationRecordsRef.current = [];
      }

      window.appApi.showToast('审核结果已保存', 'success');
    } catch (e) {
      window.appApi.showToast('保存失败: ' + e.message, 'error');
    }
  };

  const goToPage = (page) => {
    handleSave();
    pipelineStore.setState({ currentPage: page });
  };

  // ---- 统计 ----
  const calcStats = () => {
    const cv = pipelineResult?.caseVo;
    if (!cv?.apiVos) return null;
    const apis = cv.apiVos;
    const methods = {};
    apis.forEach(a => {
      const m = a.apiMethod || 'GET';
      methods[m] = (methods[m] || 0) + 1;
    });
    const passCount = Object.values(assertions).filter(Boolean).length;
    const totalAssertions = Object.keys(assertions).length;
    return { total: apis.length, methods, passCount, totalAssertions };
  };

  const formatJSON = (str) => {
    if (!str) return '';
    try {
      const obj = typeof str === 'string' ? JSON.parse(str) : str;
      return JSON.stringify(obj, null, 2);
    } catch { return String(str); }
  };

  const getApiIssues = (apiIndex) => {
    if (!reviewResult?.findings) return [];
    return reviewResult.findings.filter(f => f.apiIndex === apiIndex && !f.pass);
  };

  const jumpToApi = () => {
    if (!listRef.current || !cv?.apiVos) return;
    const n = parseInt(jumpToInput);
    if (isNaN(n) || n < 1 || n > cv.apiVos.length) {
      window.appApi.showToast('请输入 1-' + cv.apiVos.length + ' 之间的序号', 'warning');
      return;
    }
    const idx = n - 1;
    if (!expanded[idx]) toggleExpand(idx);
    setTimeout(() => {
      const el = listRef.current?.querySelector('.review-card:nth-child(' + n + ')');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow 0.3s';
        el.style.boxShadow = '0 0 0 2px var(--primary)';
        setTimeout(() => { el.style.boxShadow = ''; }, 2000);
      }
    }, 100);
    setJumpToInput('');
  };

  const reorderApi = (fromIdx, toIdx) => {
    const cv = pipelineResult?.caseVo;
    if (!cv?.apiVos) return;
    const [moved] = cv.apiVos.splice(fromIdx, 1);
    cv.apiVos.splice(toIdx, 0, moved);
    const updated = { ...pipelineResult, caseVo: { ...cv } };
    setPipelineResult(updated);
    pipelineStore.setState({ pipelineResult: updated });
    initAssertions(updated);
  };

  const handleDragStart = (e, fromIdx) => {
    dragFromRef.current = fromIdx;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.target.style.opacity = '1';
    dragFromRef.current = null;
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleApiDrop = (e, toIdx) => {
    e.preventDefault();
    const fromIdx = dragFromRef.current;
    if (fromIdx === null || fromIdx === toIdx) return;
    reorderApi(fromIdx, toIdx);
    dragFromRef.current = null;
  };

  // Filtered API indices for search + filter
  const getRuleSource = (rule) => rule.isBuiltin ? '内置' : '用户';
  const isCustomRule = (rule) => !rule.isBuiltin;

  const stats = calcStats();
  const cv = pipelineResult?.caseVo;
  const selectedCount = Object.values(selectedApis).filter(Boolean).length;

  // Filtered API indices for search + display
  const filteredApis = React.useMemo(() => {
    if (!cv?.apiVos) return [];
    return cv.apiVos.map((api, i) => i).filter(i => {
      if (!searchTerm) return true;
      const idxRange = searchTerm.match(/^#(\d+)(?:-(\d+))?$/);
      if (idxRange) {
        const start = parseInt(idxRange[1]) - 1;
        const end = idxRange[2] ? parseInt(idxRange[2]) - 1 : start;
        return i >= start && i <= end;
      }
      const multiIdx = searchTerm.match(/^#(\d+(?:,#\d+)*)$/);
      if (multiIdx) {
        const indices = searchTerm.split(',').map(s => parseInt(s.replace('#', '')) - 1);
        return indices.includes(i);
      }
      const api = cv.apiVos[i];
      const urlPart = (api.domainName || '') + (api.apiUrl || '');
      return urlPart.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [cv?.apiVos, searchTerm]);

  if (loading) {
    return React.createElement('div', { className: 'page-loading' }, '加载中...');
  }

  if (!cv || !cv.apiVos || cv.apiVos.length === 0) {
    return React.createElement('div', null, [
      React.createElement('div', { className: 'page-header', key: 'h' }, [
        React.createElement('h2', { key: 't' }, '智能审查'),
      ]),
      React.createElement('div', { className: 'empty-state', key: 'e' }, [
        React.createElement('span', { className: 'empty-state-icon', key: 'ic' }, 'i'),
        React.createElement('h3', { key: 't' }, '暂无数据'),
        React.createElement('p', { key: 'd' }, '请先完成管道处理，生成用例后再来审查'),
      ]),
      React.createElement('div', { style: { textAlign: 'center', marginTop: 16 }, key: 'back' },
        React.createElement('button', { className: 'btn btn-primary', onClick: () => goToPage('pipeline') }, '返回管道处理')
      ),
    ]);
  }

  return React.createElement('div', null, [
    // Header
    React.createElement('div', { className: 'page-header', key: 'h' }, [
      React.createElement('h2', { key: 't' }, '智能审查'),
      // 展开模式 Case 选择器
      caseList && caseList.length > 1 && React.createElement('div', {
        key: 'case-sel',
        style: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16 },
      }, [
        React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary)' } }, '用例:'),
        React.createElement('select', {
          value: currentCaseIndex,
          onChange: e => {
            const idx = parseInt(e.target.value);
            setCurrentCaseIndex(idx);
            if (caseList[idx]) {
              const updated = { ...pipelineResult, caseVo: caseList[idx] };
              setPipelineResult(updated);
              pipelineStore.setState({ pipelineResult: updated });
              initAssertions(updated);
              setExpanded({});
              setSearchTerm('');
            }
          },
          style: { padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--bg)', color: 'var(--text)' },
        }, caseList.map((c, i) =>
          React.createElement('option', { key: i, value: i },
            (c.name || '用例 ' + (i + 1)) + (i === currentCaseIndex ? ' (当前)' : ''))
        )),
        React.createElement('span', { style: { fontSize: 11, color: 'var(--text-tertiary)' } },
          caseList.length + ' 个'),
      ]),
      React.createElement('div', { className: 'page-header-actions', key: 'a' }, [
        selectedCount > 0 && React.createElement('span', { style: { fontSize: 13, color: 'var(--warning)', marginRight: 8 }, key: 'sc' }, '已选 ' + selectedCount),
        React.createElement('button', { className: 'btn btn-sm', onClick: expandAll, key: 'expand' }, '展开全部'),
        React.createElement('button', { className: 'btn btn-sm', onClick: collapseAll, key: 'collapse' }, '折叠全部'),
      ]),
    ]),

    // Review Action Bar
    React.createElement('div', { className: 'review-action-bar', key: 'action-bar' }, [
      React.createElement('div', { className: 'review-action-buttons', key: 'btns' }, [
        // Execute review
        React.createElement('button', {
          className: 'btn btn-primary btn-lg', onClick: handleRunReview, disabled: reviewing, key: 'review',
          style: { minWidth: 160 },
        }, reviewing ? '审查中...' : '执行审查'),
        // AI toggle
        React.createElement('label', {
          className: 'review-ai-toggle', key: 'ai',
          style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', opacity: aiAvailable ? 1 : 0.4 },
        }, [
          React.createElement('input', { type: 'checkbox', checked: useAI, onChange: () => setUseAI(!useAI), disabled: !aiAvailable, key: 'cb' }),
          React.createElement('span', { key: 'l' }, 'AI 深度审查'),
          !aiAvailable && React.createElement('span', { className: 'badge badge-warning', key: 'hint', title: '请在设置中配置 AI Provider' }, '未配置'),
        ]),
        // Rules
        React.createElement('button', {
          className: 'btn btn-sm', onClick: () => { setShowRules(!showRules); if (!showRules) loadCustomRules(); }, key: 'rules',
        }, showRules ? '隐藏规则' : '审查规则'),
        // AI Optimize (after review)
        reviewResult && React.createElement('button', {
          className: 'btn btn-sm', onClick: handleAiOptimize, disabled: optimizing, key: 'optimize',
          style: { background: 'var(--purple, #8b5cf6)', color: '#fff' },
        }, optimizing ? '优化中...' : 'AI 优化'),
        // Swagger 增强
        React.createElement('button', {
          className: 'btn btn-sm', onClick: handleSwaggerEnrich, disabled: swaggerEnriching || !reviewResult, key: 'swagger',
          style: { background: 'var(--blue, #3b82f6)', color: '#fff' },
        }, swaggerEnriching ? '获取中...' : 'Swagger 增强'),
      ]),

      // 审查结果摘要
      reviewResult?.stats && React.createElement('div', { className: 'review-result-summary', key: 'summary' }, [
        React.createElement('span', {
          className: 'review-result-badge ' + (reviewResult.stats.failedCount === 0 ? 'pass' : reviewResult.stats.errors > 0 ? 'error' : 'warning'),
          key: 'b',
        }, ['通过率 ' + reviewResult.stats.passRate + '% (' + (reviewResult.stats.failedCount || 0) + ' 个问题)']),
        reviewResult.stats.errors > 0 && React.createElement('span', { className: 'review-result-badge error', key: 'err' }, reviewResult.stats.errors + ' 个错误'),
        reviewResult.stats.warnings > 0 && React.createElement('span', { className: 'review-result-badge warning', key: 'warn' }, reviewResult.stats.warnings + ' 个警告'),
      ]),

      // AI 审查结果
      reviewResult?.aiReview && !reviewResult.aiReview.error && !reviewResult.aiReview.skipped && React.createElement('div', {
        className: 'review-ai-result', key: 'ai-result',
      }, [
        React.createElement('div', { className: 'review-ai-quality ' + (reviewResult.aiReview.overall_quality || 'fair'), key: 'q' },
          'AI 质量评分: ' + (reviewResult.aiReview.overall_quality === 'good' ? '良好' : reviewResult.aiReview.overall_quality === 'fair' ? '一般' : '较差')),
        React.createElement('p', { key: 's', style: { fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}, reviewResult.aiReview.summary || ''),
      ]),

      // AI 优化结果提示
      optimizeResult?.optimizedCase && React.createElement('div', {
        className: 'review-ai-result', key: 'opt-result',
        style: { background: 'var(--bg-success)', marginTop: 8 },
      }, [
        React.createElement('p', { key: 'msg', style: { fontSize: 13 }}, 'AI 优化已完成，请确认是否应用？'),
        React.createElement('div', { key: 'btns', style: { display: 'flex', gap: 8, marginTop: 4 }}, [
          React.createElement('button', { className: 'btn btn-sm', onClick: applyOptimized, style: { background: '#27ae60', color: '#fff' }}, '应用优化'),
          React.createElement('button', { className: 'btn btn-sm', onClick: rejectOptimized }, '拒绝'),
        ]),
      ]),
    ]),

      // 候选扫描结果
      candidates.length > 0 && React.createElement('div', {
        className: 'review-candidates-panel', key: 'candidates',
        style: { marginTop: 8, border: '1px solid var(--border)', borderRadius: 6, padding: 12, background: 'var(--bg-secondary, #f8f9fa)' },
      }, [
        React.createElement('div', { key: 'hdr', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } }, [
          React.createElement('h4', { key: 't', style: { margin: 0, fontSize: 14 } }, '候选扫描（' + candidates.length + ' 项建议）'),
          React.createElement('div', { key: 'actions', style: { display: 'flex', gap: 8 } }, [
            React.createElement('button', {
              className: 'btn btn-sm',
              onClick: () => {
                const all = {};
                candidates.forEach(c => { all[c.candidate_id] = true; });
                setSelectedCandidates(all);
              },
              style: { fontSize: 11 },
              key: 'sa',
            }, '全选'),
            React.createElement('button', {
              className: 'btn btn-sm',
              onClick: () => setSelectedCandidates({}),
              style: { fontSize: 11 },
              key: 'da',
            }, '取消'),
            React.createElement('button', {
              className: 'btn btn-sm', onClick: handleApplyCandidates, key: 'apply',
              style: { background: '#27ae60', color: '#fff' },
            }, '应用选中'),
          ]),
        ]),
        React.createElement('div', { key: 'list', style: { maxHeight: 300, overflowY: 'auto' } },
          candidates.map(c => React.createElement('div', {
            key: c.candidate_id,
            style: {
              padding: '6px 8px', marginBottom: 4, borderRadius: 4,
              background: selectedCandidates[c.candidate_id] ? 'var(--bg-selected, #e8f5e9)' : 'var(--bg)',
              border: '1px solid var(--border)',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            },
            onClick: () => {
              setSelectedCandidates(prev => ({
                ...prev,
                [c.candidate_id]: !prev[c.candidate_id],
              }));
            },
          }, [
            React.createElement('input', {
              type: 'checkbox',
              checked: !!selectedCandidates[c.candidate_id],
              readOnly: true,
              style: { marginTop: 2 },
              key: 'cb',
            }),
            React.createElement('div', { key: 'body', style: { flex: 1 } }, [
              React.createElement('div', { key: 'label', style: { fontWeight: 600, marginBottom: 2 } }, [
                c.label || c.type,
                React.createElement('span', {
                  key: 'tag',
                  style: {
                    marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 3,
                    background: c.severity === 'warning' ? '#fff3cd' : '#e3f2fd',
                    color: c.severity === 'warning' ? '#856404' : '#1565c0',
                  },
                }, c.type),
                React.createElement('span', { key: 'api', style: { marginLeft: 6, color: 'var(--text-secondary)', fontSize: 11 } },
                  c.apiName ? (c.apiName + (c.apiUrl ? ': ' + c.apiUrl.substring(0, 40) : '')) : ''),
              ]),
              React.createElement('div', { key: 'detail', style: { color: 'var(--text-secondary)', fontSize: 11, marginTop: 2 } }, [
                React.createElement('span', { key: 'loc', style: { marginRight: 8 } }, '位置: ' + (c.location || '')),
                c.current_value && React.createElement('span', { key: 'val', style: { marginRight: 8 } }, '当前值: ' + c.current_value),
              ]),
              c.suggestion && React.createElement('div', { key: 'sug', style: { fontSize: 11, color: '#2e7d32', marginTop: 2 } }, c.suggestion),
            ]),
          ]))
        ),
      ]),

      // 修改清单面板
      (manifest.length > 0 || brokenRefs.length > 0) && React.createElement('div', {
        className: 'review-manifest-panel', key: 'manifest',
        style: { marginTop: 8, border: '1px solid #e74c3c', borderRadius: 6, padding: 12, background: '#fdf2f2' },
      }, [
        React.createElement('div', { key: 'hdr', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } }, [
          React.createElement('h4', { key: 't', style: { margin: 0, fontSize: 14, color: '#e74c3c' } }, '修改清单'),
          React.createElement('button', {
            className: 'btn btn-sm', onClick: () => { setShowManifest(!showManifest); }, key: 'toggle',
          }, showManifest ? '折叠' : '展开'),
        ]),
        showManifest && React.createElement('div', { key: 'body' }, [
          // 引用断裂警告
          brokenRefs.length > 0 && React.createElement('div', { key: 'broken', style: { marginBottom: 8 } }, [
            React.createElement('div', { style: { fontWeight: 600, color: '#e74c3c', marginBottom: 4, fontSize: 13 } },
              '⚠ 检测到 ' + brokenRefs.length + ' 处引用断裂'),
            React.createElement('div', { style: { fontSize: 12, maxHeight: 120, overflowY: 'auto' } },
              brokenRefs.map((br, i) => React.createElement('div', {
                key: i, style: { padding: '2px 0', color: '#c0392b' },
              }, [
                React.createElement('span', { style: { fontWeight: 600 } }, '接口 ' + (br.apiIndex + 1) + '.' + (br.apiName || '')),
                ' 引用了已删除的 seq.' + br.refSeq,
              ]))
            ),
          ]),
          // 修改项列表
          manifest.length > 0 && React.createElement('div', { key: 'items' }, [
            React.createElement('div', { style: { fontWeight: 600, marginBottom: 4, fontSize: 13 } }, '待执行修改：'),
            React.createElement('div', { style: { fontSize: 12, maxHeight: 150, overflowY: 'auto' } },
              manifest.map((m, i) => React.createElement('div', {
                key: i, style: { padding: '2px 0' },
              }, m.label || (m.action + ' 接口 ' + (m.apiIndex + 1))))
            ),
          ]),
        ]),
      ]),

    // Rules Editor Panel
    showRules && rules && React.createElement('div', { className: 'review-rules-panel', key: 'rules-panel' }, [
      React.createElement('div', { className: 'review-rules-header', key: 'hdr' }, [
        React.createElement('h4', { key: 't' }, '审查规则管理'),
        React.createElement('div', { key: 'a', style: { display: 'flex', gap: 8 }}, [
          React.createElement('button', {
            className: 'btn btn-sm', onClick: () => { setEditingRule({}); setShowRuleEditor(true); }, key: 'add',
            style: { background: 'var(--primary)', color: '#fff' },
          }, '+ 新增规则'),
          React.createElement('button', { className: 'btn btn-sm', onClick: () => setShowRules(false), key: 'c' }, 'x'),
        ]),
      ]),
      React.createElement('div', { className: 'review-rules-list', key: 'list' },
        rules.map(rule => {
          const cfg = ruleConfigs[rule.id] || { enabled: rule.enabledByDefault };
          return React.createElement('div', {
            className: 'review-rule-item' + (cfg.enabled ? ' enabled' : ''),
            key: rule.id,
          }, [
            React.createElement('div', { className: 'review-rule-toggle', onClick: () => toggleRule(rule.id), key: 'tgl' },
              React.createElement('input', { type: 'checkbox', checked: cfg.enabled, readOnly: true }),
            ),
            React.createElement('div', { className: 'review-rule-info', key: 'info' }, [
              React.createElement('div', { className: 'review-rule-name', key: 'n' }, [
                rule.name,
                React.createElement('span', { className: 'severity-badge severity-' + rule.severity, key: 's' }, rule.severity),
                React.createElement('span', { style: { fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }, key: 'src' }, getRuleSource(rule)),
              ]),
              React.createElement('div', { className: 'review-rule-desc', key: 'd' }, rule.description),
            ]),
            React.createElement('div', { className: 'review-rule-actions', key: 'actions', style: { display: 'flex', gap: 4 }}, [
              React.createElement('button', {
                className: 'btn btn-sm', onClick: () => { setEditingRule(rule); setShowRuleEditor(true); }, key: 'edit',
                style: { fontSize: 11 },
              }, '编辑'),
              !rule.isBuiltin && React.createElement('button', {
                className: 'btn btn-sm', onClick: () => handleDeleteRule(rule.id), key: 'del',
                style: { fontSize: 11, color: '#e74c3c' },
              }, '删除'),
            ]),
          ]);
        })
      ),
    ]),

    // Batch edit modal
    showBatchEdit && React.createElement('div', { className: 'modal-overlay', key: 'batch-modal',
      style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
      onClick: () => setShowBatchEdit(false),
    }, React.createElement('div', {
      className: 'modal-content', style: { background: 'var(--bg)', padding: 24, borderRadius: 8, minWidth: 300 },
      onClick: e => e.stopPropagation(),
    }, [
      React.createElement('h4', { key: 't', style: { marginBottom: 12 }}, '批量修改 Method'),
      React.createElement('select', {
        value: batchEditMethod, onChange: e => setBatchEditMethod(e.target.value), key: 'sel',
        style: { width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 14, marginBottom: 12, background: 'var(--bg)', color: 'var(--text)' },
      }, ['', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => React.createElement('option', { key: m, value: m }, m || '-- 选择 --'))),
      React.createElement('div', { key: 'btns', style: { display: 'flex', gap: 8, justifyContent: 'flex-end' }}, [
        React.createElement('button', { className: 'btn btn-sm', onClick: () => setShowBatchEdit(false) }, '取消'),
        React.createElement('button', { className: 'btn btn-primary btn-sm', onClick: batchUpdateMethod }, '确认修改'),
      ]),
    ])),

    // Rule editor modal
    showRuleEditor && React.createElement('div', { className: 'modal-overlay', key: 'rule-modal',
      style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
      onClick: () => { setShowRuleEditor(false); setEditingRule(null); },
    }, React.createElement('div', {
      className: 'modal-content', style: { background: 'var(--bg)', padding: 24, borderRadius: 8, minWidth: 500, maxWidth: 700 },
      onClick: e => e.stopPropagation(),
    }, [
      React.createElement('h4', { key: 't', style: { marginBottom: 16 }}, editingRule?.id ? '编辑规则' : '新增规则'),
      // Name
      React.createElement('div', { key: 'n', style: { marginBottom: 12 }}, [
        React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}, '规则名称'),
        React.createElement('input', {
          type: 'text', value: editingRule?.name || '',
          onChange: e => setEditingRule({ ...editingRule, name: e.target.value }),
          style: { width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
        }),
      ]),
      // Severity + Description row
      React.createElement('div', { key: 'sd', style: { display: 'flex', gap: 12, marginBottom: 12 }}, [
        React.createElement('div', { key: 'sev', style: { flex: 1 }}, [
          React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}, '级别'),
          React.createElement('select', {
            value: editingRule?.severity || 'warning',
            onChange: e => setEditingRule({ ...editingRule, severity: e.target.value }),
            style: { width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
          }, ['error', 'warning', 'info'].map(s => React.createElement('option', { key: s, value: s }, s))),
        ]),
        React.createElement('div', { key: 'desc', style: { flex: 2 }}, [
          React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}, '描述'),
          React.createElement('input', {
            type: 'text', value: editingRule?.description || '',
            onChange: e => setEditingRule({ ...editingRule, description: e.target.value }),
            style: { width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
          }),
        ]),
      ]),
      // Check template
      React.createElement('div', { key: 'ct', style: { marginBottom: 16 }}, [
        React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}, '检查逻辑 (JavaScript 函数)'),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}, '返回 null 表示通过，返回 { pass: false, message: "..." } 表示失败'),
        React.createElement('textarea', {
          value: editingRule?.checkTemplate || '',
          onChange: e => setEditingRule({ ...editingRule, checkTemplate: e.target.value }),
          style: { width: '100%', minHeight: 120, padding: 8, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' },
          placeholder: '(api, apiIndex, context) => {\n  // 检查逻辑\n  return null;\n}',
        }),
      ]),
      // Buttons
      React.createElement('div', { key: 'btns', style: { display: 'flex', gap: 8, justifyContent: 'flex-end' }}, [
        React.createElement('button', { className: 'btn btn-sm', onClick: () => { setShowRuleEditor(false); setEditingRule(null); }}, '取消'),
        editingRule?.id
          ? React.createElement('button', { className: 'btn btn-primary btn-sm', onClick: () => handleUpdateRule(editingRule.id, editingRule) }, '保存规则')
          : React.createElement('button', { className: 'btn btn-primary btn-sm', onClick: handleCreateRule }, '创建规则'),
      ]),
    ])),

    // Summary
    stats && React.createElement('div', { className: 'stats-grid', key: 'stats' }, [
      React.createElement('div', { className: 'stat-card', key: 'total' }, [
        React.createElement('div', { className: 'stat-card-header' }, React.createElement('div', { className: 'stat-icon blue' }, 'API')),
        React.createElement('div', { className: 'stat-value' }, stats.total),
        React.createElement('div', { className: 'stat-label' }, '接口数'),
      ]),
      ...Object.entries(stats.methods).slice(0, 4).map(([m, c], i) =>
        React.createElement('div', { className: 'stat-card', key: 'm-' + i }, [
          React.createElement('div', { className: 'stat-card-header' }, React.createElement('div', { className: 'stat-icon ' + (m === 'GET' ? 'green' : 'blue') }, m)),
          React.createElement('div', { className: 'stat-value' }, c),
          React.createElement('div', { className: 'stat-label' }, m),
        ])
      ),
      React.createElement('div', { className: 'stat-card', key: 'assert' }, [
        React.createElement('div', { className: 'stat-card-header' }, React.createElement('div', { className: 'stat-icon green' }, '断言')),
        React.createElement('div', { className: 'stat-value' }, stats.passCount + '/' + stats.totalAssertions),
        React.createElement('div', { className: 'stat-label' }, '断言通过'),
      ]),
    ]),

    // Case info + Batch actions
    React.createElement('div', { className: 'card', key: 'info' }, [
      React.createElement('div', { className: 'card-header', key: 'h' }, [
        React.createElement('div', { className: 'card-title', key: 't' }, [
          '用例名称: ' + (cv.name || '-'),
          React.createElement('span', { className: 'badge', key: 'b' }, cv.domainName || ''),
        ]),
        React.createElement('div', { key: 'batch', style: { display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}, [
          // Search
          React.createElement('input', {
            type: 'text', key: 'search',
            placeholder: '搜索 URL 或 #序号...',
            value: searchTerm,
            onChange: e => setSearchTerm(e.target.value),
            style: { flex: 1, maxWidth: 240, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--bg)', color: 'var(--text)' },
          }),
          // Jump
          React.createElement('input', {
            type: 'text', key: 'jump',
            placeholder: '#跳转',
            value: jumpToInput,
            onChange: e => setJumpToInput(e.target.value.replace(/[^0-9]/g, '')),
            onKeyDown: e => { if (e.key === 'Enter') jumpToApi(); },
            style: { width: 70, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--bg)', color: 'var(--text)' },
          }),
          React.createElement('button', {
            className: 'btn btn-sm', key: 'jumpBtn',
            onClick: jumpToApi,
            style: { padding: '2px 8px', fontSize: 12 },
          }, '跳转'),
          searchTerm && React.createElement('span', { key: 'fc', style: { fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }},
            '过滤: ' + filteredApis.length + '/' + (cv.apiVos || []).length),
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}, [
            React.createElement('input', { type: 'checkbox', checked: selectedCount > 0 && selectedCount === (cv.apiVos || []).length, onChange: toggleSelectAll }),
            '全选',
          ]),
          React.createElement('button', {
            className: 'btn btn-sm', onClick: deleteSelectedApis, disabled: selectedCount === 0,
            style: { color: selectedCount > 0 ? '#e74c3c' : 'var(--text-secondary)' },
          }, '删除选中(' + selectedCount + ')'),
          React.createElement('button', {
            className: 'btn btn-sm', onClick: () => setShowBatchEdit(true), disabled: selectedCount === 0,
          }, '批量修改 Method'),
        ]),
      ]),
    ]),

    // API list
    React.createElement('div', { className: 'review-list', key: 'list', ref: listRef },
      filteredApis.map(i => {
        const api = cv.apiVos[i];
        const issues = getApiIssues(i);
        const hasIssues = issues.length > 0;
        return React.createElement('div', {
          className: 'review-card' + (expanded[i] ? ' expanded' : '') + (hasIssues ? ' has-issues' : '') + (api._aiOptimized ? ' ai-optimized' : ''),
          key: i,
          style: api._aiOptimized ? { borderLeft: '3px solid #8b5cf6', background: 'linear-gradient(90deg, rgba(139,92,246,0.06), transparent)' } : {},
          draggable: true,
          onDragStart: e => handleDragStart(e, i),
          onDragEnd: handleDragEnd,
          onDragOver: handleDragOver,
          onDrop: e => handleApiDrop(e, i),
        }, [
          // Header
          React.createElement('div', {
            className: 'review-card-header',
            onClick: () => toggleExpand(i),
            style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'grab' },
          }, [
            // Checkbox (stop propagation)
            React.createElement('input', {
              type: 'checkbox', checked: !!selectedApis[i],
              onClick: e => {
                e.stopPropagation();
                toggleSelectApi(i, e.shiftKey);
                const shiftEl = listRef.current?.querySelector('.review-card:nth-child(' + (filteredApis.indexOf(i) + 1) + ')');
              },
              key: 'cb',
            }),
            // Summary
            React.createElement('div', { className: 'review-card-summary', key: 'sum', style: { flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}, [
              React.createElement('span', { className: 'method-badge method-' + (api.apiMethod || 'GET').toLowerCase() }, api.apiMethod || 'GET'),
              React.createElement('span', { className: 'review-card-path' }, api.domainName + (api.apiUrl || '')),
              React.createElement('span', { className: 'tag tag-info', style: { marginRight: 4, fontSize: 11 }}, '#' + (i + 1)),
                api._aiOptimized && React.createElement('span', {
                  style: { fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#8b5cf6', color: '#fff', marginRight: 4 },
                }, 'AI'),
              hasIssues && React.createElement('span', {
                className: 'issue-badge issue-' + issues[0].severity, key: 'ib', title: issues[0].message,
                onClick: e => {
                  e.stopPropagation();
                  if (!expanded[i]) toggleExpand(i);
                  setTimeout(() => {
                    const el = listRef.current?.querySelector('.review-card:nth-child(' + (filteredApis.indexOf(i) + 1) + ')');
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 100);
                },
              }, issues.length + ' 个问题'),
            ]),
            // Edit button
            React.createElement('button', {
              className: 'btn btn-sm', key: 'edit',
              onClick: e => { e.stopPropagation(); if (editingApiIdx === i) { setEditingApiIdx(null); setEditingApiForm(null); } else { startEditApi(i); } },
              style: { padding: '2px 8px', fontSize: 12 },
            }, editingApiIdx === i ? '取消' : '编辑'),
            // AI 单条优化
            React.createElement('button', {
              className: 'btn btn-sm', key: 'ai-opt',
              onClick: e => { e.stopPropagation(); handleAiOptimizeSingle(i); },
              disabled: optimizing,
              style: { padding: '2px 8px', fontSize: 12, background: 'var(--purple, #8b5cf6)', color: '#fff' },
            }, '单条AI'),
            // Arrow
            React.createElement('span', { className: 'review-card-arrow', key: 'arrow' }, expanded[i] ? 'v' : '>'),
          ]),

          // Expanded content
          expanded[i] && React.createElement('div', { className: 'review-card-body' }, [
            // Issues
            hasIssues && React.createElement('div', { className: 'review-issues', key: 'issues' },
              issues.map((issue, j) =>
                React.createElement('div', { className: 'review-issue-item issue-' + issue.severity, key: j }, [
                  React.createElement('span', { className: 'review-issue-icon', key: 'ic' },
                    issue.severity === 'error' ? 'x' : issue.severity === 'warning' ? '!' : 'i'),
                  React.createElement('span', { className: 'review-issue-text', key: 'txt' }, [
                    React.createElement('strong', { key: 'rn' }, issue.ruleName + ': '),
                    React.createElement('span', { key: 'msg' }, issue.message),
                  ]),
                ])
              )
            ),

            // If editing this API, show editable form
            editingApiIdx === i ? React.createElement('div', { key: 'edit-form' }, [
              // Method + URL
              React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 8 }}, [
                React.createElement('select', {
                  value: editingApiForm?.apiMethod || 'GET',
                  onChange: e => setEditingApiForm({ ...editingApiForm, apiMethod: e.target.value }),
                  style: { padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', width: 100 },
                }, ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => React.createElement('option', { key: m, value: m }, m))),
                React.createElement('input', {
                  type: 'text', value: editingApiForm?.apiUrl || '',
                  onChange: e => setEditingApiForm({ ...editingApiForm, apiUrl: e.target.value }),
                  style: { flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' },
                  placeholder: 'API URL',
                  autoFocus: true,
                }),
              ]),
              // Headers
              React.createElement('div', { style: { marginBottom: 8 }}, [
                React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}, '请求头 (JSON)'),
                React.createElement('textarea', {
                  value: editingApiForm?.requestHeaders || '',
                  onChange: e => setEditingApiForm({ ...editingApiForm, requestHeaders: e.target.value }),
                  style: { width: '100%', minHeight: 60, padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' },
                }),
              ]),
              // Body
              api.requestBody && React.createElement('div', { style: { marginBottom: 8 }}, [
                React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}, '请求体 (JSON)'),
                React.createElement('textarea', {
                  value: editingApiForm?.requestBody || '',
                  onChange: e => setEditingApiForm({ ...editingApiForm, requestBody: e.target.value }),
                  style: { width: '100%', minHeight: 80, padding: 6, borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' },
                }),
              ]),
              // Assertions (editable)
              React.createElement('div', { style: { marginBottom: 8 }}, [
                React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}, [
                  React.createElement('span', { key: 't' }, '断言 (' + (editingApiForm?.assertVos?.length || 0) + ')'),
                  React.createElement('button', {
                    className: 'btn btn-sm',
                    onClick: () => {
                      const newAssert = { expression: '', expectValue: '', delay: 0, logicType: 1, validateType: 3 };
                      setEditingApiForm({ ...editingApiForm, assertVos: [...(editingApiForm?.assertVos || []), newAssert] });
                    },
                    key: 'add',
                    style: { fontSize: 11 },
                  }, '+ 添加断言'),
                ]),
                React.createElement('div', { style: { maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }},
                  (editingApiForm?.assertVos || []).map((assert, j) =>
                    React.createElement('div', { key: j, style: { display: 'flex', gap: 4, alignItems: 'center' }}, [
                      React.createElement(VariableSelector, {
                        mode: 'dropdown', label: '表达式 ▼',
                        onSelect: (varExpr) => {
                          const newVos = [...editingApiForm.assertVos];
                          newVos[j] = { ...newVos[j], expression: (newVos[j].expression || '') + varExpr };
                          setEditingApiForm({ ...editingApiForm, assertVos: newVos });
                        },
                        context: {},
                        buttonStyle: { padding: '2px 6px', fontSize: 10 },
                        compact: true,
                      }),
                      React.createElement('input', {
                        type: 'text', value: assert.expression || '',
                        onChange: e => {
                          const newVos = [...editingApiForm.assertVos];
                          newVos[j] = { ...newVos[j], expression: e.target.value };
                          setEditingApiForm({ ...editingApiForm, assertVos: newVos });
                        },
                        placeholder: 'responseBody.code',
                        style: { flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)' },
                      }),
                      React.createElement(VariableSelector, {
                        mode: 'dropdown', label: '期望值 ▼',
                        onSelect: (varExpr) => {
                          const newVos = [...editingApiForm.assertVos];
                          newVos[j] = { ...newVos[j], expectValue: (newVos[j].expectValue || '') + varExpr };
                          setEditingApiForm({ ...editingApiForm, assertVos: newVos });
                        },
                        context: {},
                        buttonStyle: { padding: '2px 6px', fontSize: 10 },
                        compact: true,
                      }),
                      React.createElement('input', {
                        type: 'text', value: assert.expectValue || '',
                        onChange: e => {
                          const newVos = [...editingApiForm.assertVos];
                          newVos[j] = { ...newVos[j], expectValue: e.target.value };
                          setEditingApiForm({ ...editingApiForm, assertVos: newVos });
                        },
                        placeholder: '200',
                        style: { flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)' },
                      }),
                      React.createElement('button', {
                        onClick: () => {
                          const newVos = editingApiForm.assertVos.filter((_, k) => k !== j);
                          setEditingApiForm({ ...editingApiForm, assertVos: newVos });
                        },
                        style: { border: 'none', background: 'transparent', color: '#e74c3c', cursor: 'pointer', fontSize: 16, padding: '2px 6px', lineHeight: 1 },
                        title: '删除断言',
                      }, '×'),
                    ])
                  ),
                ),
              ]),
              // 脚本编辑
              React.createElement(ScriptEditor, {
                key: 'script',
                preRequest: editingApiForm?.apiScript?.preRequest || '',
                postResponse: editingApiForm?.apiScript?.postResponse || '',
                onPreRequestChange: (val) => {
                  setEditingApiForm({
                    ...editingApiForm,
                    apiScript: { ...(editingApiForm.apiScript || {}), preRequest: val },
                  });
                },
                onPostResponseChange: (val) => {
                  setEditingApiForm({
                    ...editingApiForm,
                    apiScript: { ...(editingApiForm.apiScript || {}), postResponse: val },
                  });
                },
                compact: true,
              }),
              // Save
              React.createElement('button', { className: 'btn btn-primary btn-sm', onClick: saveApiEdit }, '保存修改'),
            ]) : [
              // Read-only view (original)
              React.createElement('div', { className: 'review-field', key: 'headers' }, [
                React.createElement('div', { className: 'review-field-label' }, '请求头'),
                React.createElement('pre', { className: 'review-code' }, formatJSON(api.requestHeaders)),
              ]),
              api.requestBody ? React.createElement('div', { className: 'review-field', key: 'body' }, [
                React.createElement('div', { className: 'review-field-label' }, '请求体'),
                React.createElement('pre', { className: 'review-code' }, formatJSON(api.requestBody)),
              ]) : null,
            ],

            // Assertion toggle (only when NOT editing this API)
            editingApiIdx !== i && api.assertVos && api.assertVos.length > 0 && React.createElement('div', { className: 'review-field', key: 'asserts' }, [
              React.createElement('div', { className: 'review-field-label' }, '断言 (' + api.assertVos.length + ')'),
              React.createElement('div', { className: 'review-assertions' },
                api.assertVos.map((assert, j) =>
                  React.createElement('div', {
                    className: 'review-assertion' + (assertions[i + '-' + j] ? ' pass' : ' fail'),
                    key: j,
                    onClick: () => toggleAssertion(i + '-' + j),
                  }, [
                    React.createElement('span', { className: 'review-assertion-icon' }, assertions[i + '-' + j] ? 'V' : 'X'),
                    React.createElement('span', { className: 'review-assertion-expr' }, assert.expression + ' = ' + assert.expectValue),
                  ])
                ),
              ),
            ]),
          ]),
        ]);
      })
    ),

    // Actions
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'center', gap: 16, marginTop: 24 },
      key: 'actions',
    }, [
      React.createElement('button', { className: 'btn btn-primary btn-lg', onClick: handleSave, key: 'save', style: { minWidth: 150 }}, '保存修改'),
      React.createElement('button', { className: 'btn btn-success btn-lg', onClick: () => goToPage('export'), key: 'export', style: { minWidth: 150 }}, '导出用例'),
      React.createElement('button', { className: 'btn btn-success btn-lg', onClick: () => goToPage('regression'), key: 'reg', style: { minWidth: 180 }}, '通过并进入回归验证'),
      React.createElement('button', { className: 'btn', onClick: () => goToPage('pipeline'), key: 'back' }, '返回管道'),
    ]),

    // AI 流式日志面板
    aiLog ? React.createElement('div', {
      key: 'ai-log',
      style: {
        position: 'fixed', bottom: 0, right: 0, width: '50%', maxHeight: 320,
        background: 'var(--bg, #1e1e2e)', border: '1px solid var(--border, #333)',
        borderRadius: '8px 0 0 0', zIndex: 999,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.3)', overflow: 'hidden',
      },
    }, [
      React.createElement('div', {
        key: 'hdr',
        style: {
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 12px', borderBottom: '1px solid var(--border, #333)',
          fontSize: 13, fontWeight: 600,
        },
      }, [
        React.createElement('span', { key: 't' }, 'AI 交互日志'),
        React.createElement('button', {
          key: 'c', className: 'btn btn-sm', onClick: clearAiLog,
          style: { padding: '2px 8px', fontSize: 11 },
        }, '×'),
      ]),
      React.createElement('pre', {
        key: 'content',
        style: {
          flex: 1, overflowY: 'auto', padding: 8, margin: 0,
          fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap',
          wordBreak: 'break-all', color: 'var(--text, #ccc)',
          maxHeight: 270,
        },
      }, aiLog || '等待 AI 响应...'),
    ]) : null,
  ]);
};
