/**
 * swagger-enricher.js - Swagger apiName 增强 Agent
 *
 * 从 Swagger 文档获取 API 摘要，按 (method, normalizedPath) 匹配
 * 替换用例中的 apiName 为更有业务含义的名称。
 *
 * 调用方式：从 ReviewPage 点击"Swagger 增强"按钮触发
 */
const { BaseAgent } = require('./base-agent');
const http = require('http');
const https = require('https');
const logger = require('../core/logger');

const log = logger.create('SwaggerEnricher');

class SwaggerEnricherAgent extends BaseAgent {
  constructor(opts = {}) {
    super({ id: 'swagger-enricher', name: 'SwaggerEnricher', ...opts });
  }

  /**
   * @param {Object} input
   * @param {Object} input.caseVo - 用例对象
   * @param {string} [input.swaggerUrl] - Swagger JSON URL（可选，自动发现）
   * @param {string} [input.baseURL] - 基准 URL（用于自动发现 doc.html）
   */
  async execute(input) {
    const caseVo = input.caseVo;
    const apis = caseVo?.apiVos || [];
    if (!apis.length) throw new Error('用例为空，无法增强');

    const baseURL = input.baseURL || this._extractBaseURL(apis);
    if (!baseURL) {
      return { enriched: false, message: '无法确定基准 URL，跳过 Swagger 增强', caseVo };
    }

    // 1. 发现 Swagger 文档 URL
    let swaggerUrl = input.swaggerUrl || '';
    if (!swaggerUrl) {
      swaggerUrl = await this._discoverSwaggerUrl(baseURL);
    }
    if (!swaggerUrl) {
      return { enriched: false, message: '未找到 Swagger 文档，跳过增强', caseVo };
    }

    // 2. 获取并解析 Swagger/OpenAPI 文档
    this._updateProgress(10, '获取 Swagger 文档...');
    const swaggerDoc = await this._fetchJSON(swaggerUrl);
    if (!swaggerDoc) {
      return { enriched: false, message: '获取 Swagger 文档失败', caseVo };
    }

    // 3. 构建路径→名称映射
    this._updateProgress(40, '构建 API 名称映射...');
    const nameMap = this._buildNameMap(swaggerDoc);
    log.info(`Swagger 文档包含 ${Object.keys(nameMap).length} 个已命名 API`);

    // 4. 匹配并替换 apiName
    this._updateProgress(60, '匹配替换 apiName...');
    let matchCount = 0;
    for (const api of apis) {
      const method = (api.apiMethod || 'get').toLowerCase();
      let path = api.apiUrl || '';
      // 提取路径部分（去除域名和 query）
      try {
        const urlObj = new URL(path, baseURL);
        path = urlObj.pathname;
      } catch {
        // 已经是相对路径
      }
      // 归一化路径：替换数字ID为 {param}
      const normalizedPath = this._normalizePath(path);
      const key = `${method}:${normalizedPath}`;

      if (nameMap[key]) {
        api.apiName = nameMap[key];
        matchCount++;
      } else {
        // 尝试不带参数归一化的原始路径匹配
        const rawKey = `${method}:${path}`;
        if (nameMap[rawKey]) {
          api.apiName = nameMap[rawKey];
          matchCount++;
        }
      }
    }

    this._updateProgress(90, `增强完成，匹配 ${matchCount}/${apis.length} 个接口`);

    // 5. 输出增强结果
    return {
      enriched: true,
      matchCount,
      totalApis: apis.length,
      swaggerUrl,
      message: `Swagger 增强完成，已匹配 ${matchCount}/${apis.length} 个接口`,
      caseVo,
    };
  }

  /**
   * 从用例如 apiUrl 中提取基准 URL
   */
  _extractBaseURL(apis) {
    for (const api of apis) {
      const url = api.apiUrl || '';
      const match = url.match(/^(https?:\/\/[^\/]+)/);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * 自动发现 Swagger 文档 URL
   * 尝试常见路径：/v2/api-docs, /v3/api-docs, /swagger-resources, /api-docs
   */
  async _discoverSwaggerUrl(baseURL) {
    const candidates = [
      '/v2/api-docs',
      '/v3/api-docs',
      '/swagger-resources',
      '/api-docs',
      '/swagger.json',
      '/openapi.json',
    ];
    for (const path of candidates) {
      try {
        const url = baseURL + path;
        const resp = await this._fetchJSON(url, true);
        if (resp) {
          // 检查是否是有效的 Swagger 文档
          if (resp.swagger || resp.openapi || resp.paths || resp.apis) {
            log.info(`自动发现 Swagger 文档: ${url}`);
            return url;
          }
          // swagger-resources 返回列表，取第一个
          if (Array.isArray(resp) && resp.length > 0 && resp[0].url) {
            const realUrl = baseURL + resp[0].url;
            log.info(`通过 swagger-resources 发现: ${realUrl}`);
            return realUrl;
          }
        }
      } catch { /* 忽略失败 */ }
    }
    return null;
  }

  /**
   * 构建 (method:normalizedPath) → summary/operationId 映射
   */
  _buildNameMap(swaggerDoc) {
    const map = {};
    const paths = swaggerDoc.paths || {};

    for (const [path, methods] of Object.entries(paths)) {
      if (!methods || typeof methods !== 'object') continue;

      for (const [method, operation] of Object.entries(methods)) {
        if (!operation || typeof operation !== 'object') continue;
        if (!['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method)) continue;

        // 优先使用 summary，其次 operationId，最后 tags[0]
        let name = operation.summary || operation.operationId || '';
        if (!name && Array.isArray(operation.tags) && operation.tags.length > 0) {
          name = operation.tags[0] + '_' + path.replace(/[\/{}]/g, '_').replace(/^_/, '');
        }
        if (name) {
          const normalizedPath = this._normalizePath(path);
          map[`${method}:${normalizedPath}`] = name;
          // 也存一份原始路径
          map[`${method}:${path}`] = name;
        }
      }
    }
    return map;
  }

  /**
   * 归一化路径：将路径中的数字ID替换为 {param}
   * /api/v1/user/123 → /api/v1/user/{param}
   */
  _normalizePath(path) {
    return path.replace(/\/\d+/g, '/{param}');
  }

  /**
   * 获取 JSON 内容（支持 http/https）
   */
  _fetchJSON(url, silent = false) {
    return new Promise((resolve) => {
      try {
        const fetcher = url.startsWith('https') ? https : http;
        const req = fetcher.get(url, { timeout: 10000 }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              if (!silent) log.warn(`Swagger 文档解析失败: ${url}`);
              resolve(null);
            }
          });
        });
        req.on('error', (e) => {
          if (!silent) log.warn(`Swagger 获取失败: ${url} - ${e.message}`);
          resolve(null);
        });
        req.on('timeout', () => { req.destroy(); resolve(null); });
      } catch {
        resolve(null);
      }
    });
  }
}

module.exports = { SwaggerEnricherAgent };
