/**
 * Environment.js - 环境配置模型
 * 管理测试环境的自动识别与用户配置
 */

const ENV_TYPES = {
  DEV: { id: 0, name: 'dev', label: '开发环境' },
  TEST: { id: 1, name: 'test', label: '测试环境' },
  PRE: { id: 2, name: 'pre', label: '预发布环境' },
  PROD: { id: 3, name: 'prod', label: '生产环境' },
};

class Environment {
  /**
   * @param {Object} opts
   * @param {string} opts.name - 环境名称
   * @param {string} opts.baseURL - 基础 URL
   * @param {'token'|'cookie'|'basic'|'none'} opts.authType - 认证类型
   * @param {Object} opts.authConfig - 认证配置
   * @param {Object} opts.globalHeaders - 全局请求头
   * @param {Object} opts.variables - 全局变量
   * @param {number} opts.envType - 环境类型 0-3
   * @param {Array} [opts.variablesDefinition] - 变量定义列表 [{name, value, description}]
   * @param {string[]} [opts.linkedDataPoolIds] - 关联的数据池 ID 列表
   */
  constructor(opts = {}) {
    this.id = opts.id || `env_${Date.now()}`;
    this.name = opts.name || '';
    this.baseURL = opts.baseURL || '';
    this.authType = opts.authType || 'none';
    this.authConfig = {
      tokenPath: opts.authConfig?.tokenPath || '',
      loginEndpoint: opts.authConfig?.loginEndpoint || '',
      globalHeaders: opts.authConfig?.globalHeaders || {},
    };
    this.globalHeaders = opts.globalHeaders || {};
    this.variables = opts.variables || {};
    this.variablesDefinition = opts.variablesDefinition || [];  // 用于 UI 展示的变量列表
    this.linkedDataPoolIds = opts.linkedDataPoolIds || [];      // 关联的数据池
    this.envType = opts.envType ?? 1; // 默认为 TEST
    this.domains = opts.domains || []; // [{domain, count}]
    this.createdAt = opts.createdAt || new Date().toISOString();
  }

  /**
   * 从录制数据自动提取环境信息
   * @param {import('./Recording').APIRequest[]} records
   * @returns {Environment}
   */
  static fromRecords(records) {
    if (!records || records.length === 0) {
      return new Environment({ name: '未识别' });
    }

    // 提取 domains 并按频率排序
    const domains = new Map();
    for (const r of records) {
      try {
        const u = new URL(r.url);
        const origin = u.origin;
        domains.set(origin, (domains.get(origin) || 0) + 1);
      } catch { /* skip */ }
    }

    // 取最常用的 domain 作为 baseURL
    const sorted = [...domains.entries()].sort((a, b) => b[1] - a[1]);
    const baseURL = sorted.length > 0 ? sorted[0][0] : '';

    // 检测认证方式
    let authType = 'none';
    const authConfig = {};
    for (const r of records) {
      const hdrs = r.requestHeaders || {};
      const hdrKeys = Object.keys(hdrs).map((k) => k.toLowerCase());
      if (hdrKeys.some((k) => k.includes('authorization'))) {
        authType = 'basic';
        break;
      }
      if (hdrKeys.some((k) => k === 'token' || k.includes('x-token') || k.includes('x-csrf'))) {
        authType = 'token';
        break;
      }
      if (hdrKeys.some((k) => k === 'cookie' || k === 'set-cookie')) {
        authType = 'cookie';
      }
    }

    // 尝试从响应中找 token 路径
    for (const r of records) {
      if (r.responseBody && typeof r.responseBody === 'object') {
        const found = Environment._findTokenPath(r.responseBody, '');
        if (found) {
          authConfig.tokenPath = found;
          break;
        }
      }
    }

    return new Environment({
      name: baseURL ? `Auto-${baseURL.replace(/^https?:\/\//, '').replace(/[.:]/g, '-')}` : '未识别',
      baseURL,
      authType,
      authConfig,
      domains: sorted.map(([domain, count]) => ({ domain, count })),
    });
  }

  /**
   * 递归查找 token 字段路径
   */
  static _findTokenPath(obj, path) {
    if (!obj || typeof obj !== 'object') return null;
    for (const [key, value] of Object.entries(obj)) {
      const curPath = path ? `${path}.${key}` : key;
      const keyLower = key.toLowerCase();
      if (['token', 'access_token', 'accesstoken', 'x-auth-token'].includes(keyLower)) {
        return curPath;
      }
      if (typeof value === 'object') {
        const found = Environment._findTokenPath(value, curPath);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * 序列化
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      baseURL: this.baseURL,
      authType: this.authType,
      authConfig: this.authConfig,
      globalHeaders: this.globalHeaders,
      variables: this.variables,
      variablesDefinition: this.variablesDefinition,
      linkedDataPoolIds: this.linkedDataPoolIds,
      envType: this.envType,
      domains: this.domains,
      createdAt: this.createdAt,
    };
  }
}

module.exports = { Environment, ENV_TYPES };
