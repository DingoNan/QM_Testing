/**
 * regression-runner.js - 回归验证 Agent
 * 功能：发送真实 HTTP 请求验证每个接口的断言
 * 支持依赖链：前序接口结果可被后序引用
 * 增强支持：
 *   - 循环迭代模式（loop）
 *   - 前置/后置脚本
 *   - 统一变量解析（VarResolver 5 命名空间）
 *   - 运行时函数
 *   - 串联规则
 * 限流：200ms 间隔，防止被服务器封
 */
const { BaseAgent } = require('./base-agent');
const { mergeGlobalHeaders } = require('./utils');
const { VariableResolver } = require('../models/VarResolver');
const { ScriptEngine } = require('./ScriptEngine');
const { TestDataPool } = require('../models/TestDataPool');
const { ChainRule } = require('../models/ChainRule');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const logger = require('../core/logger');
const log = logger.create('RegressionRunner');

class RegressionRunnerAgent extends BaseAgent {
  // 变量引用正则缓存 (匹配 ${xxx} 或 ${seq.x.y} 格式)
  static VAR_REF_REGEXP = new RegExp('\\${([^}]+)}', 'g');

  constructor(opts = {}) {
    super({
      id: 'regression-runner',
      name: '回归验证',
      description: '真实 HTTP 请求验证接口断言（支持循环迭代和脚本）',
      ...opts,
    });
    this.results = [];
    this.varResolver = new VariableResolver();
    this.scriptEngine = new ScriptEngine();
  }

  /**
   * 执行回归验证
   * @param {Object} input
   * @param {Object} input.data - CaseVo JSON 对象
   * @param {Object} [input.envConfig] - 环境配置
   * @param {Array} [input.linkedRecords] - 关联数据
   * @param {Object} [input.dataPoolConfig] - 数据池配置（循环模式用）
   * @param {Array} [input.chainRules] - 串联规则
   * @param {string} [input.iterationMode] - 迭代模式 'loop' | 'expand' | 'none'
   * @returns {Promise<Object>}
   */
  async execute(input) {
    this._updateProgress(0, '开始回归验证...');
    log.info('开始回归验证');

    const raw = input.data || {};
    const caseVo = raw.caseVo || raw;
    const apis = caseVo.apiVos || [];
    const envConfig = input.envConfig || {};
    const linkedRecords = input.linkedRecords || [];

    // 扩展配置
    const dataPoolConfig = input.dataPoolConfig || caseVo.dataPool || null;
    const chainRules = input.chainRules || caseVo.chainRules || [];
    const iterationMode = input.iterationMode || caseVo.iterationMode || 'none';
    const staticMode = input.staticMode || this.opts?.staticMode || false;

    // 保存环境配置供 _executeApi 使用
    this._envConfig = envConfig;

    if (!apis || apis.length === 0) {
      log.warn('无用例数据，无法执行回归验证');
      throw new Error('无用例数据，无法执行回归验证');
    }

    log.info(`共 ${apis.length} 个接口待验证`);
    const baseURL = envConfig.baseURL || caseVo.domainName || '';
    const rateLimitMs = 200;

    this._updateProgress(5, `准备验证 ${apis.length} 个接口`);

    // ========== 静态分析模式 (只做表达式解析，不发请求) ==========
    if (staticMode) {
      return await this._executeStaticMode(apis, envConfig, linkedRecords, chainRules, baseURL, caseVo);
    }

    // ========== 循环迭代模式 (loop) ==========
    if (iterationMode === 'loop' && dataPoolConfig) {
      return await this._executeLoopMode(apis, envConfig, linkedRecords, dataPoolConfig, chainRules, baseURL, rateLimitMs, caseVo);
    }

    // ========== 标准模式 ==========
    return await this._executeStandardMode(apis, envConfig, linkedRecords, chainRules, baseURL, rateLimitMs, caseVo);
  }

