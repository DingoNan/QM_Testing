/**
 * ScriptEngine.js - 前置/后置脚本引擎
 * 基于 Node.js vm 模块的沙箱执行环境
 *
 * 前置脚本 (preRequest):
 *   - 上下文: { env, ctx, data, sys, request, log }
 *   - 可修改 request 对象影响实际请求
 *   - 可设置 ctx 变量传递给后续接口
 *
 * 后置脚本 (postResponse):
 *   - 上下文: { env, ctx, data, sys, request, response, log, pm }
 *   - pm.variables.set/get/clear - 管理上下文变量
 *   - pm.expect(actual).to[be/contain/match](expected) - 断言
 *   - 可修改 response 中的断言
 */

const vm = require('vm');
const logger = require('../core/logger');
const log = logger.create('ScriptEngine');

class ScriptEngine {
  /**
   * 执行前置脚本
   * @param {string} script - 脚本代码
   * @param {Object} context - 运行上下文
   * @returns {Promise<Object>} 修改后的上下文
   */
  async computePreRequest(script, context) {
    if (!script || !script.trim()) return context;

    const sandbox = this._buildPreSandbox(context);
    try {
      this._runInSandbox(script, sandbox);
    } catch (e) {
      log.warn(`前置脚本执行错误: ${e.message}`);
      // 脚本错误不中断执行，记录警告
    }

    // 提取修改后的值
    return {
      ...context,
      request: sandbox.request,
      ctx: sandbox.ctx,
    };
  }

  /**
   * 执行后置脚本
   * @param {string} script - 脚本代码
   * @param {Object} context - 运行上下文
   * @returns {Promise<Object>} 修改后的上下文（含 assertion updates）
   */
  async computePostResponse(script, context) {
    if (!script || !script.trim()) return context;

    const sandbox = this._buildPostSandbox(context);
    try {
      this._runInSandbox(script, sandbox);
    } catch (e) {
      log.warn(`后置脚本执行错误: ${e.message}`);
    }

    return {
      ...context,
      ctx: sandbox.ctx,
      pmAssertions: sandbox._pmAssertions || [],
      pmVariables: sandbox._pmSetVars || {},
    };
  }

  /**
   * 构建前置脚本沙箱
   */
  _buildPreSandbox(context) {
    const { env = {}, ctx = {}, data = {}, sys = {}, request = {} } = context || {};
    return {
      // 只读引用
      env: this._deepFreeze(env),
      data: this._deepFreeze(data),
      sys: { ...sys },

      // 可写引用
      ctx: { ...ctx },
      request: JSON.parse(JSON.stringify(request)),

      // 工具
      log: {
        info: (msg) => log.info(`[preScript] ${msg}`),
        warn: (msg) => log.warn(`[preScript] ${msg}`),
        error: (msg) => log.error(`[preScript] ${msg}`),
      },

      // 控制台兼容
      console: {
        log: (...args) => log.info(`[preScript] ${args.join(' ')}`),
        warn: (...args) => log.warn(`[preScript] ${args.join(' ')}`),
        error: (...args) => log.error(`[preScript] ${args.join(' ')}`),
      },
    };
  }

  /**
   * 构建后置脚本沙箱
   */
  _buildPostSandbox(context) {
    const { env = {}, ctx = {}, data = {}, sys = {}, request = {}, response = {} } = context || {};
    const pmSetVars = {};
    const pmAssertions = [];

    return {
      // 只读引用
      env: this._deepFreeze(env),
      data: this._deepFreeze(data),
      sys: { ...sys },

      // 可写引用
      ctx: { ...ctx },
      request: JSON.parse(JSON.stringify(request)),
      response: {
        statusCode: response.statusCode,
        headers: response.headers || {},
        body: response.body,
        responseTime: response.responseTime || 0,
      },

      // pm API
      pm: {
        variables: {
          set: (key, value) => { pmSetVars[key] = value; sandbox.ctx[key] = value; },
          get: (key) => sandbox.ctx[key],
          clear: (key) => { delete pmSetVars[key]; delete sandbox.ctx[key]; },
        },
        expect: (actual) => ({
          to: {
            be: (expected) => {
              const passed = actual === expected;
              pmAssertions.push({ expression: `pm.expect(${JSON.stringify(actual)}).to.be(${JSON.stringify(expected)})`, passed, actualValue: JSON.stringify(actual), expectValue: JSON.stringify(expected), message: passed ? '通过' : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}` });
              return passed;
            },
            contain: (expected) => {
              const passed = String(actual).includes(String(expected));
              pmAssertions.push({ expression: `pm.expect(${JSON.stringify(actual)}).to.contain(${JSON.stringify(expected)})`, passed, actualValue: JSON.stringify(actual), expectValue: JSON.stringify(expected), message: passed ? '通过' : `不包含 ${JSON.stringify(expected)}` });
              return passed;
            },
            match: (regex) => {
              const re = new RegExp(regex);
              const passed = re.test(String(actual));
              pmAssertions.push({ expression: `pm.expect(${JSON.stringify(actual)}).to.match(${regex})`, passed, actualValue: JSON.stringify(actual), expectValue: regex, message: passed ? '通过' : `不匹配 ${regex}` });
              return passed;
            },
            not: {
              be: (expected) => {
                const passed = actual !== expected;
                pmAssertions.push({ expression: `pm.expect(${JSON.stringify(actual)}).to.not.be(${JSON.stringify(expected)})`, passed, actualValue: JSON.stringify(actual), expectValue: JSON.stringify(expected), message: passed ? '通过' : `不应为 ${JSON.stringify(expected)}` });
                return passed;
              },
            },
          },
        }),
      },

      // 内部存储（用于传递断言和变量）
      _pmSetVars: pmSetVars,
      _pmAssertions: pmAssertions,

      log: {
        info: (msg) => log.info(`[postScript] ${msg}`),
        warn: (msg) => log.warn(`[postScript] ${msg}`),
        error: (msg) => log.error(`[postScript] ${msg}`),
      },
      console: {
        log: (...args) => log.info(`[postScript] ${args.join(' ')}`),
        warn: (...args) => log.warn(`[postScript] ${args.join(' ')}`),
        error: (...args) => log.error(`[postScript] ${args.join(' ')}`),
      },
    };
  }

  /**
   * 在沙箱中执行脚本
   */
  _runInSandbox(script, sandbox) {
    const context = vm.createContext(sandbox);
    const scriptObj = new vm.Script(`
      (function() {
        ${script}
      })();
    `, {
      filename: 'script-engine.js',
      timeout: 5000,  // 5s timeout
    });

    scriptObj.runInContext(context, {
      timeout: 5000,
      breakOnSigint: true,
    });
  }

  /**
   * 深度冻结对象
   */
  _deepFreeze(obj) {
    if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
    const propNames = Object.getOwnPropertyNames(obj);
    for (const name of propNames) {
      const value = obj[name];
      if (value && typeof value === 'object') {
        this._deepFreeze(value);
      }
    }
    return Object.freeze(obj);
  }
}

module.exports = { ScriptEngine };
