/**
 * Recording.js - 录制数据模型
 * 对应 Tampermonkey 导出的录制 JSON 格式
 * 包含响应体大小保护，防止大文件 OOM
 */

/** 单个响应体的最大字节数 (1MB)，超出截断 */
const MAX_BODY_SIZE = 1024 * 1024;

/**
 * 截断过大的响应体，防止 OOM
 * @param {*} body - 响应体
 * @param {number} maxBytes - 最大字节数
 * @returns {*}
 */
function truncateBody(body, maxBytes) {
  if (body === null || body === undefined) return body;
  try {
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    if (Buffer.byteLength(str, 'utf-8') <= maxBytes) return body;
    // 截断字符串
    const truncated = str.slice(0, Math.floor(maxBytes * 0.9));
    return truncated + '... [QM_TRUNCATED]';
  } catch {
    return body;
  }
}

/**
 * @typedef {Object} APIRequest
 * @property {number} seq - 接口序号
 * @property {string} time - 请求时间 ISO 格式
 * @property {string} method - HTTP 方法
 * @property {string} url - 完整请求 URL
 * @property {number} status - HTTP 状态码
 * @property {string} type - 请求类型 (XHR/Fetch)
 * @property {string} duration - 耗时如 "320ms"
 * @property {Object} requestHeaders - 请求头
 * @property {Object|string|null} requestBody - 请求体
 * @property {Object|string|null} responseBody - 响应体
 */

/**
 * @typedef {Object} EnvironmentInfo
 * @property {string} baseURL - 基础 URL
 * @property {string} authType - 认证类型 (token/cookie/basic/none)
 * @property {Object} [authConfig] - 认证配置
 * @property {string} [authConfig.tokenPath] - token 在响应中的路径如 "data.token"
 * @property {string} [authConfig.loginEndpoint] - 登录接口 path
 * @property {Object} [authConfig.globalHeaders] - 全局请求头
 * @property {Object} [variables] - 全局变量
 */

/**
 * @typedef {Object} Scenario
 * @property {string} id - 场景唯一 ID
 * @property {string} name - 场景名称
 * @property {EnvironmentInfo} environment - 环境信息
 * @property {APIRequest[]} records - 请求记录
 * @property {Object} metadata - 元数据
 * @property {string} metadata.createdAt - 创建时间
 * @property {string} metadata.sourceUrl - 来源 URL
 * @property {string[]} metadata.tags - 标签
 */

class Recording {
  /**
   * @param {Object} data - 从 JSON 解析的数据
   */
  constructor(data) {
    if (Array.isArray(data)) {
      this.scenarios = data.map((s, i) => this._normalizeScenario(s, i));
    } else {
      this.scenarios = [this._normalizeScenario(data, 0)];
    }
  }

  _normalizeScenario(scenario, index) {
    return {
      id: scenario.id || `scenario_${Date.now()}_${index}`,
      name: scenario.scenarioName || scenario.name || `场景 ${index + 1}`,
      environment: scenario.environment || {
        baseURL: '',
        authType: 'none',
      },
      records: (scenario.records || []).map((r, i) => ({
        seq: r.seq || i + 1,
        time: r.time || '',
        method: (r.method || 'GET').toUpperCase(),
        url: r.url || '',
        status: r.status || 0,
        type: r.type || 'XHR',
        duration: r.duration || '',
        requestHeaders: r.requestHeaders || {},
        enabled: r.enabled !== undefined ? r.enabled : true,
        ref: r.ref || '',
        requestBody: r.requestBody ?? null,
        responseHeaders: r.responseHeaders || {},
        contentType: r.contentType || '',
        responseBody: truncateBody(r.responseBody, MAX_BODY_SIZE) ?? null,
      })),
      metadata: {
        createdAt: scenario.startTime || new Date().toISOString(),
        sourceUrl: scenario.sourceUrl || '',
        tags: scenario.tags || [],
      },
    };
  }

  /**
   * 获取所有记录的扁平列表
   */
  getAllRecords() {
    return this.scenarios.flatMap((s) =>
      s.records.map((r) => ({ ...r, scenarioName: s.name }))
    );
  }

  /**
   * 统计信息
   */
  getStats() {
    const allRecords = this.getAllRecords();
    const total = allRecords.length;
    const methods = {};
    allRecords.forEach((r) => {
      const m = r.method;
      methods[m] = (methods[m] || 0) + 1;
    });
    return {
      scenarioCount: this.scenarios.length,
      totalRequests: total,
      recordCount: total,
      methods,
      domains: [...new Set(allRecords.map((r) => {
        try { return new URL(r.url).host; } catch { return ''; }
      }).filter(Boolean))],
    };
  }
}

module.exports = { Recording, truncateBody };