  /**
   * 循环迭代模式：对数据池每行数据执行完整接口链
   */
  async _executeLoopMode(apis, envConfig, linkedRecords, dataPoolConfig, chainRules, baseURL, rateLimitMs, caseVo) {
    let dataPool;
    if (dataPoolConfig instanceof TestDataPool) {
      dataPool = dataPoolConfig;
    } else if (typeof dataPoolConfig === 'object' && dataPoolConfig.rows) {
      dataPool = new TestDataPool(dataPoolConfig);
    } else {
      log.warn('循环模式数据池配置无效，回退到标准模式');
      return await this._executeStandardMode(apis, envConfig, linkedRecords, chainRules, baseURL, rateLimitMs, caseVo);
    }

    const enabledRows = dataPool.getEnabledRows();
    log.info(`循环模式: ${enabledRows.length} 行数据行，${apis.length} 个接口`);

    // ctx 变量在行间积累（同 JMeter ForEach Controller）
    const accumulatedCtx = {};
    const allResults = [];

    for (let rowIdx = 0; rowIdx < enabledRows.length; rowIdx++) {
      if (this._status === 'failed') break;

      const dataRow = enabledRows[rowIdx];
      this._updateProgress(
        5 + Math.round((rowIdx / enabledRows.length) * 90),
        `数据行 ${rowIdx + 1}/${enabledRows.length}`
      );

      log.info(`--- 循环迭代 ${rowIdx + 1}/${enabledRows.length} ---`);

      // 当前行的上下文变量
      const contextVars = {};

      // 逐接口执行
      for (let i = 0; i < apis.length; i++) {
        if (this._status === 'failed') break;

        const api = apis[i];
        const rowScope = {
          ...accumulatedCtx,
          ...dataRow.values,
        };

        const result = await this._executeApi(
          api, i, baseURL, contextVars, linkedRecords,
          { dataRow: dataRow.values, ctxVars: rowScope, chainRules, rowIndex: rowIdx }
        );

        allResults.push({
          ...result,
          _rowIndex: rowIdx,
          _dataRow: dataRow.values,
        });

        // 将响应存入上下文
        if (result.responseBody) {
          contextVars[i] = result.responseBody;
        }

        if (i < apis.length - 1) {
          await this._sleep(rateLimitMs);
        }
      }

      // 行结束后，将该行的 ctx 变量积累到全局 accumulatedCtx
      if (contextVars._ctxScript) {
        Object.assign(accumulatedCtx, contextVars._ctxScript);
      }
    }

    this.results = allResults;
    const stats = this._computeStats();

    this._updateProgress(95, '写入回归报告');
    const reportData = {
      caseName: caseVo.name || '',
      stats,
      results: this.results,
      timestamp: new Date().toISOString(),
      environment: envConfig.environmentName || envConfig.name || '',
      apiCount: apis.length,
      iterationMode: 'loop',
      rowCount: enabledRows.length,
    };
    this._writeJSON(path.join(this.outDir, 'regression-report.json'), reportData);

    this._updateProgress(100, '回归验证完成');
    log.info(`循环模式完成: ${enabledRows.length} 行 x ${apis.length} 接口, ${stats.passed}/${stats.total} 通过`);

    return {
      ...reportData,
      outputFiles: {
        report: path.join(this.outDir, 'regression-report.json'),
      },
    };
  }

  /**
   * 标准模式：逐接口执行一次
   */
  async _executeStandardMode(apis, envConfig, linkedRecords, chainRules, baseURL, rateLimitMs, caseVo) {
    // 用于依赖链的上下文变量
    const contextVars = {};

    // 逐接口发送请求
    for (let i = 0; i < apis.length; i++) {
      if (this._status === 'failed') break;

      const api = apis[i];
      this._updateProgress(
        5 + Math.round((i / apis.length) * 85),
        `验证接口 ${i + 1}/${apis.length}: ${api.apiMethod} ${api.apiUrl}`
      );

      const result = await this._executeApi(
        api, i, baseURL, contextVars, linkedRecords,
        { chainRules }
      );
      this.results.push(result);
      log.info(`接口${i + 1}/${apis.length} ${api.apiMethod} ${api.apiUrl} \u2192 HTTP ${result.responseStatus} ${result.passed ? '通过' : '失败'}`);

      // 将响应值存入上下文（支持依赖链 ${seq.path}）
      if (result.responseBody) {
        contextVars[i] = result.responseBody;
        contextVars[`${i}_headers`] = result.responseHeaders || {};
      }

      // 限流
      if (i < apis.length - 1) {
        await this._sleep(rateLimitMs);
      }
    }

    // 统计
    const stats = this._computeStats();

    this._updateProgress(95, '写入回归报告');
    const reportData = {
      caseName: caseVo.name || '',
      stats,
      results: this.results,
      timestamp: new Date().toISOString(),
      environment: envConfig.environmentName || envConfig.name || '',
      apiCount: apis.length,
    };
    this._writeJSON(path.join(this.outDir, 'regression-report.json'), reportData);

    this._updateProgress(100, '回归验证完成');
    log.info(`回归验证完成: ${stats.passed}/${stats.total} 通过, ${stats.failed} 失败, ${stats.error} 错误`);

    return {
      ...reportData,
      outputFiles: {
        report: path.join(this.outDir, 'regression-report.json'),
      },
    };
  }

