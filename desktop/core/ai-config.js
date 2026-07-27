/**
 * ai-config.js - AI Provider 配置管理
 * 管理多个 AI 模型提供商配置 (Ollama / OpenAI 兼容)
 * 数据持久化至 desktop/data/ai-providers.json
 */
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const log = logger.create('AIConfig');

/** 配置文件路径 */
const CONFIG_DIR = path.resolve(__dirname, '..', 'data');
const CONFIG_FILE = path.join(CONFIG_DIR, 'ai-providers.json');

/** 支持的 Provider 类型 */
const PROVIDER_TYPES = {
  ollama: {
    label: 'Ollama (本地)',
    defaultBaseUrl: 'http://localhost:11434',
    needsApiKey: false,
  },
  openai: {
    label: 'OpenAI 兼容',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    needsApiKey: true,
  },
};

/** 默认 Provider 列表 */
const DEFAULT_PROVIDERS = [
  {
    id: 'ollama-local',
    name: '本地 Ollama',
    type: 'ollama',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    defaultModel: 'qwen3:8b',
    priority: 0,
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'deepseek-cloud',
    name: 'DeepSeek 云端',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    defaultModel: 'deepseek-v4-flash',
    priority: 1,
    isActive: false,
    createdAt: new Date().toISOString(),
  },
];

/** 加载所有 Provider 配置 */
function loadAll() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    // 首次运行，写入默认配置
    saveAll(DEFAULT_PROVIDERS);
    return JSON.parse(JSON.stringify(DEFAULT_PROVIDERS));
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    log.error(`Failed to load AI config: ${e.message}`);
    return [];
  }
}

/** 保存所有 Provider 配置 */
function saveAll(providers) {
  ensureConfigDir();
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(providers, null, 2), 'utf-8');
    return true;
  } catch (e) {
    log.error(`Failed to save AI config: ${e.message}`);
    return false;
  }
}

/** 确保配置目录存在 */
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** 获取所有 Provider */
function getAll() {
  return loadAll();
}

/** 按 ID 获取 Provider */
function getById(id) {
  const providers = loadAll();
  return providers.find((p) => p.id === id) || null;
}

/** 获取首个激活的 Provider（按优先级排序） */
function getActiveProvider() {
  const providers = loadAll()
    .filter((p) => p.isActive)
    .sort((a, b) => a.priority - b.priority);
  return providers[0] || null;
}

/** 获取所有激活的 Provider（按优先级排序） */
function getActiveProviders() {
  return loadAll()
    .filter((p) => p.isActive)
    .sort((a, b) => a.priority - b.priority);
}

/** 创建或更新 Provider */
function saveProvider(provider) {
  const providers = loadAll();
  const idx = providers.findIndex((p) => p.id === provider.id);

  if (idx >= 0) {
    // 更新
    providers[idx] = { ...providers[idx], ...provider, updatedAt: new Date().toISOString() };
  } else {
    // 新增
    providers.push({
      ...provider,
      id: provider.id || 'provider-' + Date.now(),
      createdAt: new Date().toISOString(),
    });
  }

  return saveAll(providers);
}

/** 删除 Provider */
function deleteProvider(id) {
  const providers = loadAll().filter((p) => p.id !== id);
  return saveAll(providers);
}

/** 重新排序优先级 */
function reorderPriorities(providerIds) {
  const providers = loadAll();
  const map = {};
  providers.forEach((p) => { map[p.id] = p; });

  const reordered = providerIds
    .filter((id) => map[id])
    .map((id, idx) => {
      map[id].priority = idx;
      return map[id];
    });

  // 补回未在排序列表中的
  const remaining = providers.filter((p) => !providerIds.includes(p.id));
  remaining.forEach((p) => { p.priority = reordered.length; });
  reordered.push(...remaining);

  return saveAll(reordered);
}

/** 获取支持的 Provider 类型定义 */
function getProviderTypes() {
  return PROVIDER_TYPES;
}

/**
 * 测试 Provider 真实调用能力（连通性 + 模型响应）
 * @param {string} providerId - Provider ID
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function testConnection(providerId) {
  const { AIClient } = require('./ai-client');
  const provider = getById(providerId);
  if (!provider) {
    return { ok: false, message: 'Provider 不存在' };
  }

  const client = new AIClient(provider);
  return client.testGeneration();
}

/**
 * 直接测试 Provider 真实调用能力（不经过存储，用于表单预览）
 * @param {Object} provider - 完整的 Provider 配置对象
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function testConnectionDirect(provider) {
  const { AIClient } = require('./ai-client');
  if (!provider || !provider.baseUrl) {
    return { ok: false, message: 'Provider 配置不完整，请填写 API 地址' };
  }
  const client = new AIClient(provider);
  return client.testGeneration();
}

module.exports = {
  getAll,
  getById,
  getActiveProvider,
  getActiveProviders,
  saveProvider,
  deleteProvider,
  reorderPriorities,
  getProviderTypes,
  testConnection,
  testConnectionDirect,
  PROVIDER_TYPES,
};
