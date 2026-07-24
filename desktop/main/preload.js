/**
 * preload.js - Electron 预加载脚本 (安全隔离层)
 * 在 contextIsolation: true 模式下暴露有限 API 给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // === IPC 调用 ===
  dialogOpenRecording()      { return ipcRenderer.invoke('dialog:openRecording'); },
  recordingImport(filePath)  { return ipcRenderer.invoke('recording:import', filePath); },
  pipelineStart(config)      { return ipcRenderer.invoke('pipeline:start', config); },
  pipelineReadResult(outDir) { return ipcRenderer.invoke('pipeline:readResult', outDir); },
  pipelineState()            { return ipcRenderer.invoke('pipeline:state'); },
  pipelineAbort()            { return ipcRenderer.invoke('pipeline:abort'); },
  fileRead(filePath)         { return ipcRenderer.invoke('file:read', filePath); },
  fileWrite(filePath, data)  { return ipcRenderer.invoke('file:write', filePath, data); },
  dirList(dirPath)           { return ipcRenderer.invoke('dir:list', dirPath); },
  fileExport(data)           { return ipcRenderer.invoke('file:export', data); },
  envSave(envConfig)         { return ipcRenderer.invoke('env:save', envConfig); },
  getPipelineState()         { return ipcRenderer.invoke('pipeline:state'); },

  // === 日志 ===
  logRecent()                { return ipcRenderer.invoke('log:recent'); },
  logConfig()                { return ipcRenderer.invoke('log:config'); },
  clearLogs()                { return ipcRenderer.invoke('log:clear'); },

  // === AI 模型配置 ===
  getAiProviders()           { return ipcRenderer.invoke('ai:getProviders'); },
  saveAiProvider(provider)   { return ipcRenderer.invoke('ai:saveProvider', provider); },
  deleteAiProvider(id)       { return ipcRenderer.invoke('ai:deleteProvider', id); },
  testAiConnection(id)       { return ipcRenderer.invoke('ai:testConnection', id); },
  testAiConnectionDirect(provider) { return ipcRenderer.invoke('ai:testConnectionDirect', provider); },
  getAiModels(id)            { return ipcRenderer.invoke('ai:getModels', id); },
  getAiProviderTypes()       { return ipcRenderer.invoke('ai:getProviderTypes'); },
  reorderAiProviders(ids)    { return ipcRenderer.invoke('ai:reorderProviders', ids); },

  // === Token 统计 ===
  getTokenStats(options)     { return ipcRenderer.invoke('ai:getTokenStats', options); },
  getTokenTimeStats()        { return ipcRenderer.invoke('ai:getTokenTimeStats'); },
  getRecentTokenRecords(limit) { return ipcRenderer.invoke('ai:getRecentTokenRecords', limit); },
  clearTokenStats()          { return ipcRenderer.invoke('ai:clearTokenStats'); },
  getModelPricing()          { return ipcRenderer.invoke('ai:getModelPricing'); },

  // === 事件监听 (返回取消函数) ===
  onEvent(channel, callback) {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /** 便捷方法 —— 监听管道事件 */
  onPipelineProgress(cb)     { return this.onEvent('pipeline:progress', cb); },
  onPipelineStageStart(cb)   { return this.onEvent('pipeline:stageStart', cb); },
  onPipelineStageComplete(cb) { return this.onEvent('pipeline:stageComplete', cb); },
  onPipelineStageError(cb)   { return this.onEvent('pipeline:stageError', cb); },
  onPipelineComplete(cb)     { return this.onEvent('pipeline:complete', cb); },

  /** 实时日志推送 */
  onLogEntry(cb)             { return this.onEvent('log:entry', cb); },

  // === 录制编辑 ===
  saveRecordingEdits(params) { return ipcRenderer.invoke('recording:saveEdits', params); },

  // === 智能审查 ===
  getReviewRules(ruleConfigs) { return ipcRenderer.invoke('review:getRules', ruleConfigs); },
  runReview(params)           { return ipcRenderer.invoke('review:run', params); },
  readReviewReport(outDir)    { return ipcRenderer.invoke('review:readReport', outDir); },

  // === 审查规则 CRUD ===
  saveReviewRules(rules)       { return ipcRenderer.invoke('review:saveRules', rules); },
  createReviewRule(rule)       { return ipcRenderer.invoke('review:createRule', rule); },
  deleteReviewRule(ruleId)     { return ipcRenderer.invoke('review:deleteRule', ruleId); },
  updateReviewRule(ruleId, updates) { return ipcRenderer.invoke('review:updateRule', ruleId, updates); },
  saveRuleConfigs(configs)     { return ipcRenderer.invoke('review:saveRuleConfigs', configs); },
  loadRuleConfigs()             { return ipcRenderer.invoke('review:loadRuleConfigs'); },

  // === AI 优化 ===
  runAiOptimize(params)        { return ipcRenderer.invoke('review:optimize', params); },
  runAiOptimizeSingle(params)  { return ipcRenderer.invoke('review:optimizeSingle', params); },

  // === AI 流式事件 ===
  onReviewAiChunk(cb)          { return this.onEvent('review:aiChunk', cb); },

  // === 回归验证 ===
  runRegression(params)           { return ipcRenderer.invoke('regression:run', params); },
  readRegressionReport(outDir)    { return ipcRenderer.invoke('regression:readReport', outDir); },

  // === 测试报告 ===
  saveRegressionReport(data)      { return ipcRenderer.invoke('regression:saveReport', data); },
  listRegressionReports(caseName) { return ipcRenderer.invoke('regression:listReports', caseName); },
  getRegressionReport(reportId)   { return ipcRenderer.invoke('regression:getReport', reportId); },
  compareRegressionReports(id1, id2) { return ipcRenderer.invoke('regression:compareReports', id1, id2); },
  deleteRegressionReport(id)      { return ipcRenderer.invoke('regression:deleteReport', id); },
  deleteRegressionReports(ids)    { return ipcRenderer.invoke('regression:deleteReports', ids); },

  // === 关联可视化 ===
  getLinkedDeps(outDir)        { return ipcRenderer.invoke('linker:getDeps', outDir); },
  applyManualDeps(outDir, manualDeps) { return ipcRenderer.invoke('linker:applyManualDeps', outDir, manualDeps); },

  // === 项目持久化 ===
  saveProject(data)           { return ipcRenderer.invoke('project:save', data); },
  listProjects()              { return ipcRenderer.invoke('project:list'); },
  deleteProject(outDir)       { return ipcRenderer.invoke('project:delete', outDir); },

  // === 数据池 ===
  dataPoolSave(poolData)       { return ipcRenderer.invoke('dataPool:save', poolData); },
  dataPoolList()               { return ipcRenderer.invoke('dataPool:list'); },
  dataPoolGet(poolId)          { return ipcRenderer.invoke('dataPool:get', poolId); },
  dataPoolDelete(poolId)       { return ipcRenderer.invoke('dataPool:delete', poolId); },
  dataPoolImportCsv(opts)      { return ipcRenderer.invoke('dataPool:importCsv', opts); },
  dataPoolImportTxt(opts)      { return ipcRenderer.invoke('dataPool:importTxt', opts); },

  // === 串联规则 ===
  chainRuleSave(outDir, rules) { return ipcRenderer.invoke('chainRule:save', outDir, rules); },
  chainRuleList(outDir)        { return ipcRenderer.invoke('chainRule:list', outDir); },

  // === 运行时函数 ===
  listFunctions(category)      { return ipcRenderer.invoke('function:list', category); },

  // === 增强回归 ===
  runRegressionWithData(params) { return ipcRenderer.invoke('regression:runWithData', params); },

  // === 重新组装用例（数据绑定后） ===
  rerunAssembler(params) { return ipcRenderer.invoke('pipeline:rerunAssembler', params); },

  // === 修改追踪标签 ===
  modificationList(outDir)     { return ipcRenderer.invoke('modification:list', outDir); },
  modificationAppend(outDir, record) { return ipcRenderer.invoke('modification:append', outDir, record); },
};

// 向后兼容: window.api
contextBridge.exposeInMainWorld('api', api);
// 新统一 API: window.appApi
contextBridge.exposeInMainWorld('appApi', Object.assign({}, api, {
  isElectron: true,
  showToast(msg, type) {
    window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: msg, type: type || 'info' } }));
  },
  async openRecording() { return this.dialogOpenRecording(); },
  async startPipeline(config) { return this.pipelineStart(config); },
  async readPipelineResult(outDir) { return this.pipelineReadResult(outDir); },
  async importRecording(filePath) { return this.recordingImport(filePath); },
  // logRecent / onLogEntry 已从 api 继承，无需重复
  async readFile(path) { return this.fileRead(path); },
  async writeFile(path, data) { return this.fileWrite(path, data); },
  download() {}, // Electron 不触发下载
}));
