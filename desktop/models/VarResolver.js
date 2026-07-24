/**
 * VarResolver.js - 统一变量解析器
 * 支持 5 层命名空间变量解析、平台函数和运行时函数调用
 *
 * 变量命名空间（优先级从内到外）:
 *   ${ctx.xxx}  - 上下文变量（当前迭代/循环的临时状态）
 *   ${data.xxx} - 数据池变量（当前行的字段值）
 *   ${seq.N.xxx} - 前序接口响应引用
 *   ${env.xxx}  - 环境变量
 *   ${sys.xxx}  - 系统函数/全局配置
 *
 * 运行时函数:
 *   ${sys.funcName(args)} - 在 VariableResolver._resolveFunc 中处理
 *
 * 平台函数（无命名空间前缀）:
 *   ${Tel} / ${IC} / ${RandomUUID} / ${Random(N)} / ${Time(,Nd)}
 *   ${DateTime(fmt,Nd)} / ${MD5Encode(s,opt)} / ${Calculate[expr]} / ${Param(id)}
 *   - 解析在 _resolveExpression 步骤 0 中先行处理
 *   - 支持嵌套: ${MD5Encode(${1.responseBody.data.key})}
 */

const { FunctionRegistry } = require('./FunctionRegistry');
const { parsePlatformCall, callFunction, isSignFunction } = require('../core/function-utils');

class VariableResolver {
  /**
   * @param {Object} [opts]
   * @param {FunctionRegistry} [opts.functionRegistry]
   */
  constructor(opts = {}) {
    this.fnRegistry = opts.functionRegistry || new FunctionRegistry();
  }

  /**
   * 设置函数注册表实例
   */
  setFunctionRegistry(fnRegistry) {
    this.fnRegistry = fnRegistry;
  }

  /**
   * 解析字符串中的全部变量引用
   * @param {string} str - 包含 $var 或 ${var} 的字符串
   * @param {Object} context - 解析上下文
   * @returns {string} 解析后的字符串
   */
  resolve(str, context) {
    if (!str || typeof str !== 'string') return str;
    // 迭代解析直到不再变化（支持嵌套: ${MD5Encode(${1.token})}）
    let prev;
    let result = str;
    let iterations = 0;
    const MAX_ITER = 10;
    do {
      prev = result;
      result = this._resolveAllExpressions(result, context);
      iterations++;
    } while (result !== prev && iterations < MAX_ITER);
    return result;
  }

