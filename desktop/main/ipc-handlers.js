/**
 * ipc-handlers.js - Electron IPC 通信处理
 * 使用 Map<windowId, Orchestrator> 管理多窗口实例
 * 支持管道状态持久化
 */
const path = require('path');
const fs = require('fs');
const { dialog } = require('electron');
const logger = require('../core/logger');

const log = logger.create('IPC');

const { Orchestrator } = require('../agents/orchestrator');
const { CleanerAgent } = require('../agents/cleaner');
const { LinkerAgent } = require('../agents/linker');
const { EnvAnalyzerAgent } = require('../agents/env-analyzer');
const { AssemblerAgent } = require('../agents/assembler');
const { ReviewerAgent } = require('../agents/reviewer');
const { Recording } = require('../models/Recording');
const { Environment } = require('../models/Environment');
const aiConfig = require('../core/ai-config');
const tokenTracker = require('../core/token-tracker');

// Map<windowId, Orchestrator> —— 支持多窗口
const orchestrators = new Map();

function getOutDir(recordingPath) {
  return path.join(path.dirname(recordingPath), 'out');
}

function getStateFilePath(outDir) {
  return path.join(outDir, '.pipeline-state.json');
}

function loadPersistedState(outDir) {
  const stateFile = getStateFilePath(outDir);
  if (fs.existsSync(stateFile)) {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf-8')); } catch {}
  }
  return null;
}

function persistState(orch) {
  const state = orch.getState();
  const stateFile = getStateFilePath(orch.outDir);
  try {
    if (!fs.existsSync(orch.outDir)) fs.mkdirSync(orch.outDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    log.error(`Failed to persist state: ${e.message}`);
  }
}

function clearPersistedState(outDir) {
  const stateFile = getStateFilePath(outDir);
  try { if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile); } catch {}
}

function setupEventForwarding(orch, mainWindow) {
  if (!mainWindow) return;
  const send = (ch) => (msg) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(ch, msg);
  };
  orch.on('agent:progress', send('pipeline:progress'));
  orch.on('stage:start', send('pipeline:stageStart'));
  orch.on('stage:complete', (msg) => {
    send('pipeline:stageComplete')(msg);
    persistState(orch); // 每个 stage 完成后持久化状态
  });
  orch.on('stage:error', send('pipeline:stageError'));
  orch.on('pipeline:complete', (msg) => {
    send('pipeline:complete')(msg);
    clearPersistedState(orch.outDir);
  });
}

