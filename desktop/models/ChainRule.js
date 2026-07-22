/**
 * ChainRule.js - 串联规则模型
 * 定义接口间的数据传递规则，支持数据变换
 */

class TransformDef {
  /**
   * @param {Object} opts
   * @param {'none'|'jsonpath'|'regex'|'template'|'function'} opts.type - 变换类型
   * @param {string} opts.expression - 变换表达式
   * @param {Object} opts.params - 附加参数
   */
  constructor(opts = {}) {
    this.type = opts.type || 'none';
    this.expression = opts.expression || '';
    this.params = opts.params || {};
  }

  /**
   * 对源值应用变换
   * @param {*} sourceValue - 来源接口响应中的原始值
   * @returns {*} 变换后的值
   */
  apply(sourceValue) {
    switch (this.type) {
      case 'none':
        return sourceValue;

      case 'regex': {
        if (!this.expression || sourceValue === undefined || sourceValue === null) return sourceValue;
        const match = String(sourceValue).match(new RegExp(this.expression, this.params.flags || ''));
        return match ? (match[this.params.group || 0] || match[0]) : sourceValue;
      }

      case 'template': {
        if (!this.expression) return sourceValue;
        return this.expression.replace(/\$\{value\}/g, String(sourceValue !== undefined ? sourceValue : ''));
      }

      case 'function': {
        // simple built-in transforms
        const fnName = this.expression || '';
        switch (fnName) {
          case 'trim': return String(sourceValue).trim();
          case 'parseInt': return parseInt(sourceValue, 10);
          case 'parseFloat': return parseFloat(sourceValue);
          case 'toString': return String(sourceValue);
          case 'toLowerCase': return String(sourceValue).toLowerCase();
          case 'toUpperCase': return String(sourceValue).toUpperCase();
          default:
            if (typeof sourceValue === 'string') {
              try {
                // eslint-disable-next-line no-new-func
                const fn = new Function('val', `return (${this.expression})(val)`);
                return fn(sourceValue);
              } catch { return sourceValue; }
            }
            return sourceValue;
        }
      }

      default:
        return sourceValue;
    }
  }

  toJSON() {
    return {
      type: this.type,
      expression: this.expression,
      params: { ...this.params },
    };
  }
}

class ChainRule {
  /**
   * @param {Object} opts
   * @param {string} opts.id - 规则 ID
   * @param {string} opts.name - 规则名称
   * @param {number} opts.sourceApiSeq - 来源接口序号 (1-based)
   * @param {string} opts.sourcePath - 来源响应字段路径，如 "data.token" 或 "responseBody.data.token"
   * @param {number} opts.targetApiSeq - 目标接口序号 (1-based)
   * @param {string} opts.targetLocation - 目标位置
   *   'url' | 'requestHeaders.X-Header' | 'requestBody.field' |
   *   'assert.N.expectValue' | 'assert.N.expression'
   * @param {TransformDef|Object} [opts.transform] - 可选的数据变换
   * @param {boolean} [opts.enabled] - 是否启用
   * @param {string} [opts.description] - 备注
   */
  constructor(opts = {}) {
    this.id = opts.id || `cr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.name = opts.name || '';
    this.sourceApiSeq = opts.sourceApiSeq || 0;
    this.sourcePath = opts.sourcePath || '';
    this.targetApiSeq = opts.targetApiSeq || 0;
    this.targetLocation = opts.targetLocation || '';
    this.transform = opts.transform instanceof TransformDef
      ? opts.transform
      : new TransformDef(opts.transform || {});
    this.enabled = opts.enabled !== undefined ? opts.enabled : true;
    this.description = opts.description || '';
    this.createdAt = opts.createdAt || new Date().toISOString();
  }

  /**
   * 从源对象取值
   * @param {Object} sourceResponse - 来源接口的响应对象 { body, headers, statusCode }
   * @returns {*} 原始值
   */
  extractValue(sourceResponse) {
    if (!sourceResponse) return undefined;
    const path = this.sourcePath.replace(/^responseBody\.?/, '').replace(/^responseHeaders\.?/, '');
    const parts = path.split('.').filter(Boolean);
    if (parts.length === 0) return sourceResponse.body;

    // Determine source
    let source;
    if (this.sourcePath.startsWith('responseHeaders.')) {
      source = sourceResponse.headers || {};
    } else {
      source = sourceResponse.body || sourceResponse;
    }

    // Navigate path
    let current = source;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      if (part in current) {
        current = current[part];
      } else {
        // Try lowercase key
        const lowerKey = Object.keys(current).find(k => k.toLowerCase() === part.toLowerCase());
        if (lowerKey) {
          current = current[lowerKey];
        } else {
          return undefined;
        }
      }
    }
    return current;
  }

  /**
   * 将变换后的值注入目标位置
   * @param {Object} targetRequest - 目标接口的请求对象 { url, headers, body, assertVos }
   * @param {string} value - 变换后的值
   * @returns {Object} 修改后的请求对象
   */
  applyToTarget(targetRequest, value) {
    const result = { ...targetRequest };
    const loc = this.targetLocation;

    if (loc === 'url') {
      result.url = (result.url || '') + (String(result.url).includes('?') ? '&' : '?') + value;
    } else if (loc.startsWith('requestHeaders.')) {
      const headerName = loc.substring('requestHeaders.'.length);
      let headers = result.requestHeaders || {};
      if (typeof headers === 'string') {
        try { headers = JSON.parse(headers); } catch { headers = {}; }
      }
      headers[headerName] = String(value);
      result.requestHeaders = headers;
    } else if (loc.startsWith('requestBody.')) {
      const fieldPath = loc.substring('requestBody.'.length);
      let body = result.requestBody;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { /* keep string */ }
      }
      if (typeof body === 'object' && body !== null) {
        this._setNestedValue(body, fieldPath, value);
      } else {
        body = value;
      }
      result.requestBody = body;
    } else if (loc.startsWith('assert.')) {
      // e.g. assert.0.expectValue
      const assertParts = loc.split('.');
      if (assertParts.length >= 3) {
        const assertIdx = parseInt(assertParts[1], 10);
        const assertField = assertParts.slice(2).join('.');
        const asserts = result.assertVos || [];
        if (asserts[assertIdx]) {
          if (assertField === 'expectValue') {
            asserts[assertIdx].expectValue = String(value);
          } else if (assertField === 'expression') {
            asserts[assertIdx].expression = String(value);
          }
        }
        result.assertVos = asserts;
      }
    }

    return result;
  }

  /**
   * 设置嵌套对象的值
   */
  _setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      sourceApiSeq: this.sourceApiSeq,
      sourcePath: this.sourcePath,
      targetApiSeq: this.targetApiSeq,
      targetLocation: this.targetLocation,
      transform: this.transform.toJSON(),
      enabled: this.enabled,
      description: this.description,
      createdAt: this.createdAt,
    };
  }
}

module.exports = { ChainRule, TransformDef };