  /**
   * 用花括号计数方式提取并解析所有 ${...} 表达式
   * 正确支持嵌套，如 ${MD5Encode(${1.token})}
   */
  _resolveAllExpressions(str, context) {
    let result = '';
    let i = 0;
    while (i < str.length) {
      if (str[i] === '$' && i + 1 < str.length && str[i + 1] === '{') {
        const start = i;
        i += 2; // skip ${
        let depth = 1;
        let expr = '';
        while (i < str.length && depth > 0) {
          if (str[i] === '{') depth++;
          else if (str[i] === '}') depth--;
          if (depth > 0) expr += str[i];
          i++;
        }
        // i is now past the closing }
        const resolved = this._resolveExpression(expr.trim(), context);
        result += resolved !== null ? resolved : str.substring(start, i);
      } else if (str[i] === '$' && /[a-zA-Z_]/.test(str[i + 1] || '')) {
        // Short form: $data.xxx, $env.xxx, $seq.N.xxx, $ctx.xxx, $sys.xxx
        const match = str.substring(i).match(/^\$(data|env|seq|ctx|sys)\.(\w+(?:\.\w+)*(?:\([^)]*\))?)/);
        if (match) {
          const fullExpr = match[1] + '.' + match[2];
          const resolved = this._resolveExpression(fullExpr, context);
          result += resolved !== null ? resolved : str.substring(i, i + match[0].length);
          i += match[0].length;
        } else {
          result += str[i];
          i++;
        }
      } else {
        result += str[i];
        i++;
      }
    }
    return result;
  }

  /**
   * 深度递归解析对象中的所有字符串值
   */
  resolveObject(obj, context) {
    if (typeof obj === 'string') {
      return this.resolve(obj, context);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveObject(item, context));
    }
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.resolveObject(value, context);
      }
      return result;
    }
    return obj;
  }

  /**
   * 解析单个变量表达式
   * 表达式格式:
   *   env.xxx          - 环境变量
   *   seq.N.xxx        - 前序接口响应 ${seq.1.data.token}
   *   data.xxx         - 数据池字段 ${data.username}
   *   ctx.xxx          - 上下文变量 ${ctx.myVar}
   *   sys.funcName()   - 运行时函数 ${sys.concat(a, b)}
   */
  _resolveExpression(expr, context) {
    if (!expr) return null;

    const ctx = context || {};

    // 0. Platform function (${Tel}, ${IC}, ${RandomUUID}, ${MD5Encode(s)}, etc.)
    const platformCall = parsePlatformCall(expr);
    if (platformCall) {
      const { name, args } = platformCall;
      // Resolve args that may contain seq/data/ctx references
      const resolvedArgs = args.map(a => {
        // Handle ${...} — strip both $ and braces
        if (a.startsWith('${') && a.endsWith('}')) {
          const inner = a.slice(2, -1);
          const resolved = this._resolveExpression(inner, context);
          return resolved !== null ? resolved : a;
        }
        if (a.startsWith('$')) {
          const resolved = this._resolveExpression(a.substring(1), context);
          return resolved !== null ? resolved : a;
        }
        return a;
      });
      // Special handling for Param(id)
      if (name === 'Param') {
        const params = ctx.params || ctx.globalParams || {};
        return resolvedArgs[0] && params[resolvedArgs[0]] !== undefined
          ? String(params[resolvedArgs[0]]) : '';
      }
      // Special handling for Calculate[expr] - expr may contain nested ${seq.xxx}
      if (name === 'Calculate') {
        const resolvedBody = this.resolve(resolvedArgs[0] || '', context);
        const { genCalculate } = require('../core/function-utils');
        return genCalculate(resolvedBody);
      }
      return callFunction(name, resolvedArgs);
    }

    // 1. sys function call with parentheses
    if (expr.startsWith('sys.') && /\(.*\)/.test(expr)) {
      const funcCall = expr.substring(4); // remove 'sys.'
      const resolved = this._resolveFuncCall(funcCall, expr, ctx);
      if (resolved !== null) return resolved;
    }

    // 2. Namespace resolution
    const dotIdx = expr.indexOf('.');
    if (dotIdx < 0) return null;

    const ns = expr.substring(0, dotIdx);
    const path = expr.substring(dotIdx + 1);

    // Extract args for sys functions without parens (plain function call)
    if (ns === 'sys' && this.fnRegistry.hasFunction(path)) {
      return String(this.fnRegistry.call(path));
    }

    // parse path parts
    const parts = path.split('.').filter(Boolean);
    if (parts.length === 0) return null;

    let source;
    switch (ns) {
      case 'env':
        source = ctx.envConfig || {};
        break;
      case 'data':
        source = ctx.dataRow || {};
        break;
      case 'ctx':
        source = ctx.ctxVars || {};
        break;
      case 'seq':
        return this._resolveSeqRef(parts, ctx);
      case 'sys':
        return this._resolveSysRef(parts, ctx);
      default:
        // 向后兼容：数字 ns（旧格式 ${1.path}）路由到 seq 解析
        if (/^\d+$/.test(ns)) {
          return this._resolveSeqRef([ns, ...parts], ctx);
        }
        return null;
    }

    return this._navigatePath(source, parts);
  }

  /**
   * 解析 seq 引用: seq.1.data.token
   * parts[0] = seqIndex (1-based)
   * parts[1..n] = path within response
   */
  _resolveSeqRef(parts, ctx) {
    if (parts.length < 2) return null;

    const seqIdx = parseInt(parts[0], 10) - 1; // convert 1-based to 0-based
    if (isNaN(seqIdx) || seqIdx < 0) return null;

    const pathParts = parts.slice(1);
    // Strip responseBody/responseHeaders prefix if present
    if (pathParts[0] === 'responseBody' || pathParts[0] === 'responseHeaders') {
      pathParts.shift();
    }

    // Try context vars first (runtime accumulated)
    const ctxVars = ctx.ctxVars || {};
    if (ctxVars[seqIdx] !== undefined) {
      const val = this._navigatePath(ctxVars[seqIdx], pathParts);
      if (val !== undefined && val !== null) return String(val);
    }

    // Try seqResponses
    const seqResp = ctx.seqResponses || {};
    if (seqResp[seqIdx] !== undefined) {
      const val = this._navigatePath(seqResp[seqIdx], pathParts);
      if (val !== undefined && val !== null) return String(val);
    }

    // Fallback to linkedRecords
    const linked = ctx.linkedRecords || [];
    const record = linked[seqIdx];
    if (record) {
      const respBody = record.responseBody || record.body || record;
      const val = this._navigatePath(respBody, pathParts);
      if (val !== undefined && val !== null) return String(val);
    }

    return null;
  }

  /**
   * 解析 sys 引用: sys.funcName or sys.someConfig
   */
  _resolveSysRef(parts, ctx) {
    if (parts.length === 0) return null;
    const funcName = parts[0];
    // Try function registry first
    if (this.fnRegistry.hasFunction(funcName)) {
      const funcArgs = parts.slice(1);
      return String(this.fnRegistry.call(funcName, ...funcArgs));
    }
    // Try global config
    if (ctx.sysConfig && parts.length === 1 && funcName in ctx.sysConfig) {
      return String(ctx.sysConfig[funcName]);
    }
    return null;
  }

  /**
   * 解析函数调用表达式
   */
  _resolveFuncCall(funcCall, originalExpr, ctx) {
    // funcCall = "funcName(arg1, arg2)"
    const match = funcCall.match(/^(\w+)\((.+)\)$/s);
    if (!match) return null;

    const funcName = match[1];
    if (!this.fnRegistry.hasFunction(funcName)) return null;

    const argsStr = match[2];
    const args = this._parseFnArgs(argsStr, ctx);
    return String(this.fnRegistry.call(funcName, ...args));
  }

  /**
   * 解析函数参数列表，支持嵌套引用
   */
  _parseFnArgs(argsStr, ctx) {
    const args = [];
    let depth = 0;
    let current = '';

    for (let i = 0; i < argsStr.length; i++) {
      const ch = argsStr[i];
      if (ch === '(') { depth++; current += ch; continue; }
      if (ch === ')') { depth--; current += ch; continue; }
      if (ch === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) args.push(current.trim());

    return args.map(arg => {
      // Variable references within arguments
      const trimmed = arg.trim();
      if (trimmed.startsWith('$')) {
        const resolved = this._resolveExpression(trimmed.substring(1), ctx);
        return resolved !== null ? resolved : trimmed;
      }
      // String literals
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
      }
      // Numbers
      if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
      if (/^\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
      return trimmed;
    });
  }

  /**
   * 按路径导航对象
   */
  _navigatePath(obj, parts) {
    if (obj === null || obj === undefined) return undefined;
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      if (part in current) {
        current = current[part];
      } else {
        // Case-insensitive fallback
        const keys = Object.keys(current);
        const lowerKey = keys.find(k => k.toLowerCase() === part.toLowerCase());
        if (lowerKey) {
          current = current[lowerKey];
        } else {
          return undefined;
        }
      }
    }
    return current;
  }
}

module.exports = { VariableResolver };