  /**
   * 静态分析模式：只做表达式替换和引用检查，不发真实请求
   */
  async _executeStaticMode(apis, envConfig, linkedRecords, chainRules, baseURL, caseVo) {
    // 用于依赖链的上下文变量
    const contextVars = {};
    const varResolver = new (require('../models/VarResolver').VariableResolver)();

    for (let i = 0; i < apis.length; i++) {
      const api = apis[i];
      this._updateProgress(
        5 + Math.round((i / apis.length) * 85),
        `静态分析 ${i + 1}/${apis.length}: ${api.apiMethod} ${api.apiUrl}`
      );

      // 解析表达式（和 _executeApi 同样的解析流程）
      const method = (api.apiMethod || 'GET').toUpperCase();
      let urlPath = api.apiUrl || '';
      let domain = api.domainName || baseURL;

      // 解析 URL 引用
      const resolveCtx = {
        ctx: contextVars,
        linkedRecords: linkedRecords || [],
        currentIndex: i,
        envConfig: envConfig || {},
        params: {},
      };
      try {
        urlPath = varResolver.resolve(urlPath, resolveCtx);
      } catch (e) {
        log.warn(`接口 ${i + 1} URL 解析失败: ${e.message}`);
      }

      // 检查引用是否有效
      let refIssues = [];
      const refRegex = /\$\{?(?:seq\.)?(\d+)(?:\.)/g;
      let match;
      while ((match = refRegex.exec(urlPath)) !== null) {
        const refSeq = parseInt(match[1], 10);
        const refIdx = refSeq - 1;
        if (refIdx < 0 || refIdx >= apis.length) {
          refIssues.push(`seq.${refSeq} 超出接口范围(1-${apis.length})`);
        } else if (!contextVars[refIdx] && refIdx >= i) {
          refIssues.push(`seq.${refSeq} 尚未执行 (当前接口 ${i + 1})`);
        }
      }

      const result = {
        apiIndex: i,
        apiName: api.apiName || '',
        apiMethod: method,
        apiUrl: api.apiUrl,
        resolvedUrl: urlPath,
        refIssues,
        status: refIssues.length > 0 ? 'REF_WARNING' : 'OK',
        passed: refIssues.length === 0,
        staticMode: true,
      };
      this.results.push(result);

      // 模拟上下文（用实际 apiUrl 存入，后续接口可检测引用）
      contextVars[i] = { _static: true, _resolved: urlPath };
    }

    const stats = {
      total: apis.length,
      passed: this.results.filter(r => r.passed).length,
      failed: this.results.filter(r => !r.passed).length,
      error: 0,
      staticMode: true,
    };

    this._updateProgress(95, '写入静态分析报告');
    const reportData = {
      caseName: caseVo.name || '',
      stats,
      results: this.results,
      timestamp: new Date().toISOString(),
      staticMode: true,
      apiCount: apis.length,
    };
    this._writeJSON(path.join(this.outDir, 'static-analysis-report.json'), reportData);

    this._updateProgress(100, '静态分析完成');
    log.info(`静态分析完成: ${stats.passed}/${stats.total} 通过, ${stats.failed} 引用警告`);

    return {
      ...reportData,
      outputFiles: {
        report: path.join(this.outDir, 'static-analysis-report.json'),
      },
    };
  }

  /**
   * 执行单个接口请求和断言验证
   */
  async _executeApi(api, index, baseURL, contextVars, linkedRecords, extraOpts = {}) {
    const method = (api.apiMethod || 'GET').toUpperCase();
    let urlPath = api.apiUrl || '';

    // 解析域名
    let domain = api.domainName || baseURL;
    if (!domain && baseURL) domain = baseURL;

    // 获取环境配置用于变量替换和注入
    const envConfig = this._envConfig || {};
    const globalHeaders = envConfig.globalHeaders || {};

    // 解析请求头
    let headers = api.requestHeaders;
    if (typeof headers === 'string') {
      try { headers = JSON.parse(headers); } catch { headers = {}; }
    }
    if (!headers || typeof headers !== 'object') headers = {};

    // 注入全局请求头（不覆盖已存在的值）
    if (Object.keys(globalHeaders).length > 0) {
      headers = mergeGlobalHeaders(headers, globalHeaders);
    }

    // 解析请求体
    let body = api.requestBody;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* keep as string */ }
    }

