// pipelineStore.js - 简易状态管理 (支持 Electron/Web 双模式)
const pipelineStore = {
  _state: {
    currentPage: null,
    recording: null,
    recordingPath: '',
    stats: null,
    pipelineRunning: false,
    pipelineState: null,
    stages: [
      { agentId: 'cleaner', name: '数据清洗', status: 'pending' },
      { agentId: 'env-analyzer', name: '环境识别', status: 'pending' },
      { agentId: 'linker', name: '跨接口关联', status: 'pending' },
      { agentId: 'assembler', name: '用例拼装', status: 'pending' },
    ],
    progress: {},
    results: {},
    envConfig: null,
    caseVo: null,
    pipelineResult: null,
    outDir: '',
    // 数据池 & 串联规则
    dataPools: [],
    dataPoolConfig: null,
    chainRules: [],
    iterationMode: 'none',
  },

  /** 重启后清空所有测试数据（保留数据池）*/
  clearTestData() {
    this.setState({
      recording: null,
      recordingPath: '',
      stats: null,
      pipelineRunning: false,
      pipelineState: null,
      stages: [
        { agentId: 'cleaner', name: '数据清洗', status: 'pending' },
        { agentId: 'env-analyzer', name: '环境识别', status: 'pending' },
        { agentId: 'linker', name: '跨接口关联', status: 'pending' },
        { agentId: 'assembler', name: '用例拼装', status: 'pending' },
      ],
      progress: {},
      results: {},
      envConfig: null,
      caseVo: null,
      pipelineResult: null,
      outDir: '',
      dataPoolConfig: null,
      chainRules: [],
      iterationMode: 'none',
    });
  },
  _listeners: [],
  getState() { return { ...this._state }; },
  setState(partial) {
    Object.assign(this._state, partial);
    this._notify();
  },
  subscribe(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  },
  _notify() {
    const snapshot = { ...this._state };
    this._listeners.forEach(fn => fn(snapshot));
  },
  // IPC 辅助 (使用 appApi 适配器)
  async importRecording(filePath) {
    const result = await window.appApi.importRecording(filePath);
    if (result && !result.error) {
      this.setState({
        recording: result.scenarios || result.recording || result,
        stats: result.stats,
        recordingPath: filePath,
      });
    }
    return result;
  },
  async startPipeline(config) {
    this.setState({ pipelineRunning: true, pipelineState: null });
    const result = await window.appApi.startPipeline(config);
    return result;
  },
  async getPipelineState() {
    const state = await window.appApi.getPipelineState();
    this.setState({ pipelineState: state, pipelineRunning: state?.running || false });
    return state;
  },

  // === 数据池 ===
  async loadDataPools() {
    try {
      const pools = await window.appApi.dataPoolList();
      if (Array.isArray(pools)) {
        this.setState({ dataPools: pools });
      }
      return pools;
    } catch (e) {
      console.warn('[Store] 加载数据池失败:', e);
      return [];
    }
  },

  bindDataPool(poolConfig) {
    this.setState({ dataPoolConfig: poolConfig });
  },

  setIterationMode(mode) {
    this.setState({ iterationMode: mode || 'none' });
  },

  async saveChainRules(outDir, rules) {
    try {
      const result = await window.appApi.chainRuleSave(outDir, rules);
      if (result && result.success) {
        this.setState({ chainRules: rules });
      }
      return result;
    } catch (e) {
      console.warn('[Store] 保存串联规则失败:', e);
      return { success: false, error: e.message };
    }
  },

  async loadChainRules(outDir) {
    try {
      const rules = await window.appApi.chainRuleList(outDir);
      if (Array.isArray(rules)) {
        this.setState({ chainRules: rules });
      }
      return rules;
    } catch (e) {
      console.warn('[Store] 加载串联规则失败:', e);
      return [];
    }
  },
};
