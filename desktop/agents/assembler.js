/**
 * assembler.js - Agent-4: 用例拼装
 * 功能：构建标准 CaseVo 格式、自动断言、Header 整理
 */

const { BaseAgent } = require('./base-agent');
const { CaseVo } = require('../models/CaseVo');
const { TestDataPool } = require('../models/TestDataPool');
const path = require('path');

const logger = require('../core/logger');
const log = logger.create('Assembler');

class AssemblerAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      id: 'assembler',
      name: '用例拼装',
      description: '构建标准 CaseVo 格式并添加断言',
      ...opts,
    });
  }

  async execute(input) {
    this._updateProgress(0, '开始拼装用例...');
    log.info('开始拼装用例');

    const records = input.data || [];
    const config = input.config || {};
    const envConfig = input.envConfig || {};

    if (!records || records.length === 0) {
      log.warn('输入数据为空，请先完成关联步骤');
      throw new Error('输入数据为空，请先完成关联步骤');
    }

    log.info(`共 ${records.length} 个接口待拼装`);
    this._updateProgress(20, `共 ${records.length} 个接口待拼装`);

    const projectId = config.projectId || 0;
    const environment = config.environment ?? 1;
    const caseName = config.name || records[0]?.scenarioName || `用例_${new Date().toISOString().slice(0, 10)}`;
    const domainName = config.domainName || envConfig.baseURL || records[0]?.domain || '';

    // 扩展配置：数据池、迭代模式、串联规则
    const dataPoolConfig = input.dataPoolConfig || null;
    const iterationMode = input.iterationMode || 'none';
    const chainRules = input.chainRules || [];

    // 构建 CaseVo
    const caseVo = CaseVo.fromLinkedRecords(records, {
      name: caseName,
      projectId,
      environment,
      domainName,
    });

    // 注入扩展配置到 CaseVo
    if (dataPoolConfig) {
      caseVo.dataPoolId = dataPoolConfig.id || '';
      caseVo.iterationMode = iterationMode;
      caseVo.chainRules = chainRules;
      caseVo.dataBinding = config.dataBinding || {};
      caseVo.deployment = config.deployment || {};
    }

    // 展开模式 (expand): 如果有数据池，生成多组 CaseVo
    if (iterationMode === 'expand' && dataPoolConfig) {
      return await this._generateExpandedCases(caseVo, dataPoolConfig, records, input);
    }

    // 循环模式 (loop): 单个 CaseVo 注入数据池引用
    if (iterationMode === 'loop' && dataPoolConfig) {
      caseVo.metadata = caseVo.metadata || {};
      caseVo.metadata.dataPool = {
        id: dataPoolConfig.id,
        name: dataPoolConfig.name,
        source: dataPoolConfig.source,
        rowCount: (dataPoolConfig.rows || []).length,
        fields: (dataPoolConfig.fields || []).map(f => f.name || f),
      };
    }

    // 注入环境配置元数据到 CaseVo
    if (envConfig && Object.keys(envConfig).length > 0) {
      if (!caseVo.metadata) caseVo.metadata = {};
      caseVo.metadata.envConfig = {
        baseURL: envConfig.baseURL || '',
        authType: envConfig.authType || 'none',
        globalHeaders: envConfig.globalHeaders || {},
        envType: envConfig.envType,
        name: envConfig.name || '',
      };
    }

    this._updateProgress(60, 'CaseVo 拼装完成');
    log.info('CaseVo 用例拼装完成');

    // 统计
    const stats = {
      apiCount: caseVo.apiCount,
      methods: {},
      hasAssertions: 0,
    };
    for (const api of caseVo.apiVos) {
      stats.methods[api.apiMethod] = (stats.methods[api.apiMethod] || 0) + 1;
      if (api.assertVos && api.assertVos.length > 0) {
        stats.hasAssertions++;
      }
    }

    // 写入文件
    const casePath = this._writeJSON(
      path.join(this.outDir, 'case-save.json'), caseVo.toJSON()
    );

    this._updateProgress(100, '用例拼装完成');
    log.info(`用例拼装完成: ${caseVo.apiCount} 个接口, ${stats.hasAssertions} 个含断言`);

    return {
      caseVo: caseVo.toJSON(),
      stats,
      outputFiles: {
        caseSave: casePath,
      },
    };
  }

  /**
   * 展开模式：为数据池每行数据生成独立 CaseVo
   */
  async _generateExpandedCases(baseCaseVo, dataPoolConfig, records, input) {
    let dataPool;
    if (dataPoolConfig instanceof TestDataPool) {
      dataPool = dataPoolConfig;
    } else if (typeof dataPoolConfig === 'object' && dataPoolConfig.rows) {
      dataPool = new TestDataPool(dataPoolConfig);
    } else {
      log.warn('展开模式数据池配置无效，回退到标准模式');
      return this.execute(input);
    }

    const enabledRows = dataPool.getEnabledRows();
    log.info(`展开模式: 为 ${enabledRows.length} 行数据生成 ${enabledRows.length} 个 CaseVo`);

    const expandedCases = [];
    for (let rowIdx = 0; rowIdx < enabledRows.length; rowIdx++) {
      const row = enabledRows[rowIdx];
      // 复制基础 CaseVo，注入当前行数据
      const caseJson = baseCaseVo.toJSON();
      caseJson.name = `${baseCaseVo.name}_行${rowIdx + 1}`;
      caseJson.metadata = caseJson.metadata || {};
      caseJson.metadata.dataRow = {
        index: rowIdx,
        values: { ...row.values },
      };
      caseJson.metadata.dataPoolInfo = {
        id: dataPool.id,
        name: dataPool.name,
      };
      // 对于每行数据，将 data.* 变量预替换到 apiVos 中
      caseJson.apiVos = caseJson.apiVos.map(api => {
        const resolved = { ...api };
        // 用 VarResolver 处理每行的变量替换
        const { VariableResolver } = require('../models/VarResolver');
        const vr = new VariableResolver();
        const ctx = {
          envConfig: input.envConfig || {},
          dataRow: row.values,
          ctxVars: {},
          seqResponses: {},
          linkedRecords: records || [],
          currentIndex: 0,
        };
        if (typeof resolved.requestHeaders === 'string') {
          resolved.requestHeaders = vr.resolve(resolved.requestHeaders, ctx);
        } else if (typeof resolved.requestHeaders === 'object') {
          resolved.requestHeaders = vr.resolveObject(resolved.requestHeaders, ctx);
        }
        resolved.apiUrl = vr.resolve(resolved.apiUrl, ctx);
        if (typeof resolved.requestBody === 'string') {
          resolved.requestBody = vr.resolve(resolved.requestBody, ctx);
        } else if (resolved.requestBody && typeof resolved.requestBody === 'object') {
          resolved.requestBody = vr.resolveObject(resolved.requestBody, ctx);
        }
        return resolved;
      });
      expandedCases.push(caseJson);
    }

    // 写入文件：如果是单行情况就写标准格式，多行写数组
    const outputPath = path.join(this.outDir, 'case-save.json');
    if (expandedCases.length === 1) {
      this._writeJSON(outputPath, expandedCases[0]);
    } else {
      this._writeJSON(outputPath, { expandedMode: true, cases: expandedCases, totalCaseCount: expandedCases.length });
    }

    this._updateProgress(100, '展开模式用例拼装完成');
    log.info(`展开模式完成: ${expandedCases.length} 个用例`);

    return {
      caseVo: expandedCases.length === 1 ? expandedCases[0] : expandedCases,
      stats: {
        apiCount: baseCaseVo.apiCount,
        rowCount: expandedCases.length,
        totalCaseCount: expandedCases.length,
      },
      outputFiles: {
        caseSave: outputPath,
      },
    };
  }
}

module.exports = { AssemblerAgent };