    const { dataRow = {}, ctxVars = {}, chainRules = [], rowIndex = 0 } = extraOpts;

    // ========== 1. 构建 VarResolver 上下文 ==========
    const resolverContext = {
      envConfig,
      dataRow,
      params: extraOpts.params || extraOpts.globalParams || {},
      ctxVars: { ...contextVars, ...ctxVars },
      seqResponses: contextVars,
      linkedRecords,
      currentIndex: index,
    };

    // ========== 2. 前置脚本 ==========
    if (api.apiScript && api.apiScript.preRequest) {
      const scriptCtx = {
        env: envConfig,
        ctx: { ...ctxVars },
        data: dataRow,
        sys: {},
        request: { method, url: urlPath, headers: { ...headers }, body: body !== undefined ? JSON.parse(JSON.stringify(body)) : undefined },
      };
      const modified = await this.scriptEngine.computePreRequest(api.apiScript.preRequest, scriptCtx);
      // 应用前置脚本的修改
      if (modified.request) {
        urlPath = modified.request.url || urlPath;
        headers = modified.request.headers || headers;
        body = modified.request.body !== undefined ? modified.request.body : body;
      }
      if (modified.ctx) {
        Object.assign(ctxVars, modified.ctx);
        Object.assign(resolverContext.ctxVars, modified.ctx);
        contextVars._ctxScript = { ...(contextVars._ctxScript || {}), ...modified.ctx };
      }
    }

    // ========== 3. 替换变量引用 ==========
    const resolved = this._resolveVariables(method, urlPath, headers, body, resolverContext);
    urlPath = resolved.urlPath;
    headers = resolved.headers;
    body = resolved.body;

    // ========== 4. 应用串联规则 ==========
    for (const ruleConfig of chainRules) {
      const rule = ruleConfig instanceof ChainRule ? ruleConfig : new ChainRule(ruleConfig);
      if (!rule.enabled) continue;
      if (rule.targetApiSeq !== index + 1) continue; // target to current API

      // Find source response
      const srcIdx = rule.sourceApiSeq - 1;
      const srcResponse = {
        body: contextVars[srcIdx],
        headers: contextVars[`${srcIdx}_headers`],
      };

      if (srcIdx >= 0 && srcResponse.body !== undefined) {
        const sourceValue = rule.extractValue(srcResponse);
        if (sourceValue !== undefined && sourceValue !== null) {
          const transformed = rule.transform.apply(sourceValue);
          const targetRequest = {
            url: urlPath,
            headers: { ...headers },
            body: body !== undefined ? JSON.parse(JSON.stringify(body)) : undefined,
            assertVos: api.assertVos || [],
          };
          const modified = rule.applyToTarget(targetRequest, String(transformed));
          urlPath = modified.url;
          headers = modified.headers;
          body = modified.requestBody !== undefined ? modified.requestBody : body;
          if (modified.assertVos) {
            api.assertVos = modified.assertVos;
          }
        }
      }
    }

    const startTime = Date.now();
    let response = null;
    let error = null;

    try {
      response = await this._sendRequest(method, domain, urlPath, headers, body);
    } catch (e) {
      error = e.message;
    }

    const duration = Date.now() - startTime;

    // ========== 5. 后置脚本 ==========
    let extraAssertions = [];
    if (api.apiScript && api.apiScript.postResponse && response) {
      const scriptCtx = {
        env: envConfig,
        ctx: { ...ctxVars },
        data: dataRow,
        sys: {},
        request: { method, url: urlPath, headers, body },
        response: {
          statusCode: response.statusCode,
          headers: response.headers,
          body: response.body,
          responseTime: duration,
        },
      };
      const postResult = await this.scriptEngine.computePostResponse(api.apiScript.postResponse, scriptCtx);
      if (postResult.ctx) {
        Object.assign(ctxVars, postResult.ctx);
        contextVars._ctxScript = { ...(contextVars._ctxScript || {}), ...postResult.ctx };
      }
      if (postResult.pmAssertions && postResult.pmAssertions.length > 0) {
        extraAssertions = postResult.pmAssertions;
      }
    }

