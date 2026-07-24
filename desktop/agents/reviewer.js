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
   * 从 AI 返回文本中安全提取 JSON 对象
   * 支持：纯 JSON、代码块包裹、多余文本等情况
   */
  _extractJSON(text) {
    if (!text) return null;
    // 1) 直接解析整个文本
    try { return JSON.parse(text.trim()); } catch {}
    // 2) 从 markdown 代码块中提取
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      try { return JSON.parse(codeBlock[1].trim()); } catch {}
    }
    // 3) 括号平衡法：找到第一个完整 JSON 对象（避免多余文本干扰）
    let idx = 0;
    while ((idx = text.indexOf('{', idx)) !== -1) {
      let depth = 0;
      let inStr = false;
      for (let i = idx; i < text.length; i++) {
        const c = text[i];
        if (c === '"' && (i === 0 || text[i - 1] !== '\\')) { inStr = !inStr; continue; }
        if (!inStr) {
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) {
              try { return JSON.parse(text.substring(idx, i + 1)); } catch { break; }
            }
          }
        }
      }
      idx++;
    }
    return null;
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

    // Step 2.5: 候选扫描
    const candidates = this._scanCandidates(apis, linkedRecords);
    if (candidates.length > 0) {
      log.info(`候选扫描完成，发现 ${candidates.length} 个候选`);
    }

    // Step 3: AI 审查（可选）
    let aiReview = null;
    if (useAI) {
      this._updateProgress(60, '正在进行 AI 深度审查...');
      try {
        aiReview = await this._aiReview(caseVo, findings, input.aiProvider, input.aiChunkCb);
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
      candidates,
      aiReview,
      ruleConfigs,
      timestamp: new Date().toISOString(),
    });

    // 写入候选列表（供 UI 和 Apply 使用）
    this._writeJSON(path.join(this.outDir, 'candidates.json'), candidates);

    this._updateProgress(100, '智能审查完成');

    return {
      stats,
      findings,
      candidates,
      aiReview,
      ruleConfigs,
      outputFiles: {
        report: path.join(this.outDir, 'review-report.json'),
        candidates: path.join(this.outDir, 'candidates.json'),
      },
    };
  }

  /**
   * AI 深度审查：用 LLM 分析用例质量
   * @param {Object} caseVo - 用例对象
   * @param {Object} [aiProvider] - AI Provider 配置
   * @param {Function} [onChunk] - 流式回调，收到每个文本块时触发
   */
  async _aiReview(caseVo, findings, aiProvider, onChunk) {
    log.info(`AI 审查开始, 用例: ${caseVo.name || '-'}, 接口数: ${(caseVo.apiVos || []).length}`);
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
      log.warn('AI Provider 未配置, 跳过 AI 审查');
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

    // 将内置规则 findings 传入 prompt
    const findingsText = findings && findings.length > 0
      ? '\n## 内置规则审查发现的问题（供参考）\n' + findings.filter(f => !f.pass).map(f =>
          `- [#${f.apiIndex + 1}] [${f.severity}] ${f.ruleName}: ${f.message}`
        ).join('\n')
      : '';

    const prompt = `你是一名 API 测试专家，审查以下测试用例并给出改进建议。

## 用例信息
名称: ${caseVo.name || '-'}
域名: ${caseVo.domainName || '-'}
环境: ${['开发','测试','预发布','生产'][caseVo.environment] || '-'}

## 接口列表
${apiSummaries}${findingsText}

## 审查要求
请以 JSON 格式输出审查结果，包含以下字段：
1. overall_quality: "good"/"fair"/"poor"
2. summary: 总体评价（中文，50字以内）
3. suggestions: 改进建议数组，每项包含：
   - apiIndex: 数字
   - issue: 问题描述
   - suggestion: 改进建议（文字说明）
   - solution: 具体的修复方案（JSON 代码片段或配置说明）

注意：针对内置规则发现的问题，必须给出具体的 solution 字段，
      说明如何修改断言、请求体、请求头等。
只输出 JSON，不要其他文字。`;

    try {
      const systemMsg = '你是一个API测试用例审查助手，请专业分析用例质量，输出JSON格式结果。';
      const opts = { system: systemMsg, temperature: 0.1, maxTokens: 2048 };

      let result;
      if (onChunk) {
        result = await client.generateStream(prompt, onChunk, opts);
      } else {
        result = await client.generate(prompt, opts);
      }

      const text = result.response || '';
      // 尝试提取 JSON（支持代码块、多余文本等情况）
      const parsed = this._extractJSON(text);
      if (parsed) {
        log.info(`AI 审查完成, 质量评级: ${parsed.overall_quality || 'unknown'}, 建议数: ${(parsed.suggestions || []).length}`);
        return parsed;
      }
      log.warn(`AI 审查返回结果无法解析: ${text.slice(0, 200)}`);
      return { raw: text };
    } catch (e) {
      log.error(`AI 审查失败: ${e.message}`);
      return { error: e.message };
    }
  }

  /**
   * AI 优化用例：审查后将审查发现的问题发给 AI，返回优化后的用例
   * @param {Object} caseVo - 原始用例对象
   * @param {Object[]} [findings] - 审查发现的问题
   * @param {Function} [onChunk] - 流式回调，收到每个文本块时触发
   * @returns {Promise<Object>} 优化后的用例
   */
  async _aiOptimize(caseVo, findings, aiSuggestions, onChunk) {
    log.info(`AI 优化开始, 模式: 全量, 用例: ${caseVo.name || '-'}, 接口数: ${(caseVo.apiVos || []).length}`);
    const aiConfig = (() => {
      try { return require('../core/ai-config').getActiveProvider(); } catch { return null; }
    })();
    if (!aiConfig) {
      log.warn('AI Provider 未配置, 跳过 AI 优化');
      return { optimizedCase: null, message: '未配置 AI Provider' };
    }
    const { AIClient } = require('../core/ai-client');
    const client = new AIClient(aiConfig);

    const apis = caseVo.apiVos || [];
    const apiSummaries = apis.map((api, i) => {
      const asserts = (api.assertVos || []).map(a =>
        `  - ${a.expression} ${a.validateType === 3 ? `= ${a.expectValue ?? '(空)'}` : a.validateType === 1 ? '(非空检查)' : a.validateType === 0 ? '(存在检查)' : ''}`
      ).join('\n');
      return `[${i + 1}] ${api.apiMethod} ${api.apiUrl}\n  名称: ${api.apiName || '-'}\n  断言:\n${asserts || '  无断言'}`;
    }).join('\n');

    const findingsText = findings && findings.length > 0
      ? '\n## 内置规则审查发现的问题\n' + findings.filter(f => !f.pass).map(f =>
          `- [#${f.apiIndex + 1}] [${f.severity}] ${f.ruleName}: ${f.message}`
        ).join('\n')
      : '';

    // 将 AI 审查 suggestions 传入 prompt
    const aiSuggestionsText = aiSuggestions && aiSuggestions.length > 0
      ? '\n## AI 深度审查建议（供参考，优先遵循）\n' + aiSuggestions.map(s =>
          `- [#${s.apiIndex + 1}] ${s.issue}\n  建议: ${s.suggestion}\n  修复方案: ${s.solution || '无具体方案'}`
        ).join('\n')
      : '';

    const prompt = `你是一名 API 测试专家，请优化以下测试用例。

## 用例信息
名称: ${caseVo.name || '-'}
域名: ${caseVo.domainName || '-'}

## 接口列表
${apiSummaries}${findingsText}${aiSuggestionsText}

## 优化要求
请**优先按照 AI 深度审查给出的修复方案**进行优化。
如果 AI 审查未给出具体方案，再结合内置规则发现的问题自行修复。

**最重要的原则：只添加缺失的断言，不要修改已有的断言！**

具体操作：
1. 只添加缺失的状态码断言（如 responseBody.code = 200）
2. **已有的断言必须保持原样输出**，不要改变其 expression、validateType 或 expectValue
3. 断言中的 \`(空)\` 表示该断言未设置期望值，这是合理状态，不要试图"修复"
4. 断言中的 \`(非空检查)\` / \`(存在检查)\` 表示仅检查字段是否存在，不需要期望值
5. 补充必要的请求头
6. **⚠️ 防过度修复**：不要修改本应为空的请求参数。保留原始空值/空字符串
7. 保留所有原始数据不变
8. **不要删除任何接口**

## 输出格式
请以 JSON 格式输出优化后的用例，保持与原用例相同的结构，只修改需要优化的部分。
优化后的 JSON 中 apiVos 数组长度必须与原始完全一致。

只输出 JSON，不要其他文字。`;

    try {
      const opts = {
        system: '你是一个API测试用例优化助手，请根据审查发现的问题优化用例，输出JSON格式结果。',
        temperature: 0.2,
        maxTokens: 8192,
      };

      let result;
      if (onChunk) {
        result = await client.generateStream(prompt, onChunk, opts);
      } else {
        result = await client.generate(prompt, opts);
      }

      const text = result.response || '';
      const parsedObj = this._extractJSON(text);
      if (parsedObj) {
        log.info('AI 优化完成 (全量)');
        return { optimizedCase: parsedObj, message: 'AI 优化完成' };
      }
      log.warn(`AI 优化返回结果无法解析: ${text.slice(0, 200)}`);
      return { optimizedCase: null, message: '无法解析 AI 返回结果' };
    } catch (e) {
      log.error(`AI 优化失败: ${e.message}`);
      return { optimizedCase: null, error: e.message };
    }
  }

  /**
   * AI 单条接口优化：针对指定的单个接口进行 AI 优化
   * @param {Object} caseVo - 原始用例对象
   * @param {number} apiIndex - 要优化的接口索引
   * @param {Object[]} [findings] - 审查发现的问题
   * @param {Function} [onChunk] - 流式回调
   * @returns {Promise<Object>}
   */
  async _aiOptimizeSingle(caseVo, apiIndex, findings, aiSuggestions, onChunk) {
    log.info(`AI 优化开始, 模式: 单条(#${apiIndex + 1}), 用例: ${caseVo.name || '-'}`);
    const aiConfig = (() => {
      try { return require('../core/ai-config').getActiveProvider(); } catch { return null; }
    })();
    if (!aiConfig) {
      log.warn('AI Provider 未配置, 跳过 AI 单条优化');
      return { optimizedApi: null, message: '未配置 AI Provider' };
    }
    const { AIClient } = require('../core/ai-client');
    const client = new AIClient(aiConfig);

    const apis = caseVo.apiVos || [];
    const api = apis[apiIndex];
    if (!api) return { optimizedApi: null, message: '接口不存在' };

    const apiFindings = (findings || []).filter(f => f.apiIndex === apiIndex && !f.pass);

    // 筛选该接口的 AI 审查建议
    const apiAiSuggestions = (aiSuggestions || []).filter(s => s.apiIndex === apiIndex);

    const asserts = (api.assertVos || []).map(a =>
      `  - ${a.expression} ${a.validateType === 3 ? `= ${a.expectValue ?? '(空)'}` : a.validateType === 1 ? '(非空检查)' : a.validateType === 0 ? '(存在检查)' : ''}`
    ).join('\n');

    const aiSuggestionsText = apiAiSuggestions.length > 0
      ? '\n## AI 深度审查建议（供参考，优先遵循）\n' + apiAiSuggestions.map(s =>
          `- ${s.issue}\n  建议: ${s.suggestion}\n  修复方案: ${s.solution || '无具体方案'}`
        ).join('\n')
      : '';

    const prompt = `你是一名 API 测试专家，请优化以下测试用例中的单个接口。

## 用例信息
名称: ${caseVo.name || '-'}
域名: ${caseVo.domainName || '-'}

## 接口信息
序号: #${apiIndex + 1}
方法: ${api.apiMethod}
URL: ${api.apiUrl}
名称: ${api.apiName || '-'}
请求头: ${JSON.stringify(api.requestHeaders || {})}
请求体: ${api.requestBody || '无'}
断言:\n${asserts || '  无断言'}

## 内置规则审查发现的问题
${apiFindings.map(f => `- [${f.severity}] ${f.ruleName}: ${f.message}`).join('\n') || '无发现的问题'}${aiSuggestionsText}

## 优化要求
请**优先按照 AI 深度审查给出的修复方案**进行优化。
如果 AI 审查未给出具体方案，再结合内置规则发现的问题自行修复。

**最重要的原则：只添加缺失的断言，不要修改已有的断言！**

1. 只添加缺失的状态码断言（如 responseBody.code = 200）
2. **已有的断言必须保持原样输出**，不要改变其 expression、validateType 或 expectValue
3. 断言中的 \`(空)\` 表示该断言未设置期望值，这是合理状态，不要试图"修复"
4. 断言中的 \`(非空检查)\` / \`(存在检查)\` 表示仅检查字段是否存在，不需要期望值
5. 补充必要的请求头
6. **⚠️ 防过度修复**：保留原始空值/空字符串
7. 只输出优化后的单个接口 JSON，不要输出完整用例

## 输出格式
只输出以下格式的 JSON，不要其他文字：
{
  "apiMethod": "...",
  "apiUrl": "...",
  "requestHeaders": {...},
  "requestBody": "...",
  "assertVos": [...],
  "apiScript": {...}
}`;

    try {
      const opts = {
        system: '你是一个API测试用例优化助手，请针对单个接口进行优化，输出JSON格式结果。',
        temperature: 0.2,
        maxTokens: 4096,
      };

      let result;
      if (onChunk) {
        result = await client.generateStream(prompt, onChunk, opts);
      } else {
        result = await client.generate(prompt, opts);
      }

      const text = result.response || '';
      const parsedObj = this._extractJSON(text);
      if (parsedObj) {
        log.info(`AI 单条优化完成 (#${apiIndex + 1})`);
        return { optimizedApi: parsedObj, message: 'AI 单条优化完成' };
      }
      log.warn(`AI 单条优化返回结果无法解析: ${text.slice(0, 200)}`);
      return { optimizedApi: null, message: '无法解析 AI 返回结果' };
    } catch (e) {
      log.error(`AI 单条优化失败: ${e.message}`);
      return { optimizedApi: null, error: e.message };
    }
  }

  /**
   * 扫描 5 类候选问题
   * 1. hardcoded_seed_value - 硬编码测试数据（手机号/邮箱/UUID/身份证）
   * 2. likely_auxiliary_interface - 辅助接口（/page /list /dict 等）
   * 3. isolated_interface - 孤立接口（无上下游依赖）
   * 4. unstable_array_index - 数组下标引用不稳定
   * 5. unreplaced_path_segment - URL 残留数字路径段
   */
  _scanCandidates(apis, linkedRecords) {
    const candidates = [];
    let seqCounter = 0;

    // 收集每个接口的引用图
    const apiRefs = {}; // apiIndex -> { refs: Set<targetIdx>, referencedBy: Set<sourceIdx> }
    for (let i = 0; i < apis.length; i++) {
      apiRefs[i] = { refs: new Set(), referencedBy: new Set() };
    }

    // 从每个接口的 requestBody, apiUrl 中提取 ${seq.N} 引用
    for (let i = 0; i < apis.length; i++) {
      const api = apis[i];
      const allText = [
        api.apiUrl || '',
        ...Object.values(api.requestHeaders || {}).map(String),
        typeof api.requestBody === 'string' ? api.requestBody : JSON.stringify(api.requestBody || ''),
      ].join(' ');

      // 找出所有 ${N.path} 或 seq.N 引用
      const seqRefs = allText.match(/\$\{?(?:seq\.)?(\d+)(?:\.|[}\]])/g) || [];
      for (const ref of seqRefs) {
        const idx = parseInt(ref.match(/(\d+)/)[1], 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < apis.length) {
          apiRefs[idx]?.referencedBy.add(i);
          apiRefs[i]?.refs.add(idx);
        }
      }
    }

    for (let i = 0; i < apis.length; i++) {
      const api = apis[i];
      const apiName = api.apiName || `#${i + 1}`;
      const apiUrl = api.apiUrl || '';
      const bodyText = typeof api.requestBody === 'string'
        ? api.requestBody : JSON.stringify(api.requestBody || '');

      // ========== 1. 硬编码种子值检测 ==========
      const seedPatterns = [
        { pattern: /1[3-9]\d{9}/g, label: '手机号', funcSuggestion: '${Tel}' },
        { pattern: /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, label: '身份证号', funcSuggestion: '${IC}' },
        { pattern: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, label: 'UUID', funcSuggestion: '${RandomUUID}' },
        { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, label: '邮箱', funcSuggestion: '${RandomUUID}@test.com' },
      ];

      for (const { pattern, label, funcSuggestion } of seedPatterns) {
        const matches = bodyText.match(pattern) || [];
        for (const val of matches) {
          // 跳过 exclamation words in assertions
          const ctxBefore = bodyText.substring(0, bodyText.indexOf(val));
          if (ctxBefore.endsWith('expectValue') || ctxBefore.endsWith('value')) continue;

          candidates.push({
            candidate_id: `hc_${seqCounter++}`,
            type: 'hardcoded_seed_value',
            severity: 'warning',
            apiIndex: i,
            apiName,
            apiUrl,
            label: `硬编码${label}`,
            location: `requestBody`,
            current_value: val,
            suggestion: `建议替换为平台函数 ${funcSuggestion}`,
            action: 'replace_value',
            actionPayload: { search: val, replace: funcSuggestion },
          });
        }
      }

      // ========== 2. 辅助接口检测 ==========
      const auxPathPatterns = [
        /\/(?:get|list|page|query|search|find|select|dict|menu|tree|enum|category|type)\b/i,
        /\/(?:export|import|download|upload|preview|view|detail)\b/i,
        /\/(?:count|stat|statistics|sum|total|summary|report)\b/i,
        /\/check|\/validate|\/verify|\/exist/i,
      ];
      if (auxPathPatterns.some(p => p.test(apiUrl))) {
        // 标记为辅助接口 — 只有不被其他接口引用且自身无 seq 引用时才标记
        const referenced = apiRefs[i]?.referencedBy.size > 0;
        const hasRefs = apiRefs[i]?.refs.size > 0;
        if (!referenced && !hasRefs) {
          candidates.push({
            candidate_id: `aux_${seqCounter++}`,
            type: 'likely_auxiliary_interface',
            severity: 'info',
            apiIndex: i,
            apiName,
            apiUrl,
            label: '可能为辅助接口（查询/列表/字典类）',
            location: 'apiUrl',
            current_value: apiUrl,
            suggestion: '建议确认是否必要，可删除或合并到主接口',
            action: 'review_only',
          });
        }
      }

      // ========== 3. 孤立接口检测 ==========
      const hasSeqRef = (api.apiUrl || '').includes('\${') || bodyText.includes('\${');
      if (!hasSeqRef) {
        const referenced = apiRefs[i]?.referencedBy.size > 0;
        if (!referenced && i > 0) {
          candidates.push({
            candidate_id: `iso_${seqCounter++}`,
            type: 'isolated_interface',
            severity: 'info',
            apiIndex: i,
            apiName,
            apiUrl,
            label: '孤立接口（无上下游依赖）',
            current_value: apiUrl,
            suggestion: '确认是否为独立业务接口，可考虑提取为独立用例',
            action: 'review_only',
          });
        }
      }

      // ========== 4. 不稳定数组下标 ==========
      // 查找 ${seq.N.xxx[数字]} 模式
      const arrayIdxMatches = allText.match(/\$\{?(?:seq\.)?\d+\.[^}]*\[\d+\]/g) || [];
      for (const match of arrayIdxMatches) {
        candidates.push({
          candidate_id: `arr_${seqCounter++}`,
          type: 'unstable_array_index',
          severity: 'warning',
          apiIndex: i,
          apiName,
          apiUrl,
          label: '不稳定的数组下标引用',
          location: `${api.apiName || `#${i + 1}`}.requestBody`,
          current_value: match,
          suggestion: `${match} 使用硬编码索引，当响应结构变化时可能断裂，建议改用字段名匹配`,
          action: 'review_only',
        });
      }

      // ========== 5. URL 残留未替换段 ==========
      // 匹配路径中以数字结尾的部分（且该段不在参考域名中）
      // 排除常见端口号
      const urlPathOnly = (apiUrl || '').replace(/^https?:\/\/[^\/]+/, '');
      const pathSegments = urlPathOnly.split('/').filter(Boolean);
      for (const seg of pathSegments) {
        // 全数字且长度 >= 4（排除年份等短数字）
        if (/^\d{4,}$/.test(seg) && !seg.startsWith('20') && !seg.startsWith('19')) {
          candidates.push({
            candidate_id: `url_${seqCounter++}`,
            type: 'unreplaced_path_segment',
            severity: 'warning',
            apiIndex: i,
            apiName,
            apiUrl,
            label: 'URL 路径可能未替换的数字参数',
            location: `apiUrl segment: ${seg}`,
            current_value: seg,
            suggestion: `路径段 '${seg}' 可能是录制时的具体 ID，建议替换为 ${'$'}{seq.N.path} 引用`,
            action: 'review_only',
          });
        }
      }
    }

    return candidates;
  }

  /**
   * 应用候选修改到 CaseVo
   * @param {Object} caseVo - 用例对象
   * @param {Array} applyItems - [{ candidate_id, action, actionPayload }]
   * @returns {Object} 修改后的 caseVo
   */
  _applyCandidates(caseVo, applyItems) {
    if (!caseVo?.apiVos) return caseVo;
    const apis = caseVo.apiVos;

    // 收集要删除的 apiIndex
    const toDelete = new Set();
    // 收集要替换的值
    const replacements = []; // { apiIndex, search, replace }

    for (const item of applyItems) {
      if (item.action === 'replace_value' && item.actionPayload) {
        replacements.push({
          apiIndex: item.apiIndex,
          search: item.actionPayload.search,
          replace: item.actionPayload.replace,
        });
      }
    }

    // 先执行替换
    for (const { apiIndex, search, replace } of replacements) {
      const api = apis[apiIndex];
      if (!api) continue;
      if (typeof api.requestBody === 'string') {
        api.requestBody = api.requestBody.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replace);
      } else if (api.requestBody && typeof api.requestBody === 'object') {
        const bodyStr = JSON.stringify(api.requestBody);
        api.requestBody = JSON.parse(
          bodyStr.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replace)
        );
      }
    }

    // 处理删除
    if (toDelete.size > 0) {
      caseVo.apiVos = apis.filter((_, i) => !toDelete.has(i));
      // 重新编号 orderNum
      caseVo.apiVos.forEach((api, idx) => {
        api.orderNum = idx + 1;
      });
      // 重映射 ${seq.N} 引用（+ 删除后的偏移）
      // 构建索引映射
      const idxMap = {};
      let newIdx = 0;
      for (let i = 0; i < apis.length; i++) {
        if (!toDelete.has(i)) {
          idxMap[i] = newIdx++;
        }
      }
      const remapRef = (str) => {
        if (!str || typeof str !== 'string') return str;
        return str.replace(/\$\{?(?:seq\.)?(\d+)(?:\.)/g, (match, num) => {
          const oldIdx = parseInt(num, 10) - 1;
          const newIdx2 = idxMap[oldIdx];
          if (newIdx2 !== undefined && newIdx2 !== oldIdx) {
            return match.replace(/(\d+)/, String(newIdx2 + 1));
          }
          return match;
        });
      };
      // 对所有接口的引用进行重映射
      for (const api of caseVo.apiVos) {
        api.apiUrl = remapRef(api.apiUrl);
        if (typeof api.requestBody === 'string') {
          api.requestBody = remapRef(api.requestBody);
        } else if (api.requestBody) {
          const str = JSON.stringify(api.requestBody);
          api.requestBody = JSON.parse(remapRef(str));
        }
      }
    }

    return caseVo;
  }
}

module.exports = { ReviewerAgent, BUILTIN_RULES };
