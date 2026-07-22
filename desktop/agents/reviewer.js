/**
 * reviewer.js - Agent-5: 智能审查
 * 功能：内置规则审查 + 可选 AI 深度审查
 * 规则可配置，支持启用/禁用和参数调整
 */
const { BaseAgent } = require('./base-agent');
const path = require('path');
const fs = require('fs');

const logger = require('../core/logger');
const log = logger.create('Reviewer');

// ============================================================
// 内置规则定义
// ============================================================
const BUILTIN_RULES = [
  {
    id: 'STATUS_ASSERT',
    name: '状态码断言',
    description: '检查每个接口是否包含 HTTP 状态码断言（2xx）',
    severity: 'error',
    enabledByDefault: true,
    config: {},
    check(api, apiIndex, context) {
      const asserts = api.assertVos || [];
      for (const a of asserts) {
        const expr = (a.expression || '').toLowerCase();
        const val = String(a.expectValue || '');
        // 检查是否包含 status 或 code 相关断言，且期望值以 2 开头
        if ((expr.includes('status') || expr.includes('code')) && /^2\d{0,2}$/.test(val)) {
          return null; // 通过
        }
      }
      return {
        pass: false,
        message: '缺少 HTTP 状态码断言（如 responseBody.code = 200）',
      };
    },
  },
  {
    id: 'MIN_ASSERT',
    name: '最少断言数',
    description: '每个接口至少包含 N 个断言',
    severity: 'warning',
    enabledByDefault: true,
    config: { minCount: 1 },
    check(api, apiIndex, context) {
      const min = (context.ruleConfigs?.MIN_ASSERT?.minCount) || 1;
      const count = (api.assertVos || []).length;
      if (count >= min) return null;
      return {
        pass: false,
        message: `断言数量不足（${count}/${min}），建议至少 ${min} 个断言`,
      };
    },
  },
  {
    id: 'BODY_EXISTS',
    name: '请求体检查',
    description: 'POST/PUT/PATCH 方法应包含请求体',
    severity: 'warning',
    enabledByDefault: true,
    config: {},
    check(api, apiIndex, context) {
      const method = (api.apiMethod || '').toUpperCase();
      if (!['POST', 'PUT', 'PATCH'].includes(method)) return null;
      const body = api.requestBody || '';
      if (body && body !== '{}' && body !== '""' && body !== "''") return null;
      return {
        pass: false,
        message: `${method} 请求缺少请求体（requestBody 为空）`,
      };
    },
  },
  {
    id: 'HARDCODED_ID',
    name: '硬编码 ID 检查',
    description: '检查 URL 中是否包含未参数化的数字 ID',
    severity: 'warning',
    enabledByDefault: true,
    config: {},
    check(api, apiIndex, context) {
      const url = api.apiUrl || '';
      // 查找路径中 3 位以上的数字（可能的 ID）
      const matches = url.match(/\/(\d{3,})(?=\/|$)/g);
      if (!matches) return null;
      const ids = matches.map(m => m.replace('/', ''));
      // 用 context 判断是否已经在 linkedRecords 中被参数化
      const linkedRecords = context.linkedRecords || [];
      const record = linkedRecords[apiIndex];
      if (record) {
        // 如果 linkedRecords 中的 URL 已经替换为 ${...}，则不报警告
        const linkedUrl = record.url || '';
        if (linkedUrl.includes('${')) return null;
      }
      return {
        pass: false,
        message: `URL 包含可能是 ID 的数字: ${ids.join(', ')}，建议使用变量引用`,
      };
    },
  },
  {
    id: 'CONTENT_TYPE',
    name: 'Content-Type 检查',
    description: '检查请求是否包含 Content-Type 头',
    severity: 'info',
    enabledByDefault: false,
    config: {},
    check(api, apiIndex, context) {
      let headers = api.requestHeaders;
      if (typeof headers === 'string') {
        try { headers = JSON.parse(headers); } catch { headers = {}; }
      }
      if (!headers || typeof headers !== 'object') headers = {};
      const keys = Object.keys(headers).map(k => k.toLowerCase());
      if (keys.some(k => k === 'content-type')) return null;
      return {
        pass: false,
        message: '缺少 Content-Type 请求头',
      };
    },
  },
  {
    id: 'URL_EMPTY',
    name: '空 URL 检查',
    description: '检查接口 URL 是否为空',
    severity: 'error',
    enabledByDefault: true,
    config: {},
    check(api, apiIndex, context) {
      if (api.apiUrl && api.apiUrl.trim()) return null;
      return {
        pass: false,
        message: '接口 URL 为空',
      };
    },
  },
];

class ReviewerAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      id: 'reviewer',
      name: '智能审查',
      description: '规则审查 + AI 兜底',
      ...opts,
    });
  }

  /**
   * 加载所有规则（内置 + 自定义）
   * @returns {Object[]} 规则定义数组（含 check 函数）
   */
  loadAllRules() {
    const rules = [...BUILTIN_RULES];
    try {
      const rulesPath = path.resolve(__dirname, '..', 'data', 'review-rules.json');
      if (require('fs').existsSync(rulesPath)) {
        const customRules = JSON.parse(require('fs').readFileSync(rulesPath, 'utf-8'));
        for (const cr of customRules) {
          if (cr.checkTemplate) {
            try {
              // 安全执行检查模板
              const checkFn = new Function('return ' + cr.checkTemplate)();
              rules.push({ ...cr, check: checkFn, isBuiltin: false });
            } catch (e) {
              log.warn('自定义规则 [' + cr.name + '] 语法错误: ' + e.message);
            }
          }
        }
      }
    } catch {}
    return rules;
  }

  /**
   * 获取审查规则定义（含当前配置，不含 check 函数）
   * @param {Object} [ruleConfigs] - 自定义规则配置，格式 { RULE_ID: { enabled, config } }
   * @returns {Object[]}
   */
  getRules(ruleConfigs) {
    const allRules = this.loadAllRules();
    return allRules.map(r => {
      const custom = (ruleConfigs || {})[r.id] || {};
      // 剥离 check 函数，避免 IPC 序列化失败
      const { check, ...ruleWithoutCheck } = r;
      return {
        ...ruleWithoutCheck,
        enabled: custom.enabled !== undefined ? custom.enabled : r.enabledByDefault,
        config: { ...r.config, ...(custom.config || {}) },
      };
    });
  }

  /**
   * 执行审查
   * @param {Object} input
   * @param {Object} input.data - CaseVo JSON 对象
   * @param {Object} [input.ruleConfigs] - 规则配置覆盖
   * @param {boolean} [input.useAI] - 是否使用 AI 审查
   * @returns {Promise<Object>}
   */
  async execute(input) {
    this._updateProgress(0, '开始智能审查...');
  
    // 处理两种可能的输入格式:
    // 1) 直接从 pipeline 取: { caseVo: {...}, stats, outputFiles }
    // 2) 直接传入 caseVo 对象
    const raw = input.data || {};
    const caseVo = raw.caseVo || raw;
    const apis = caseVo.apiVos || [];
    const config = input.config || {};
    const ruleConfigs = input.ruleConfigs || config.ruleConfigs || {};
    const useAI = input.useAI !== undefined ? input.useAI : config.useAI;

    if (!apis || apis.length === 0) {
      throw new Error('无用例数据，无法审查');
    }

    this._updateProgress(10, `审查 ${apis.length} 个接口`);

    // Step 1: 加载关联数据（用于 HARDCODED_ID 规则）
    let linkedRecords = input.linkedRecords || [];
    if (!linkedRecords.length) {
      try {
        const linkedPath = path.join(this.outDir, 'linked.json');
        if (fs.existsSync(linkedPath)) {
          linkedRecords = JSON.parse(fs.readFileSync(linkedPath, 'utf-8'));
        }
        // 也尝试从 input.data 中提取 linkedRecords
        if (!linkedRecords.length && raw.linkedRecords) {
          linkedRecords = raw.linkedRecords;
        }
      } catch { /* ignore */ }
    }

    const context = { ruleConfigs, linkedRecords };
    const allRules = this.loadAllRules();

    // 将 ruleConfigs 中的 enabled/disabled 应用到所有规则
    const rules = allRules.map(r => {
      const cfg = (ruleConfigs || {})[r.id] || {};
      return {
        ...r,
        enabled: cfg.enabled !== undefined ? cfg.enabled : r.enabledByDefault,
        config: { ...r.config, ...(cfg.config || {}) },
      };
    });

    // Step 2: 逐规则逐接口检查
    const findings = [];
    let passCount = 0;
    let totalChecks = 0;

    for (const rule of rules) {
      if (!rule.enabled) continue;
      for (let i = 0; i < apis.length; i++) {
        const api = apis[i];
        totalChecks++;
        try {
          const result = rule.check(api, i, context);
          if (result === null) {
            passCount++;
            continue; // 通过
          }
          findings.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            apiIndex: i,
            apiName: api.apiName || `#${i + 1}`,
            apiUrl: api.apiUrl || '',
            pass: result.pass,
            message: result.message,
          });
          if (result.pass) passCount++;
        } catch (e) {
          log.warn(`Rule ${rule.id} check failed: ${e.message}`);
        }
      }
    }

    this._updateProgress(50, `规则审查完成，共 ${findings.length} 个问题`);

    // Step 3: AI 审查（可选）
    let aiReview = null;
    if (useAI) {
      this._updateProgress(60, '正在进行 AI 深度审查...');
      try {
        aiReview = await this._aiReview(caseVo, input.aiProvider);
        this._updateProgress(85, 'AI 审查完成');
      } catch (e) {
        log.error(`AI review failed: ${e.message}`);
        aiReview = { error: e.message };
      }
    }

    // Step 4: 输出统计
    const failedIssues = findings.filter(f => !f.pass);
    const errors = failedIssues.filter(f => f.severity === 'error').length;
    const warnings = failedIssues.filter(f => f.severity === 'warning').length;
    const infos = failedIssues.filter(f => f.severity === 'info').length;

    const stats = {
      totalApis: apis.length,
      totalChecks,
      passCount,
      failedCount: failedIssues.length,
      errors,
      warnings,
      infos,
      passRate: totalChecks > 0 ? Math.round((passCount / totalChecks) * 100) : 100,
    };

    this._updateProgress(90, '写入审查结果');
    this._writeJSON(path.join(this.outDir, 'review-report.json'), {
      stats,
      findings,
      aiReview,
      ruleConfigs,
      timestamp: new Date().toISOString(),
    });

    this._updateProgress(100, '智能审查完成');

    return {
      stats,
      findings,
      aiReview,
      ruleConfigs,
      outputFiles: {
        report: path.join(this.outDir, 'review-report.json'),
      },
    };
  }

  /**
   * AI 深度审查：用 LLM 分析用例质量
   */
  async _aiReview(caseVo, aiProvider) {
    const aiConfig = aiProvider || (() => {
      try { return require('../core/ai-config').getActiveProvider(); } catch { return null; }
    })();

    let provider = null;
    if (aiConfig && typeof aiConfig === 'function') {
      provider = aiConfig();
    } else if (aiConfig && aiConfig.baseUrl) {
      provider = aiConfig;
    }

    if (!provider) {
      return { skipped: true, message: '未配置 AI Provider，跳过 AI 审查' };
    }

    const { AIClient } = require('../core/ai-client');
    const client = new AIClient(provider);

    // 构建审查 prompt
    const apis = caseVo.apiVos || [];
    const apiSummaries = apis.map((api, i) => {
      let headers = api.requestHeaders;
      if (typeof headers === 'string') {
        try { headers = JSON.parse(headers); } catch { headers = {}; }
      }
      return `[${i + 1}] ${api.apiMethod} ${api.apiUrl}
  名称: ${api.apiName || '-'}
  断言数: ${(api.assertVos || []).length}
  有请求体: ${api.requestBody ? '是' : '否'}`;
    }).join('\n');

    const prompt = `你是一名 API 测试专家，审查以下测试用例并给出改进建议。

## 用例信息
名称: ${caseVo.name || '-'}
域名: ${caseVo.domainName || '-'}
环境: ${['开发','测试','预发布','生产'][caseVo.environment] || '-'}

## 接口列表
${apiSummaries}

## 审查要求
请以 JSON 格式输出审查结果，包含以下字段：
1. overall_quality: "good"/"fair"/"poor"
2. summary: 总体评价（中文，50字以内）
3. suggestions: 改进建议数组，每项包含 { apiIndex: 数字, issue: 问题描述, suggestion: 建议 }

只输出 JSON，不要其他文字。`;

    try {
      const result = await client.generate(prompt, {
        system: '你是一个API测试用例审查助手，请专业分析用例质量，输出JSON格式结果。',
        temperature: 0.1,
        maxTokens: 2048,
      });

      const text = result.response || '';
      // 尝试提取 JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return { raw: text };
    } catch (e) {
      return { error: e.message };
    }
  }

  /**
   * AI 优化用例：审查后将审查发现的问题发给 AI，返回优化后的用例
   * @param {Object} caseVo - 原始用例对象
   * @param {Object} [findings] - 审查发现的问题
   * @returns {Promise<Object>} 优化后的用例
   */
  async _aiOptimize(caseVo, findings) {
    const aiConfig = (() => {
      try { return require('../core/ai-config').getActiveProvider(); } catch { return null; }
    })();
    if (!aiConfig) {
      return { optimizedCase: null, message: '未配置 AI Provider' };
    }
    const { AIClient } = require('../core/ai-client');
    const client = new AIClient(aiConfig);

    const apis = caseVo.apiVos || [];
    const apiSummaries = apis.map((api, i) => {
      const asserts = (api.assertVos || []).map(a =>
        `  - ${a.expression} ${a.validateType === 3 ? '=' : a.validateType === 1 ? 'not empty' : ''} ${a.expectValue || ''}`
      ).join('\n');
      return `[${i + 1}] ${api.apiMethod} ${api.apiUrl}\n  名称: ${api.apiName || '-'}\n  断言:\n${asserts || '  无断言'}`;
    }).join('\n');

    const findingsText = findings && findings.length > 0
      ? '\n## 审查发现问题\n' + findings.filter(f => !f.pass).map(f =>
          `- [#${f.apiIndex + 1}] ${f.ruleName}: ${f.message}`
        ).join('\n')
      : '';

    const prompt = `你是一名 API 测试专家，请优化以下测试用例。

## 用例信息
名称: ${caseVo.name || '-'}
域名: ${caseVo.domainName || '-'}

## 接口列表
${apiSummaries}${findingsText}

## 优化要求
请根据以下原则优化测试用例：
1. 修复缺失或错误的断言
2. 补充必要的请求头
3. 确保断言更精确（如状态码、关键字段）
4. 保留所有原始数据不变，仅修改断言和必要的请求参数

## 输出格式
请以 JSON 格式输出优化后的用例，保持与原用例相同的结构，只修改需要优化的部分。

只输出 JSON，不要其他文字。`;

    try {
      const result = await client.generate(prompt, {
        system: '你是一个API测试用例优化助手，请根据审查发现的问题优化用例，输出JSON格式结果。',
        temperature: 0.2,
        maxTokens: 8192,
      });

      const text = result.response || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const optimized = JSON.parse(jsonMatch[0]);
        return { optimizedCase: optimized, message: 'AI 优化完成' };
      }
      return { optimizedCase: null, message: '无法解析 AI 返回结果' };
    } catch (e) {
      return { optimizedCase: null, error: e.message };
    }
  }
}

module.exports = { ReviewerAgent, BUILTIN_RULES };