    // ========== 6. 验证断言 ==========
    const assertionResults = this._verifyAssertions(api.assertVos || [], response);
    const allAssertions = [...assertionResults, ...extraAssertions];

    return {
      seq: index,
      apiName: api.apiName || `#${index + 1}`,
      method,
      url: domain + urlPath,
      requestHeaders: headers,
      requestBody: body,
      responseStatus: response ? response.statusCode : null,
      responseHeaders: response ? response.headers : null,
      responseBody: response ? response.body : null,
      responseSize: response ? response.body ? String(response.body).length : 0 : 0,
      duration,
      error,
      assertions: allAssertions,
      passed: !error && allAssertions.every(a => a.passed),
    };
  }

  /**
   * 替换变量引用（使用 VarResolver）
   */
  _resolveVariables(method, urlPath, headers, body, resolverContext) {
    urlPath = this.varResolver.resolve(urlPath, resolverContext);

    const resolvedHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      resolvedHeaders[key] = typeof value === 'string'
        ? this.varResolver.resolve(value, resolverContext)
        : value;
    }

    let resolvedBody = body;
    if (typeof body === 'string') {
      resolvedBody = this.varResolver.resolve(body, resolverContext);
    } else if (body && typeof body === 'object') {
      resolvedBody = this.varResolver.resolveObject(body, resolverContext);
    }

    return { urlPath, headers: resolvedHeaders, body: resolvedBody };
  }

  /**
   * 替换字符串中的变量引用（委托给 VarResolver）
   */
  _replaceVarRefs(str, contextVars, linkedRecords, currentIndex) {
    const context = {
      envConfig: this._envConfig || {},
      dataRow: {},
      ctxVars: contextVars,
      seqResponses: contextVars,
      linkedRecords,
      currentIndex,
    };
    return this.varResolver.resolve(str, context);
  }

  /**
   * 深度替换对象中的变量（委托给 VarResolver）
   */
  _deepReplaceVars(obj, contextVars, linkedRecords, currentIndex) {
    const context = {
      envConfig: this._envConfig || {},
      dataRow: {},
      ctxVars: contextVars,
      seqResponses: contextVars,
      linkedRecords,
      currentIndex,
    };
    return this.varResolver.resolveObject(obj, context);
  }

  /**
   * 按路径从对象中取值
   */
  _resolvePath(obj, pathParts) {
    if (obj === null || obj === undefined) return undefined;
    let current = obj;
    for (const part of pathParts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      // 处理 data[0] 数组索引语法
      const bracketMatch = part.match(/^(.+?)\[(\d+)\]$/);
      if (bracketMatch) {
        const field = bracketMatch[1];
        const idx = parseInt(bracketMatch[2], 10);
        if (field in current) {
          current = current[field];
          if (Array.isArray(current) && idx >= 0 && idx < current.length) {
            current = current[idx];
          } else {
            return undefined;
          }
        } else {
          return undefined;
        }
      } else {
        if (part in current) {
          current = current[part];
        } else {
          return undefined;
        }
      }
    }
    return current;
  }

  /**
   * 发送真实 HTTP 请求
   */
  _sendRequest(method, domain, urlPath, headers, body) {
    return new Promise((resolve, reject) => {
      try {
        let useSSL = false;
        let hostname = domain;
        let port = 80;

        // 统一 URL 解析
        if (domain.startsWith('https://')) {
          useSSL = true;
          hostname = domain.substring(8);
          port = 443;
        } else if (domain.startsWith('http://')) {
          hostname = domain.substring(7);
        }

        // 提取端口
        const portMatch = hostname.match(/:\d+$/);
        if (portMatch) {
          port = parseInt(portMatch[0].substring(1), 10);
          hostname = hostname.slice(0, -portMatch[0].length);
        } else if (useSSL) {
          port = 443;
        }

        // Build URL path with query params
        let path = urlPath;
        if (!path.startsWith('/')) path = '/' + path;

        // Add Content-Type if POST/PUT/PATCH and not present
        if (['POST', 'PUT', 'PATCH'].includes(method) && body) {
          const hasContentType = Object.keys(headers).some(
            k => k.toLowerCase() === 'content-type'
          );
          if (!hasContentType) {
            headers['Content-Type'] = typeof body === 'object'
              ? 'application/json'
              : 'application/x-www-form-urlencoded';
          }
        }

        const bodyStr = typeof body === 'object' ? JSON.stringify(body) : (body || '');

        const options = {
          hostname,
          port,
          path,
          method,
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(bodyStr),
          },
          rejectUnauthorized: false, // 允许自签名证书
          timeout: 30000, // 30s timeout
        };

        const lib = useSSL ? https : http;
        const req = lib.request(options, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8');
            let bodyJson = null;
            try { bodyJson = JSON.parse(raw); } catch { bodyJson = raw; }

            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: bodyJson,
              rawBody: raw,
            });
          });
        });

        req.on('error', (e) => reject(new Error(`请求失败: ${e.message}`)));
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('请求超时 (30s)'));
        });

        if (bodyStr) req.write(bodyStr);
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * 验证断言
   */
  _verifyAssertions(assertVos, response) {
    if (!assertVos || !Array.isArray(assertVos) || assertVos.length === 0) {
      return [{ expression: '无断言', expectValue: '-', passed: true, actualValue: '-', message: '跳过' }];
    }

    return assertVos.map((assert) => {
      let passed = false;
      let actualValue = '-';

      try {
        const expression = assert.expression || '';
        const expectValue = String(assert.expectValue || '');
        const validateType = assert.validateType || 3; // 默认: 3 = equals

        // 按表达式类型取值
        if (expression.startsWith('responseBody.')) {
          const path = expression.substring('responseBody.'.length);
          const parts = path.split('.');
          actualValue = this._resolvePath(response?.body, parts);
        } else if (expression.startsWith('responseHeaders.')) {
          const key = expression.substring('responseHeaders.'.length);
          actualValue = response?.headers?.[key.toLowerCase()] || response?.headers?.[key] || '-';
        } else if (expression.toLowerCase() === 'status' || expression.toLowerCase() === 'statuscode') {
          actualValue = response?.statusCode || '-';
        } else {
          actualValue = this._resolvePath(response?.body, expression.split('.'));
        }

        if (actualValue === undefined || actualValue === null) {
          actualValue = '-';
        }

        // 按验证类型比较
        switch (validateType) {
          case 1: // not empty
            passed = actualValue !== undefined && actualValue !== null && actualValue !== '-';
            break;
          case 2: // contains
            passed = String(actualValue).includes(expectValue);
            break;
          case 3: // equals
            passed = String(actualValue) === expectValue;
            break;
          case 4: // not equals
            passed = String(actualValue) !== expectValue;
            break;
          case 5: // greater than
            passed = Number(actualValue) > Number(expectValue);
            break;
          case 6: // less than
            passed = Number(actualValue) < Number(expectValue);
            break;
          default:
            passed = String(actualValue) === expectValue;
        }
      } catch (e) {
        passed = false;
      }

      return {
        expression: assert.expression || '-',
        expectValue: assert.expectValue || '-',
        actualValue: String(actualValue),
        validateType: assert.validateType || 3,
        passed,
        message: passed ? '通过' : `期望 ${assert.expectValue}，实际 ${actualValue}`,
      };
    });
  }

  /**
   * 统计结果
   */
  _computeStats() {
    const total = this.results.length;
    let passed = 0;
    let failed = 0;
    let error = 0;
    let totalAssertions = 0;
    let passedAssertions = 0;

    for (const r of this.results) {
      totalAssertions += r.assertions.length;
      passedAssertions += r.assertions.filter(a => a.passed).length;

      if (r.error) {
        error++;
      } else if (r.passed) {
        passed++;
      } else {
        failed++;
      }
    }

    return {
      total,
      passed,
      failed,
      error,
      passRate: total > 0 ? Math.round((passed / total) * 100) : 100,
      totalAssertions,
      passedAssertions,
      assertionPassRate: totalAssertions > 0 ? Math.round((passedAssertions / totalAssertions) * 100) : 100,
    };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { RegressionRunnerAgent };
