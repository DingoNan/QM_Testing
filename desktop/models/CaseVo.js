/**
 * CaseVo.js - 用例模型，对齐测试平台标准格式
 * 扩展支持：数据池绑定、迭代模式、串联规则、前置/后置脚本
 */

/**
 * 从响应体中推断状态字段名
 * 遍历常见状态字段，返回第一个匹配的字段名
 * @param {Object|string|null} body - 响应体（已解析对象或 JSON 字符串）
 * @returns {string} 推断出的字段名，默认 'statusCode'
 */
function _inferStatusField(body) {
  if (!body) return 'statusCode';
  let parsed = body;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return 'statusCode'; }
  }
  if (typeof parsed !== 'object' || parsed === null) return 'statusCode';
  const STATUS_FIELDS = ['statusCode', 'code', 'status', 'ret', 'errorCode', 'errCode', 'resultCode'];
  for (const field of STATUS_FIELDS) {
    if (field in parsed && parsed[field] !== null && parsed[field] !== undefined) {
      return field;
    }
  }
  return 'statusCode';
}

/**
 * 从响应体中获取状态字段的期望值
 * @param {Object|string|null} body - 响应体
 * @param {string} field - 状态字段名
 * @returns {string} 状态字段的字符串值，默认 '200'
 */
function _inferStatusValue(body, field) {
  if (!body) return '200';
  let parsed = body;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return '200'; }
  }
  if (typeof parsed !== 'object' || parsed === null) return '200';
  const val = parsed[field];
  if (val === null || val === undefined) return '200';
  return String(val);
}

class CaseVo {
  /**
   * @param {Object} opts
   * @param {string} opts.name - 用例名称
   * @param {number} opts.projectId - 项目 ID
   * @param {number} opts.environment - 环境 (0=dev, 1=test, 2=pre, 3=prod)
   * @param {string} opts.domainName - 域名
   * @param {import('./Recording').APIRequest[]} [opts.apiVos] - 接口列表
   * @param {string} [opts.dataPoolId] - 绑定的数据池 ID
   * @param {'expand'|'loop'|'none'} [opts.iterationMode] - 迭代模式
   * @param {Object[]} [opts.chainRules] - 串联规则列表
   * @param {Object} [opts.dataBinding] - 数据绑定配置
   * @param {Object} [opts.deployment] - 数据分片配置
   */
  constructor(opts = {}) {
    this.name = opts.name || '';
    this.type = opts.type ?? 1;
    this.projectId = opts.projectId ?? 0;
    this.environment = opts.environment ?? 1;
    this.domainName = opts.domainName || '';
    this.envType = opts.envType ?? 1;
    this.apiCount = 0;
    this.metadata = opts.metadata || {};

    // 数据驱动扩展字段
    this.dataPoolId = opts.dataPoolId || '';
    this.iterationMode = opts.iterationMode || 'none';  // 'expand' | 'loop' | 'none'
    this.chainRules = opts.chainRules || [];
    this.dataBinding = opts.dataBinding || {};
    this.deployment = opts.deployment || {};  // { sharding: 'auto'|'mod'|'all', instances: 1 }

    this.apiVos = (opts.apiVos || []).map((api, index) => ({
      apiCaseFileVos: [],
      apiEnable: api.apiEnable ?? 0,
      apiMethod: api.apiMethod || 'GET',
      apiName: api.apiName || `api_${index + 1}`,
      apiUrl: api.apiUrl || '',
      assertVos: api.assertVos || [
        {
          delay: 0,
          expectValue: '200',
          expression: 'responseBody.statusCode',
          logicType: 1,
          validateType: 3,
        },
      ],
      concurrencyNum: 0,
      delay: 0,
      domainName: api.domainName || opts.domainName || '',
      interfaceType: 0,
      orderNum: index + 1,
      projectId: opts.projectId ?? 0,
      requestBody: api.requestBody || '',
      requestHeaders: api.requestHeaders || '{}',
      requestType: api.requestType || 'application/json',
      apiScript: api.apiScript || { preRequest: '', postResponse: '' },
    }));
    this.apiCount = this.apiVos.length;
  }

  /**
   * 从 linked 格式的接口列表构建 CaseVo
   * @param {Object[]} linkedRecords - 已关联的接口列表
   * @param {Object} opts
   * @returns {CaseVo}
   */
  static fromLinkedRecords(linkedRecords, opts = {}) {
    const domainName = opts.domainName || linkedRecords[0]?.domain || '';
    const apiVos = linkedRecords.map((r, index) => {
      // 处理 requestBody
      let bodyStr = '';
      if (r.requestBody !== null && r.requestBody !== undefined) {
        bodyStr = typeof r.requestBody === 'object'
          ? JSON.stringify(r.requestBody)
          : String(r.requestBody);
      }

      // 处理 requestHeaders
      const headers = r.requestHeaders || {};
      const keepHeaders = {};
      const KEEP = new Set([
        'token', 'authorization', 'x-csrf-token', 'x-xsrf-token',
        'x-token', 'x-auth-token', 'access-token', 'accesstoken',
        'csrf-token', 'content-type', 'cookie', 'x-requested-with', 'set-cookie',
      ]);
      for (const [k, v] of Object.entries(headers)) {
        if (KEEP.has(k.toLowerCase())) {
          keepHeaders[k] = v;
        }
      }

      // 从 URL path 推断 apiName
      let apiName = '';
      try {
        const pathParts = new URL(r.url).pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2) {
          apiName = `${pathParts[pathParts.length - 2]}.${pathParts[pathParts.length - 1]}`;
        } else if (pathParts.length === 1) {
          apiName = pathParts[0];
        }
      } catch {
        apiName = r.method.toLowerCase();
      }

      // 从 cleaner 的 inferredAssertions 构建断言列表
      const inferred = r.inferredAssertions || [];
      let assertVos;
      if (inferred.length > 0) {
        assertVos = inferred.slice(0, 8).map(a => ({
          delay: 0,
          expectValue: a.expectValue || '0',
          expression: a.expression || 'responseBody.code',
          logicType: 1,
          validateType: a.validateType || 3,
        }));
      } else {
        // 降级：从响应体推断状态字段名和值，避免硬编码特定字段名
        const fallbackField = _inferStatusField(r.responseBody);
        const fallbackValue = _inferStatusValue(r.responseBody, fallbackField);
        assertVos = [
          {
            delay: 0,
            expectValue: fallbackValue,
            expression: 'responseBody.' + fallbackField,
            logicType: 1,
            validateType: 3,
          },
        ];
      }

      return {
        apiMethod: r.method,
        apiName,
        apiUrl: r.path || '',
        assertVos,
        domainName: r.domain || domainName,
        orderNum: r.seq || index + 1,
        requestBody: bodyStr,
        requestHeaders: JSON.stringify(keepHeaders),
        requestType: 'application/json',
      };
    });

    return new CaseVo({
      name: opts.name || `用例_${Date.now()}`,
      projectId: opts.projectId ?? 0,
      environment: opts.environment ?? 1,
      domainName,
      apiVos,
    });
  }

  toJSON() {
    return {
      name: this.name,
      type: this.type,
      projectId: this.projectId,
      environment: this.environment,
      domainName: this.domainName,
      apiCount: this.apiCount,
      apiVos: this.apiVos,
      metadata: this.metadata,
      dataPoolId: this.dataPoolId,
      iterationMode: this.iterationMode,
      chainRules: this.chainRules,
      dataBinding: this.dataBinding,
      deployment: this.deployment,
    };
  }
}

module.exports = { CaseVo };
