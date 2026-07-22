/**
 * cleaner.js - Agent-1: 数据清洗
 * 功能：噪音过滤、URL 归一化去重、按时间排序重编号、环境信息提取
 */

const { BaseAgent } = require('./base-agent');
const path = require('path');

const logger = require('../core/logger');
const log = logger.create('Cleaner');

// 噪音 URL 关键字
const NOISE_URL_KEYWORDS = [
  'datacollect', '/collect/', 'biz-monitor',
  '.css', '.png', '.jpg', '.gif', '.svg', '.woff', '.ttf',
  '.ico', 'heartbeat', 'track.gif', 'stats.',
  '/log?', '/log/', 'hm.gif', 'baidu.com/hm',
];
const NOISE_URL_PATTERNS = [
  /\.js(?=[?/$])/,
  /\/log(?=[?/$])/,
  /\/metrics/,
  /\/actuator\//,
];

class CleanerAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      id: 'cleaner',
      name: '数据清洗',
      description: '过滤噪音、URL 去重、重编号',
      ...opts,
    });
  }

  async execute(input) {
    this._updateProgress(0, '开始数据清洗...');
    log.info('开始数据清洗');

    const rawRecords = input.data || [];
    if (!rawRecords || rawRecords.length === 0) {
      log.warn('输入数据为空，请先导入录制 JSON');
      throw new Error('输入数据为空，请先导入录制 JSON');
    }

    log.info(`共 ${rawRecords.length} 条原始记录`);
    this._updateProgress(10, `共 ${rawRecords.length} 条原始记录`);

    // Step 1: 过滤噪音
    const kept = [];
    let noiseCount = 0;
    for (const r of rawRecords) {
      if (this._isNoise(r.url || '')) {
        noiseCount++;
        continue;
      }
      kept.push(this._normalizeRecord(r));
    }

    log.info(`过滤 ${noiseCount} 条噪音，剩余 ${kept.length} 条`);

    // Step 2: URL 归一化 + 去重
    const seen = new Set();
    const deduped = [];
    let dupCount = 0;
    for (const r of kept) {
      const normUrl = this._normalizeUrl(r.url);
      const key = `${r.method}|${normUrl}`;
      if (seen.has(key)) {
        dupCount++;
        continue;
      }
      seen.add(key);
      deduped.push({ ...r, urlNormalized: normUrl });
    }

    this._updateProgress(50, `去重合并 ${dupCount} 条，最终 ${deduped.length} 条`);
    log.info(`去重合并 ${dupCount} 条，最终 ${deduped.length} 条`);

    // Step 3: 按时间排序
    deduped.sort((a, b) => {
      if (a.time < b.time) return -1;
      if (a.time > b.time) return 1;
      return 0;
    });

    // Step 4: 重编号
    const cleaned = deduped.map((r, i) => ({
      ...r,
      seq: i + 1,
    }));

    // Step 5: 从响应体推导断言
    this._updateProgress(60, '从响应体推导断言...');
    const enriched = cleaned.map(r => ({
      ...r,
      inferredAssertions: this._inferAssertions(r),
      responseKeyFields: this._extractKeyFields(r),
    }));

    this._updateProgress(70, `共推导 ${enriched.reduce((s, r) => s + (r.inferredAssertions || []).length, 0)} 个断言`);

    // Step 6: 自动提取环境信息
    const envInfo = this._extractEnvInfo(enriched);

    this._updateProgress(80, '环境信息提取完成');
    log.info('环境信息提取完成');

    // Step 7: 统计输出
    const stats = {
      totalOriginal: rawRecords.length,
      noiseFiltered: noiseCount,
      dedupMerged: dupCount,
      finalCount: enriched.length,
      totalInferredAssertions: enriched.reduce((s, r) => s + (r.inferredAssertions || []).length, 0),
      methods: [...new Set(enriched.map((r) => r.method))],
      domains: [...new Set(enriched.map((r) => {
        try { return new URL(r.url).host; } catch { return ''; }
      }).filter(Boolean))],
    };

    // 写入文件
    const cleanedPath = this._writeJSON(
      path.join(this.outDir, 'cleaned.json'), enriched
    );
    const assertionsPath = this._writeJSON(
      path.join(this.outDir, 'inferred-assertions.json'), enriched.map(r => ({
        seq: r.seq, method: r.method, url: r.url,
        assertions: r.inferredAssertions,
      }))
    );
    const envPath = this._writeJSON(
      path.join(this.outDir, 'env-config.json'), envInfo
    );
    const statsPath = this._writeJSON(
      path.join(this.outDir, 'stats.json'), stats
    );

    this._updateProgress(100, '数据清洗完成');
    log.info(`数据清洗完成: ${stats.finalCount}/${stats.totalOriginal} 条保留`);

    return {
      records: enriched,
      environment: envInfo,
      stats,
      outputFiles: {
        cleaned: cleanedPath,
        environment: envPath,
        stats: statsPath,
        inferredAssertions: assertionsPath,
      },
    };
  }

  _isNoise(url) {
    const low = url.toLowerCase();
    if (NOISE_URL_KEYWORDS.some((kw) => low.includes(kw))) return true;
    if (NOISE_URL_PATTERNS.some((p) => p.test(low))) return true;
    return false;
  }

  _normalizeUrl(path) {
    // 把路径里的数字 ID 替换为 {id}，用于去重
    return path.replace(/\/\d{3,}(?=\/|$|\?)/g, '/{id}');
  }

  _normalizeRecord(r) {
    let domain = '', pathname = '';
    try {
      const u = new URL(r.url);
      domain = u.origin;
      pathname = u.pathname + (u.search || '');
    } catch { /* keep empty */ }

    return {
      seq: 0,
      time: r.time || '',
      method: (r.method || 'GET').toUpperCase(),
      url: r.url || '',
      domain,
      path: pathname,
      status: r.status || 0,
      type: r.type || 'XHR',
      duration: r.duration || '',
      scenarioName: r.scenarioName || '',
      requestHeaders: r.requestHeaders || {},
      requestBody: r.requestBody ?? null,
      responseBody: r.responseBody ?? null,
    };
  }

  _extractEnvInfo(records) {
    // 聚合 domains
    const domainCount = new Map();
    const authTypes = new Set();
    let tokenPath = '';

    for (const r of records) {
      if (r.domain) {
        domainCount.set(r.domain, (domainCount.get(r.domain) || 0) + 1);
      }

      // 检测认证方式
      const hdrs = r.requestHeaders || {};
      const keys = Object.keys(hdrs).map((k) => k.toLowerCase());
      if (keys.some((k) => k.includes('authorization'))) authTypes.add('basic');
      else if (keys.some((k) => ['token', 'x-token', 'x-csrf-token', 'x-xsrf-token',
          'x-auth-token', 'access-token', 'accesstoken', 'csrf-token'].includes(k)))
        authTypes.add('token');
      else if (keys.some((k) => k === 'cookie')) authTypes.add('cookie');

      // 找 token
      if (!tokenPath && r.responseBody && typeof r.responseBody === 'object') {
        tokenPath = this._findTokenPath(r.responseBody, '') || '';
      }
    }

    const sorted = [...domainCount.entries()].sort((a, b) => b[1] - a[1]);
    const baseURL = sorted.length > 0 ? sorted[0][0] : '';
    const authType = authTypes.has('basic') ? 'basic'
                   : authTypes.has('token') ? 'token'
                   : authTypes.has('cookie') ? 'cookie'
                   : 'none';

    return {
      baseURL,
      authType,
      authConfig: tokenPath ? { tokenPath } : {},
      domains: sorted.map(([d, c]) => ({ domain: d, count: c })),
    };
  }

  _findTokenPath(obj, path) {
    if (!obj || typeof obj !== 'object') return null;
    for (const [key, value] of Object.entries(obj)) {
      const curPath = path ? `${path}.${key}` : key;
      if (['token', 'access_token', 'accesstoken', 'x-auth-token',
          'refresh_token', 'jwt', 'session_id', 'sessionid', 'sid'].includes(key.toLowerCase())) {
        return curPath;
      }
      if (typeof value === 'object') {
        const found = this._findTokenPath(value, curPath);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * 解析响应体（支持对象和 JSON 字符串）
   */
  _parseBody(body) {
    if (!body) return null;
    if (typeof body === 'object') return body;
    try { return JSON.parse(body); } catch { return null; }
  }

  /**
   * 从记录中推导断言
   * 策略：
   * 1. HTTP 状态码断言
   * 2. 响应体中的 code / status / success 字段断言
   * 3. 对 GET 请求，提取 data 下关键字段的存在性断言
   * 4. 对 POST 创建类请求，断言响应中的 id 字段
   */
  _inferAssertions(record) {
    const assertions = [];
    const body = this._parseBody(record.responseBody);
    const method = (record.method || 'GET').toUpperCase();

    // 1. HTTP 状态码断言（从实际 status 反推响应体中的状态字段）
    //    先检查 body 中是否有匹配 HTTP 状态的字段，不使用硬编码 field name
    let httpStatusAssertionCreated = false;
    if (record.status && body && typeof body === 'object') {
      const HTTP_STATUS_FIELDS = ['statusCode', 'code', 'status', 'ret', 'errorCode', 'errCode', 'resultCode'];
      const statusStr = String(record.status);
      for (const field of HTTP_STATUS_FIELDS) {
        if (field in body && String(body[field]) === statusStr) {
          assertions.push({
            expression: `responseBody.${field}`,
            expectValue: statusStr,
            validateType: 3,
            source: 'inferred_status',
          });
          httpStatusAssertionCreated = true;
          break;
        }
      }
    }

    if (!body || typeof body !== 'object') return assertions;

    // 2. 响应顶层常见状态字段（跳过第1步已创建的断言）
    const alreadyHandledAtHttpStep = assertions.length > 0 && httpStatusAssertionCreated
      ? assertions[assertions.length - 1].expression.replace('responseBody.', '') : null;
    const STATUS_FIELDS = ['statusCode', 'code', 'status', 'ret', 'errorCode', 'errCode', 'resultCode'];
    for (const field of STATUS_FIELDS) {
      if (field === alreadyHandledAtHttpStep) continue;
      if (field in body && body[field] !== null && body[field] !== undefined) {
        const val = typeof body[field] === 'number' ? String(body[field]) : String(body[field]);
        // 跳过太大的值（可能是 ID）
        if (typeof body[field] === 'number' && body[field] > 99999) continue;
        assertions.push({
          expression: `responseBody.${field}`,
          expectValue: val,
          validateType: 3,
          source: 'inferred_response_field',
        });
      }
    }

    // 3. success 布尔字段
    if ('success' in body) {
      assertions.push({
        expression: 'responseBody.success',
        expectValue: body.success ? 'true' : 'false',
        validateType: 3,
        source: 'inferred_success',
      });
    }

    // 4. message/msg 字段存在性（值非空）
    if ('message' in body && body.message) {
      assertions.push({
        expression: 'responseBody.message',
        expectValue: String(body.message),
        validateType: 3,
        source: 'inferred_message',
      });
    }

    // 5. data 下的关键字段
    const data = body && typeof body.data === 'object' ? body.data : null;
    if (data) {
      const keys = Object.keys(data);
      // 对 GET 和非创建类请求，断言 data 字段存在
      if (method === 'GET' || !method.endsWith('POST')) {
        for (const key of keys) {
          const val = data[key];
          if (val === null || val === undefined) continue;
          // 跳过太长的字符串、对象、数组
          if (typeof val === 'object') continue;
          if (typeof val === 'string' && val.length > 200) continue;

          const path = `responseBody.data.${key}`;
          // 避免与已有断言重复
          if (assertions.some(a => a.expression === path)) continue;
          assertions.push({
            expression: path,
            expectValue: typeof val === 'number' ? String(val) : String(val),
            validateType: 3,
            source: 'inferred_data_field',
          });
        }
      }

      // 对 POST 创建类请求，断言 responseBody.data.id 或 data.xxxId 存在
      if (method === 'POST' || method === 'PUT') {
        for (const key of keys) {
          if (key === 'id' || key.endsWith('Id') || key.endsWith('ID')) {
            const val = data[key];
            if (val !== null && val !== undefined) {
              const path = `responseBody.data.${key}`;
              if (!assertions.some(a => a.expression === path)) {
                assertions.push({
                  expression: path,
                  expectValue: String(val),
                  validateType: 3,
                  source: 'inferred_creation_id',
                });
              }
            }
          }
        }
      }
    }

    // 6. 分页相关
    if (data && typeof data === 'object') {
      for (const field of ['total', 'pageSize', 'totalCount', 'pageNum', 'totalPages', 'currentPage']) {
        if (field in data && typeof data[field] === 'number') {
          const path = `responseBody.data.${field}`;
          if (!assertions.some(a => a.expression === path)) {
            assertions.push({
              expression: path,
              expectValue: String(data[field]),
              validateType: 3,
              source: 'inferred_pagination',
            });
          }
        }
      }
    }

    // 最多保留 8 个断言避免冗余
    return assertions.slice(0, 8);
  }

  /**
   * 提取响应体中的关键字段值（用于快速查看）
   */
  _extractKeyFields(record) {
    const body = this._parseBody(record.responseBody);
    if (!body || typeof body !== 'object') return {};
    const result = {};
    for (const key of ['statusCode', 'code', 'status', 'success', 'message', 'msg']) {
      if (key in body) result[key] = body[key];
    }
    if (body.data && typeof body.data === 'object') {
      for (const key of ['id', 'token', 'total', 'pageSize']) {
        if (key in body.data) result[`data.${key}`] = body.data[key];
      }
    }
    return result;
  }
}

module.exports = { CleanerAgent };
