/**
 * token-tracker.js - AI Token 使用统计
 * 追踪每次 AI 请求的 Token 消耗，按 Provider 和模型聚合统计
 * 数据持久化至 desktop/data/token-usage.json
 */
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const log = logger.create('TokenTracker');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'token-usage.json');

/** 参考计价表 (每 1K tokens 的美元价格) */
const MODEL_PRICING = {
  'deepseek-v4-flash':      { input: 0.0005, output: 0.002 },
  'deepseek-v4-pro':         { input: 0.002, output: 0.008 },
  'deepseek-chat':           { input: 0.0005, output: 0.002 },
  'qwen3:8b':                { input: 0, output: 0 },    // 本地免费
  'qwen2.5:14b':             { input: 0, output: 0 },    // 本地免费
  'qwen2.5-coder:32b':       { input: 0, output: 0 },    // 本地免费
  'llama3.2-vision:latest':  { input: 0, output: 0 },    // 本地免费
  'gpt-4o':                  { input: 0.01, output: 0.03 },
  'gpt-4o-mini':             { input: 0.00015, output: 0.0006 },
};

/** 确保数据目录存在 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** 加载所有 Token 记录 */
function loadRecords() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    saveRecords([]);
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    log.error(`Failed to load token usage: ${e.message}`);
    return [];
  }
}

/** 保存所有 Token 记录 */
function saveRecords(records) {
  ensureDataDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf-8');
    return true;
  } catch (e) {
    log.error(`Failed to save token usage: ${e.message}`);
    return false;
  }
}

/**
 * 记录一次 Token 使用
 * @param {Object} usage - { providerId, providerName, model, promptTokens, completionTokens, totalTokens }
 */
function recordUsage(usage) {
  const records = loadRecords();
  records.push({
    ...usage,
    timestamp: new Date().toISOString(),
  });

  // 最多保留 10000 条记录，防止文件无限膨胀
  const maxRecords = 10000;
  if (records.length > maxRecords) {
    const trimmed = records.slice(records.length - maxRecords);
    saveRecords(trimmed);
  } else {
    saveRecords(records);
  }
}

/**
 * 获取 Token 统计摘要
 * @param {Object} options - { providerId, model, since }
 * @returns {Object} 统计数据
 */
function getStats(options = {}) {
  let records = loadRecords();

  // 过滤
  if (options.providerId) {
    records = records.filter((r) => r.providerId === options.providerId);
  }
  if (options.model) {
    records = records.filter((r) => r.model === options.model);
  }
  if (options.since) {
    const since = new Date(options.since).getTime();
    records = records.filter((r) => new Date(r.timestamp).getTime() >= since);
  }

  // 总览
  const totalRequests = records.length;
  const totalPromptTokens = records.reduce((s, r) => s + (r.promptTokens || 0), 0);
  const totalCompletionTokens = records.reduce((s, r) => s + (r.completionTokens || 0), 0);
  const totalTokens = records.reduce((s, r) => s + (r.totalTokens || 0), 0);

  // 按 Provider 分组
  const byProvider = {};
  records.forEach((r) => {
    const key = r.providerId || 'unknown';
    if (!byProvider[key]) {
      byProvider[key] = { providerName: r.providerName || key, requests: 0, tokens: 0 };
    }
    byProvider[key].requests++;
    byProvider[key].tokens += r.totalTokens || 0;
  });

  // 按模型分组
  const byModel = {};
  records.forEach((r) => {
    const key = r.model || 'unknown';
    if (!byModel[key]) {
      byModel[key] = { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
    byModel[key].requests++;
    byModel[key].promptTokens += r.promptTokens || 0;
    byModel[key].completionTokens += r.completionTokens || 0;
    byModel[key].totalTokens += r.totalTokens || 0;
  });

  // 估计费用
  const estimatedCost = calculateCost(records);

  return {
    totalRequests,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    byProvider: Object.entries(byProvider).map(([id, data]) => ({ id, ...data })),
    byModel: Object.entries(byModel).map(([model, data]) => ({ model, ...data })),
    estimatedCost,
  };
}

/**
 * 估算费用
 */
function calculateCost(records) {
  let totalCost = 0;
  records.forEach((r) => {
    const pricing = MODEL_PRICING[r.model];
    if (pricing) {
      totalCost += ((r.promptTokens || 0) / 1000) * pricing.input;
      totalCost += ((r.completionTokens || 0) / 1000) * pricing.output;
    }
  });
  return Math.round(totalCost * 1000000) / 1000000; // 精确到小数点后6位
}

/**
 * 获取今日/本周/本月统计
 */
function getTimeRangeStats() {
  const records = loadRecords();
  const now = Date.now();
  const oneDay = 86400000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const todayRecords = records.filter((r) => new Date(r.timestamp) >= today);
  const weekRecords = records.filter((r) => new Date(r.timestamp) >= weekStart);
  const monthRecords = records.filter((r) => new Date(r.timestamp) >= monthStart);

  return {
    today: summarizeRecords(todayRecords),
    thisWeek: summarizeRecords(weekRecords),
    thisMonth: summarizeRecords(monthRecords),
    all: summarizeRecords(records),
  };
}

/** 对记录列表做汇总 */
function summarizeRecords(records) {
  return {
    requests: records.length,
    promptTokens: records.reduce((s, r) => s + (r.promptTokens || 0), 0),
    completionTokens: records.reduce((s, r) => s + (r.completionTokens || 0), 0),
    totalTokens: records.reduce((s, r) => s + (r.totalTokens || 0), 0),
    cost: calculateCost(records),
  };
}

/** 清空所有统计 */
function clearStats() {
  saveRecords([]);
  return true;
}

/** 获取最近记录列表 */
function getRecentRecords(limit = 50) {
  const records = loadRecords();
  return records.slice(-limit).reverse();
}

module.exports = {
  recordUsage,
  getStats,
  getTimeRangeStats,
  getRecentRecords,
  clearStats,
  MODEL_PRICING,
};
