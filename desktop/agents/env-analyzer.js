/**
 * env-analyzer.js - Agent-3: 环境识别
 * 从录制数据推断测试环境，支持用户通过 UI 补充配置
 * 前置在 Linker 之前运行，环境信息用于辅助关联决策
 */
const { BaseAgent } = require('./base-agent');
const { Environment } = require('../models/Environment');
const path = require('path');
const fs = require('fs');

const logger = require('../core/logger');
const log = logger.create('EnvAnalyzer');

class EnvAnalyzerAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      id: 'env-analyzer',
      name: '环境识别',
      description: '自动推断测试环境，提取 baseURL、认证方式、token路径',
      ...opts,
    });
  }

  async execute(input) {
    this._updateProgress(0, '开始环境识别...');
    log.info('开始环境识别');

    const records = input.data || [];
    if (!records || records.length === 0) {
      log.warn('输入数据为空，无法识别环境');
      throw new Error('输入数据为空，无法识别环境');
    }

    log.info(`扫描 ${records.length} 条接口记录`);
    this._updateProgress(20, `扫描 ${records.length} 条接口记录`);

    // 使用 Environment.fromRecords 自动提取
    const env = Environment.fromRecords(records);
    const envJson = env.toJSON();

    this._updateProgress(40, `检测域名: ${envJson.baseURL || '无'}`);
    this._updateProgress(50, `认证方式: ${envJson.authType}`);
    log.info(`检测域名: ${envJson.baseURL || '无'}, 认证方式: ${envJson.authType}`);

    // domains 已由 Environment.fromRecords 计算，直接使用
    // 附加每个接口的域名信息，供后续 Linker 使用
    const enriched = records.map((r) => {
      let host = '';
      try { const u = new URL(r.url); host = u.origin; } catch {}
      return { ...r, env_host: host || envJson.baseURL };
    });

    this._updateProgress(70, '环境配置生成完毕，等待用户确认/补充');
    this._updateProgress(80, '写入环境配置');

    // 写入文件
    const envPath = this._writeJSON(
      path.join(this.outDir, 'env-config.json'), envJson
    );

    this._updateProgress(90, '等待用户确认环境配置');

    // 等待用户补充/确认
    this._waitForUser({
      type: 'env_config',
      envConfig: envJson,
      message: '请确认或补充环境配置信息',
      fields: ['baseURL', 'authType', 'authConfig.tokenPath', 'globalHeaders'],
    });

    this._updateProgress(100, '环境识别完成');

    return {
      environment: envJson,
      records: enriched,
      outputFiles: { envConfig: envPath },
      userActionRequired: true,
    };
  }
}

module.exports = { EnvAnalyzerAgent };