function registerIpcHandlers(ipcMain, mainWindow) {
  // 选择录制 JSON 文件
  ipcMain.handle('dialog:openRecording', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择录制 JSON 文件',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // 导入录制文件并预览
  ipcMain.handle('recording:import', async (event, filePath) => {
    if (!fs.existsSync(filePath)) {
      return { error: `文件不存在: ${filePath}` };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const recording = new Recording(raw);
    return {
      scenarios: recording.scenarios,
      stats: recording.getStats(),
      filePath,
    };
  });

  // 保存录制编辑
  ipcMain.handle('recording:saveEdits', async (event, { outDir, recordingPath, data }) => {
    // 如果未传入 outDir 但有 recordingPath，则自动计算
    const targetDir = outDir || (recordingPath ? getOutDir(recordingPath) : '');
    if (!targetDir) {
      return { success: false, error: '无法确定输出目录' };
    }
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'import-edited.json'), JSON.stringify(data, null, 2), 'utf-8');
    log.info(`编辑后的录制数据已保存到: ${path.join(targetDir, 'import-edited.json')}`);
    return { success: true };
  });

  // 开始管道处理
  ipcMain.handle('pipeline:start', async (event, config) => {
    const recordingPath = config.recordingPath;
    const outDir = config.outDir || (recordingPath ? getOutDir(recordingPath) : '');
    if (!outDir && !config.inputData && (!recordingPath || !fs.existsSync(recordingPath))) {
      return { error: '录制文件不存在' };
    }

    // 优先使用编辑后的数据（import-edited.json），否则使用原始文件
    let raw;
    const editedPath = outDir ? path.join(outDir, 'import-edited.json') : '';
    if (editedPath && fs.existsSync(editedPath)) {
      raw = JSON.parse(fs.readFileSync(editedPath, 'utf-8'));
      log.info('使用编辑后的录制数据: import-edited.json');
    } else if (config.inputData) {
      raw = config.inputData;
    } else if (recordingPath && fs.existsSync(recordingPath)) {
      raw = JSON.parse(fs.readFileSync(recordingPath, 'utf-8'));
    } else {
      return { error: '录制数据不存在' };
    }

    const recording = new Recording(raw);
    const allRecords = recording.getAllRecords();

    // 提取录制场景名称，注入到管道配置中供 Assembler 使用
    const recordingName = recording.scenarios[0]?.name || '';
    const defaultPipeline = require('../piplines/default-pipeline');
    // 深拷贝管道配置，避免修改被缓存的原模块
    const pipeline = {
      ...defaultPipeline,
      stages: defaultPipeline.stages.map(s => ({
        ...s,
        config: s.agentId === 'assembler'
          ? { ...(s.config || {}), name: recordingName }
          : s.config,
      })),
    };

    const orchestrator = new Orchestrator({ outDir, pipeline });

    // 注册所有 Agent
    const cleaner = new CleanerAgent({ outDir });
    const envAnalyzer = new EnvAnalyzerAgent({ outDir });
    const linker = new LinkerAgent({ outDir });
    const assembler = new AssemblerAgent({ outDir });

    orchestrator.registerAgent(cleaner);
    orchestrator.registerAgent(envAnalyzer);
    orchestrator.registerAgent(linker);
    orchestrator.registerAgent(assembler);

    // 事件转发 + 状态持久化
    setupEventForwarding(orchestrator, mainWindow);

    // 保存实例
    const winId = mainWindow ? mainWindow.id : 'default';
    orchestrators.set(winId, orchestrator);

    // 异步执行并等待完成，传递环境配置到管道上下文
    const pipelineResult = await orchestrator.run({
      inputData: allRecords,
      envConfig: config.envConfig || {},
      dataPoolConfig: config.dataPoolConfig || null,
      chainRules: config.chainRules || [],
      iterationMode: config.iterationMode || 'none',
    }).catch((err) => {
      log.error(`Pipeline error: ${err.message}`);
      return { error: err.message };
    });

    return {
      status: pipelineResult === false ? 'failed' : 'completed',
      totalStages: pipeline.stages.length,
      outDir,
      success: pipelineResult !== false,
    };
  });

  // 读取管道处理结果
  ipcMain.handle('pipeline:readResult', async (event, outDir) => {
    if (!outDir || !fs.existsSync(outDir)) {
      return { success: false, error: '输出目录不存在' };
    }
    const result = { success: true };

    // 读取用例数据
    const casePath = path.join(outDir, 'case-save.json');
    if (fs.existsSync(casePath)) {
      result.caseVo = JSON.parse(fs.readFileSync(casePath, 'utf-8'));
    }

    // 读取环境配置
    const envPath = path.join(outDir, 'env-config.json');
    if (fs.existsSync(envPath)) {
      result.envConfig = JSON.parse(fs.readFileSync(envPath, 'utf-8'));
    }

    // 读取清洗数据（用于统计）
    const cleanedPath = path.join(outDir, 'cleaned.json');
    if (fs.existsSync(cleanedPath)) {
      const cleaned = JSON.parse(fs.readFileSync(cleanedPath, 'utf-8'));
      result.cleanedCount = Array.isArray(cleaned) ? cleaned.length : 0;
    }

    // 读取关联数据
    const linkedPath = path.join(outDir, 'linked.json');
    if (fs.existsSync(linkedPath)) {
      const linked = JSON.parse(fs.readFileSync(linkedPath, 'utf-8'));
      result.linkedCount = Array.isArray(linked) ? linked.length : 0;
    }

    return result;
  });

  // 获取管道状态
  ipcMain.handle('pipeline:state', () => {
    const winId = mainWindow ? mainWindow.id : 'default';
    const orch = orchestrators.get(winId);
    if (orch) return orch.getState();

    // 尝试从持久化状态读取
    const state = loadPersistedState(getOutDir(''));
    return state || { running: false };
  });

  // 取消管道
  ipcMain.handle('pipeline:abort', () => {
    const winId = mainWindow ? mainWindow.id : 'default';
    const orch = orchestrators.get(winId);
    if (orch) {
      orch.abort();
      clearPersistedState(orch.outDir);
    }
    return { status: 'aborted' };
  });

  // 读取最近日志
  ipcMain.handle('log:recent', async () => {
    if (typeof logger.readRecentLines === 'function') {
      return logger.readRecentLines(500);
    }
    return [];
  });

  // 清理所有日志
  ipcMain.handle('log:clear', async () => {
    if (typeof logger.clearAllLogs === 'function') {
      return logger.clearAllLogs();
    }
    return { success: false, error: 'clearAllLogs not available' };
  });

  // 获取日志配置
  ipcMain.handle('log:config', async () => {
    if (typeof logger.getConfig === 'function') {
      return logger.getConfig();
    }
    return {};
  });

  // 读取 out/ 目录文件
  ipcMain.handle('file:read', async (event, filePath) => {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  });

  // 写入文件
  ipcMain.handle('file:write', async (event, filePath, data) => {
    const absPath = path.resolve(filePath);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  });

  // 读目录列表
  ipcMain.handle('dir:list', async (event, dirPath) => {
    const absPath = path.resolve(dirPath);
    if (!fs.existsSync(absPath)) return [];
    return fs.readdirSync(absPath).filter((f) => f.endsWith('.json'));
  });

  // 导出文件
  ipcMain.handle('file:export', async (event, { data, defaultName, filters }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出用例',
      defaultPath: defaultName || 'case-export.json',
      filters: filters || [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return null;

    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return result.filePath;
  });

  // 保存环境配置
  ipcMain.handle('env:save', async (event, envConfig) => {
    const env = new Environment(envConfig);
    const outDir = getOutDir('.');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'env-config.json'), JSON.stringify(env.toJSON(), null, 2), 'utf-8');
    return { status: 'saved' };
  });

  // ============ AI 模型配置 ============

  // 获取所有 Provider
  ipcMain.handle('ai:getProviders', async () => {
    return aiConfig.getAll();
  });

  // 保存 Provider
  ipcMain.handle('ai:saveProvider', async (event, provider) => {
    const ok = aiConfig.saveProvider(provider);
    return { ok };
  });

  // 删除 Provider
  ipcMain.handle('ai:deleteProvider', async (event, id) => {
    const ok = aiConfig.deleteProvider(id);
    return { ok };
  });

  // 测试连通性
  ipcMain.handle('ai:testConnection', async (event, id) => {
    return aiConfig.testConnection(id);
  });

  // 直接测试连通性（不经过存储，用于表单预览）
  ipcMain.handle('ai:testConnectionDirect', async (event, provider) => {
    return aiConfig.testConnectionDirect(provider);
  });

  // 列出远程模型
  ipcMain.handle('ai:getModels', async (event, id) => {
    const { AIClient } = require('../core/ai-client');
    const provider = aiConfig.getById(id);
    if (!provider) return [];
    const client = new AIClient(provider);
    return client.listRemoteModels();
  });

  // 获取 Provider 类型定义
  ipcMain.handle('ai:getProviderTypes', async () => {
    return aiConfig.getProviderTypes();
  });

  // 重新排序优先级
  ipcMain.handle('ai:reorderProviders', async (event, providerIds) => {
    const ok = aiConfig.reorderPriorities(providerIds);
    return { ok };
  });

  // ============ Token 统计 ============

  // 获取 Token 统计
  ipcMain.handle('ai:getTokenStats', async (event, options) => {
    return tokenTracker.getStats(options);
  });

  // 获取时间范围统计
  ipcMain.handle('ai:getTokenTimeStats', async () => {
    return tokenTracker.getTimeRangeStats();
  });

  // 获取最近记录
  ipcMain.handle('ai:getRecentTokenRecords', async (event, limit) => {
    return tokenTracker.getRecentRecords(limit);
  });

  // 清空 Token 统计
  ipcMain.handle('ai:clearTokenStats', async () => {
    const ok = tokenTracker.clearStats();
    return { ok };
  });

  // 获取模型参考计价表
  ipcMain.handle('ai:getModelPricing', async () => {
    return tokenTracker.MODEL_PRICING;
  });

  // 清理窗口关闭时的 orchestrator
  mainWindow?.on('closed', () => {
    const winId = mainWindow.id;
    const orch = orchestrators.get(winId);
    if (orch) {
      orch.abort();
      orchestrators.delete(winId);
    }
  });

  // ============ 智能审查 ============

  // 获取审查规则定义
  ipcMain.handle('review:getRules', async (event, ruleConfigs) => {
    const outDir = getOutDir('.');
    const reviewer = new ReviewerAgent({ outDir });
    return reviewer.getRules(ruleConfigs);
  });

  // 执行审查
  ipcMain.handle('review:run', async (event, { outDir, ruleConfigs, useAI }) => {
    if (!outDir || !fs.existsSync(outDir)) {
      return { success: false, error: '输出目录不存在' };
    }
    try {
      // 读取用例数据
      const casePath = path.join(outDir, 'case-save.json');
      if (!fs.existsSync(casePath)) {
        return { success: false, error: '用例文件不存在，请先完成管道处理' };
      }
      const caseVo = JSON.parse(fs.readFileSync(casePath, 'utf-8'));

      // 读取关联数据
      let linkedRecords = [];
      const linkedPath = path.join(outDir, 'linked.json');
      if (fs.existsSync(linkedPath)) {
        linkedRecords = JSON.parse(fs.readFileSync(linkedPath, 'utf-8'));
      }

      const reviewer = new ReviewerAgent({ outDir });
      const result = await reviewer.execute({
        data: caseVo,
        ruleConfigs,
        linkedRecords,
        useAI,
      });

      return { success: true, ...result };
    } catch (e) {
      log.error(`Review failed: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // 读取审查报告
  ipcMain.handle('review:readReport', async (event, outDir) => {
    const reportPath = path.join(outDir, 'review-report.json');
    if (!fs.existsSync(reportPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    } catch { return null; }
  });

  // ============ 回归验证 ============

  // 执行回归验证
  ipcMain.handle('regression:run', async (event, { outDir }) => {
    if (!outDir || !fs.existsSync(outDir)) {
      return { success: false, error: '输出目录不存在' };
    }
    try {
      // 读取用例数据
      const casePath = path.join(outDir, 'case-save.json');
      if (!fs.existsSync(casePath)) {
        return { success: false, error: '用例文件不存在，请先完成管道处理' };
      }
      const caseVo = JSON.parse(fs.readFileSync(casePath, 'utf-8'));

      // 读取环境配置
      let envConfig = {};
      const envPath = path.join(outDir, 'env-config.json');
      if (fs.existsSync(envPath)) {
        envConfig = JSON.parse(fs.readFileSync(envPath, 'utf-8'));
      }

      // 读取关联数据
      let linkedRecords = [];
      const linkedPath = path.join(outDir, 'linked.json');
      if (fs.existsSync(linkedPath)) {
        linkedRecords = JSON.parse(fs.readFileSync(linkedPath, 'utf-8'));
      }

      const { RegressionRunnerAgent } = require('../agents/regression-runner');
      const runner = new RegressionRunnerAgent({ outDir });
      const result = await runner.execute({
        data: caseVo,
        envConfig,
        linkedRecords,
      });

      return { success: true, ...result };
    } catch (e) {
      log.error(`Regression run failed: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // 读取回归报告
  ipcMain.handle('regression:readReport', async (event, outDir) => {
    const reportPath = path.join(outDir, 'regression-report.json');
    if (!fs.existsSync(reportPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    } catch { return null; }
  });

  // ============ 测试报告持久化与对比 ============

  const REPORTS_DIR = path.resolve(__dirname, '..', 'data', 'reports');
  const REPORTS_INDEX = path.join(REPORTS_DIR, 'index.json');
  const MAX_REPORTS = 50;

  function ensureReportsDir() {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
  }

  function loadReportsIndex() {
    ensureReportsDir();
    if (!fs.existsSync(REPORTS_INDEX)) return [];
    try { return JSON.parse(fs.readFileSync(REPORTS_INDEX, 'utf-8')); } catch { return []; }
  }

  function saveReportsIndex(index) {
    ensureReportsDir();
    fs.writeFileSync(REPORTS_INDEX, JSON.stringify(index, null, 2), 'utf-8');
  }

  function sanitizeReportId(str) {
    return str.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_').slice(0, 80);
  }

  // 保存回归报告
  ipcMain.handle('regression:saveReport', async (event, reportData) => {
    try {
      if (!reportData || !reportData.stats) {
        return { success: false, error: '报告数据无效' };
      }
      ensureReportsDir();

      const caseName = reportData.caseName || '未命名用例';
      const timestamp = reportData.timestamp || new Date().toISOString();
      const tsShort = timestamp.replace(/[:.]/g, '-').slice(0, 19);
      const safeName = sanitizeReportId(caseName);
      const reportId = `${safeName}_${tsShort}`;

      // 保存完整报告文件
      const reportPath = path.join(REPORTS_DIR, `${reportId}.json`);
      fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf-8');

      // 更新索引
      const index = loadReportsIndex();
      const entry = {
        id: reportId,
        caseName,
        timestamp,
        total: reportData.stats.total || 0,
        passed: reportData.stats.passed || 0,
        failed: reportData.stats.failed || 0,
        error: reportData.stats.error || 0,
        passRate: reportData.stats.passRate || 0,
        apiCount: reportData.apiCount || 0,
        environment: reportData.environment || '',
      };

      // 同 caseName 去重（保留最新的）
      const filtered = index.filter(e => e.caseName !== caseName || e.id !== reportId);
      filtered.unshift(entry);
      // 最多保留 MAX_REPORTS 条
      while (filtered.length > MAX_REPORTS) filtered.pop();
      saveReportsIndex(filtered);

      log.info(`测试报告已保存: ${reportId}`);
      return { success: true, reportId };
    } catch (e) {
      log.error(`保存测试报告失败: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // 列出回归报告
  ipcMain.handle('regression:listReports', async (event, caseName) => {
    try {
      const index = loadReportsIndex();
      if (caseName) {
        return index.filter(e => e.caseName === caseName);
      }
      return index;
    } catch (e) {
      return [];
    }
  });

  // 读取单个报告
  ipcMain.handle('regression:getReport', async (event, reportId) => {
    try {
      const reportPath = path.join(REPORTS_DIR, `${reportId}.json`);
      if (!fs.existsSync(reportPath)) return null;
      return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    } catch { return null; }
  });

  // 对比两次回归报告
  ipcMain.handle('regression:compareReports', async (event, id1, id2) => {
    try {
      const report1Path = path.join(REPORTS_DIR, `${id1}.json`);
      const report2Path = path.join(REPORTS_DIR, `${id2}.json`);
      if (!fs.existsSync(report1Path) || !fs.existsSync(report2Path)) {
        return { success: false, error: '报告文件不存在' };
      }

      const r1 = JSON.parse(fs.readFileSync(report1Path, 'utf-8'));
      const r2 = JSON.parse(fs.readFileSync(report2Path, 'utf-8'));

      const results1 = r1.results || [];
      const results2 = r2.results || [];

      // 按 method + url 建立映射
      const map1 = {};
      results1.forEach((res, idx) => {
        const key = `${res.method}_${res.url}`;
        map1[key] = { result: res, idx };
      });

      const map2 = {};
      results2.forEach((res, idx) => {
        const key = `${res.method}_${res.url}`;
        map2[key] = { result: res, idx };
      });

      // 对齐对比
      const allKeys = new Set([...Object.keys(map1), ...Object.keys(map2)]);
      const comparison = [];

      for (const key of allKeys) {
        const [method, ...urlParts] = key.split('_');
        const url = urlParts.join('_');
        const entry1 = map1[key];
        const entry2 = map2[key];

        const status1 = entry1
          ? (entry1.result.error ? 'error' : entry1.result.passed ? 'passed' : 'failed')
          : 'missing';
        const status2 = entry2
          ? (entry2.result.error ? 'error' : entry2.result.passed ? 'passed' : 'failed')
          : 'missing';

        // 判断差异类型
        let diffType = 'unchanged';
        if (status1 === 'missing') diffType = 'added';
        else if (status2 === 'missing') diffType = 'removed';
        else if (status1 === 'passed' && status2 !== 'passed') diffType = 'regressed';
        else if (status1 !== 'passed' && status2 === 'passed') diffType = 'improved';

        // 断言通过率变化
        const detail1 = entry1?.result;
        const detail2 = entry2?.result;
        const assertChange = detail1 && detail2
          ? `${detail1.assertions.filter(a => a.passed).length}/${detail1.assertions.length} → ${detail2.assertions.filter(a => a.passed).length}/${detail2.assertions.length}`
          : '';

        comparison.push({
          method,
          url,
          status1,
          status2,
          diffType,
          assertChange,
          responseStatus1: detail1?.responseStatus ?? '-',
          responseStatus2: detail2?.responseStatus ?? '-',
          duration1: detail1?.duration ?? '-',
          duration2: detail2?.duration ?? '-',
          error1: detail1?.error || '',
          error2: detail2?.error || '',
        });
      }

      return {
        success: true,
        report1: { id: id1, timestamp: r1.timestamp, caseName: r1.caseName, stats: r1.stats },
        report2: { id: id2, timestamp: r2.timestamp, caseName: r2.caseName, stats: r2.stats },
        comparison,
        summary: {
          total: comparison.length,
          unchanged: comparison.filter(c => c.diffType === 'unchanged').length,
          improved: comparison.filter(c => c.diffType === 'improved').length,
          regressed: comparison.filter(c => c.diffType === 'regressed').length,
          added: comparison.filter(c => c.diffType === 'added').length,
          removed: comparison.filter(c => c.diffType === 'removed').length,
        },
      };
    } catch (e) {
      log.error(`对比报告失败: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // 删除单个报告
  ipcMain.handle('regression:deleteReport', async (event, reportId) => {
    try {
      const reportPath = path.join(REPORTS_DIR, `${reportId}.json`);
      if (fs.existsSync(reportPath)) {
        fs.unlinkSync(reportPath);
      }
      // 更新索引
      const index = loadReportsIndex().filter(e => e.id !== reportId);
      saveReportsIndex(index);
      log.info(`测试报告已删除: ${reportId}`);
      return { success: true };
    } catch (e) {
      log.error(`删除报告失败: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // 批量删除报告
  ipcMain.handle('regression:deleteReports', async (event, reportIds) => {
    try {
      const ids = Array.isArray(reportIds) ? reportIds : [reportIds];
      ids.forEach(id => {
        const reportPath = path.join(REPORTS_DIR, `${id}.json`);
        if (fs.existsSync(reportPath)) {
          fs.unlinkSync(reportPath);
        }
      });
      // 更新索引
      const index = loadReportsIndex().filter(e => !ids.includes(e.id));
      saveReportsIndex(index);
      log.info(`批量删除测试报告: ${ids.length} 条`);
      return { success: true, deletedCount: ids.length };
    } catch (e) {
      log.error(`批量删除报告失败: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // ============ 审查规则 CRUD ============

  const REVIEW_RULES_PATH = path.resolve(__dirname, '..', 'data', 'review-rules.json');

  function loadCustomRules() {
    try {
      if (fs.existsSync(REVIEW_RULES_PATH)) {
        return JSON.parse(fs.readFileSync(REVIEW_RULES_PATH, 'utf-8'));
      }
    } catch {}
    return [];
  }

  function saveCustomRules(rules) {
    const dir = path.dirname(REVIEW_RULES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REVIEW_RULES_PATH, JSON.stringify(rules, null, 2), 'utf-8');
  }

  // 保存规则列表
  ipcMain.handle('review:saveRules', async (event, rules) => {
    saveCustomRules(rules);
    return { success: true };
  });

  // 新增规则
  ipcMain.handle('review:createRule', async (event, rule) => {
    const rules = loadCustomRules();
    const newRule = {
      ...rule,
      id: rule.id || 'CUSTOM_' + Date.now(),
      isBuiltin: false,
    };
    rules.push(newRule);
    saveCustomRules(rules);
    return { success: true, rule: newRule };
  });

  // 删除规则
  ipcMain.handle('review:deleteRule', async (event, ruleId) => {
    const rules = loadCustomRules().filter(r => r.id !== ruleId);
    saveCustomRules(rules);
    return { success: true };
  });

  // 更新规则
  ipcMain.handle('review:updateRule', async (event, ruleId, updates) => {
    const rules = loadCustomRules();
    const idx = rules.findIndex(r => r.id === ruleId);
    if (idx >= 0) {
      rules[idx] = { ...rules[idx], ...updates };
      saveCustomRules(rules);
      return { success: true };
    }
    return { success: false, error: '规则未找到' };
  });

  // ============ AI 优化 ============

  // AI 审查后优化用例
  ipcMain.handle('review:optimize', async (event, { outDir, caseVo }) => {
    try {
      const reviewer = new ReviewerAgent({ outDir });
      const result = await reviewer._aiOptimize(caseVo);
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ============ 跨接口关联 ============

  // 获取依赖图
  ipcMain.handle('linker:getDeps', async (event, outDir) => {
    const depsPath = path.join(outDir, 'deps-graph.json');
    if (!fs.existsSync(depsPath)) return null;
    try { return JSON.parse(fs.readFileSync(depsPath, 'utf-8')); } catch { return null; }
  });

  // 应用手动关联规则
  ipcMain.handle('linker:applyManualDeps', async (event, outDir, manualDeps) => {
    try {
      const cleanedPath = path.join(outDir, 'cleaned.json');
      if (!fs.existsSync(cleanedPath)) {
        return { success: false, error: 'cleaned.json 不存在' };
      }
      const records = JSON.parse(fs.readFileSync(cleanedPath, 'utf-8'));
      const linker = new LinkerAgent({ outDir });
      const result = await linker.execute({ data: records, manualDeps });
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ============ 项目持久化 ============

  const PROJECTS_FILE = path.resolve(__dirname, '..', 'data', 'projects.json');

  function ensureProjectsFile() {
    const dir = path.dirname(PROJECTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(PROJECTS_FILE)) {
      fs.writeFileSync(PROJECTS_FILE, '[]', 'utf-8');
    }
  }

  function loadProjects() {
    ensureProjectsFile();
    try {
      return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    } catch { return []; }
  }

  function saveProjects(projects) {
    ensureProjectsFile();
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
  }

  // 保存项目（管道完成后调用）
  ipcMain.handle('project:save', async (event, projectData) => {
    const projects = loadProjects();
    const entry = {
      ...projectData,
      savedAt: new Date().toISOString(),
    };
    projects.unshift(entry); // 新记录总是在最前面
    // 最多保留 50 条
    while (projects.length > 50) projects.pop();
    saveProjects(projects);
    return { success: true };
  });

  // 列出所有项目
  ipcMain.handle('project:list', async () => {
    return loadProjects();
  });

  // 删除项目
  ipcMain.handle('project:delete', async (event, outDir) => {
    const projects = loadProjects().filter(p => p.outDir !== outDir);
    saveProjects(projects);
    return { success: true };
  });

  // ============ 数据池 CRUD ============

  const DATAPOOLS_DIR = path.resolve(__dirname, '..', 'data', 'dataPools');

  function ensureDataPoolsDir() {
    if (!fs.existsSync(DATAPOOLS_DIR)) {
      fs.mkdirSync(DATAPOOLS_DIR, { recursive: true });
    }
  }

  function getDataPoolFilePath(id) {
    return path.join(DATAPOOLS_DIR, `${id}.json`);
  }

  // 保存/更新数据池
  ipcMain.handle('dataPool:save', async (event, poolData) => {
    try {
      ensureDataPoolsDir();
      const { TestDataPool } = require('../models/TestDataPool');
      const pool = poolData instanceof TestDataPool ? poolData : new TestDataPool(poolData);
      pool.updatedAt = new Date().toISOString();
      const filePath = getDataPoolFilePath(pool.id);
      fs.writeFileSync(filePath, JSON.stringify(pool.toJSON(), null, 2), 'utf-8');
      log.info(`数据池已保存: ${pool.name} (${pool.id})`);
      return { success: true, id: pool.id };
    } catch (e) {
      log.error(`保存数据池失败: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // 列出所有数据池（摘要信息）
  ipcMain.handle('dataPool:list', async () => {
    try {
      ensureDataPoolsDir();
      const files = fs.readdirSync(DATAPOOLS_DIR).filter(f => f.endsWith('.json'));
      return files.map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(DATAPOOLS_DIR, f), 'utf-8'));
          return {
            id: data.id,
            name: data.name,
            source: data.source,
            fieldCount: (data.fields || []).length,
            rowCount: (data.rows || []).length,
            tags: data.tags || [],
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        } catch { return null; }
      }).filter(Boolean);
    } catch (e) {
      log.error(`列出数据池失败: ${e.message}`);
      return [];
    }
  });

  // 读取单个数据池完整数据
  ipcMain.handle('dataPool:get', async (event, poolId) => {
    try {
      ensureDataPoolsDir();
      const filePath = getDataPoolFilePath(poolId);
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '数据池不存在' };
      }
      return { success: true, pool: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 删除数据池
  ipcMain.handle('dataPool:delete', async (event, poolId) => {
    try {
      ensureDataPoolsDir();
      const filePath = getDataPoolFilePath(poolId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log.info(`数据池已删除: ${poolId}`);
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 导入 CSV 文件（弹窗选文件→解析→返回预览）
  ipcMain.handle('dataPool:importCsv', async (event, opts) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择 CSV 文件',
        filters: [{ name: 'CSV 文件', extensions: ['csv', 'txt'] }],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const filePath = result.filePaths[0];
      let content = fs.readFileSync(filePath, 'utf-8');
      // Detect UTF-8 BOM
      if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
      }

      const { TestDataPool } = require('../models/TestDataPool');
      const pool = TestDataPool.fromCSV(content, opts);
      pool.name = opts?.name || path.basename(filePath, path.extname(filePath));

      // 返回预览信息（只保留前 5 行用于预览）
      const previewRows = pool.rows.slice(0, 5).map(r => r.values);
      return {
        success: true,
        pool: pool.toJSON(),
        preview: {
          fields: pool.fields.map(f => f.name),
          rows: previewRows,
          totalRows: pool.rows.length,
        },
        filePath,
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 导入 TXT 文件
  ipcMain.handle('dataPool:importTxt', async (event, opts) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择 TXT 文件',
        filters: [{ name: '文本文件', extensions: ['txt'] }],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const filePath = result.filePaths[0];
      const content = fs.readFileSync(filePath, 'utf-8');

      const { TestDataPool } = require('../models/TestDataPool');
      const pool = TestDataPool.fromTXT(content, opts);
      pool.name = opts?.name || path.basename(filePath, path.extname(filePath));

      const previewRows = pool.rows.slice(0, 5).map(r => r.values);
      return {
        success: true,
        pool: pool.toJSON(),
        preview: {
          fields: pool.fields.map(f => f.name),
          rows: previewRows,
          totalRows: pool.rows.length,
        },
        filePath,
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ============ 串联规则 ============

  // 保存串联规则到 outDir
  ipcMain.handle('chainRule:save', async (event, outDir, chainRules) => {
    try {
      if (!outDir) return { success: false, error: 'outDir 不能为空' };
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const filePath = path.join(outDir, 'chain-rules.json');
      fs.writeFileSync(filePath, JSON.stringify(chainRules, null, 2), 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 读取 outDir 下的串联规则
  ipcMain.handle('chainRule:list', async (event, outDir) => {
    try {
      if (!outDir) return [];
      const filePath = path.join(outDir, 'chain-rules.json');
      if (!fs.existsSync(filePath)) return [];
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch { return []; }
  });

  // ============ 运行时函数 ============

  // 列出所有可用的运行时函数
  ipcMain.handle('function:list', async (event, category) => {
    try {
      const { FunctionRegistry } = require('../models/FunctionRegistry');
      const registry = new FunctionRegistry();
      return registry.listFunctions(category);
    } catch (e) {
      return [];
    }
  });

  // ============ 回归验证增强 ============

  // 增强版回归运行，支持数据池循环
  ipcMain.handle('regression:runWithData', async (event, { outDir, dataPoolConfig, chainRules, iterationMode }) => {
    try {
      if (!outDir || !fs.existsSync(outDir)) {
        return { success: false, error: '输出目录不存在' };
      }

      const casePath = path.join(outDir, 'case-save.json');
      if (!fs.existsSync(casePath)) {
        return { success: false, error: '用例文件不存在，请先完成管道处理' };
      }
      const caseVo = JSON.parse(fs.readFileSync(casePath, 'utf-8'));

      let envConfig = {};
      const envPath = path.join(outDir, 'env-config.json');
      if (fs.existsSync(envPath)) {
        envConfig = JSON.parse(fs.readFileSync(envPath, 'utf-8'));
      }

      let linkedRecords = [];
      const linkedPath = path.join(outDir, 'linked.json');
      if (fs.existsSync(linkedPath)) {
        linkedRecords = JSON.parse(fs.readFileSync(linkedPath, 'utf-8'));
      }

      const { RegressionRunnerAgent } = require('../agents/regression-runner');
      const runner = new RegressionRunnerAgent({ outDir });
      const result = await runner.execute({
        data: caseVo,
        envConfig,
        linkedRecords,
        dataPoolConfig,
        chainRules,
        iterationMode,
      });

      return { success: true, ...result };
    } catch (e) {
      log.error(`数据驱动回归运行失败: ${e.message}`);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { registerIpcHandlers };
