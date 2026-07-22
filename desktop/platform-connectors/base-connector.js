/**
 * base-connector.js - 平台连接器基类
 */

class BaseConnector {
  /**
   * @param {Object} opts
   * @param {string} opts.name - 平台名称
   * @param {string} opts.baseURL - 平台地址
   */
  constructor(opts = {}) {
    this.name = opts.name || 'base';
    this.baseURL = opts.baseURL || '';
  }

  /**
   * 导入用例到平台
   * @param {Object} caseVo - CaseVo 格式的用例数据
   * @param {Object} auth - 认证信息
   * @returns {Promise<Object>} 导入结果
   */
  async importCase(caseVo, auth) {
    throw new Error('子类必须实现 importCase 方法');
  }

  /**
   * 获取平台项目列表
   * @param {Object} auth - 认证信息
   * @returns {Promise<Array>} 项目列表
   */
  async listProjects(auth) {
    throw new Error('子类必须实现 listProjects 方法');
  }

  /**
   * 导出用例为文件
   * @param {Object} caseVo - CaseVo 数据
   * @param {string} format - 格式 (json/csv/xlsx)
   * @returns {Promise<Object>} { filePath, format }
   */
  async exportToFile(caseVo, format = 'json') {
    const fs = require('fs');
    const path = require('path');
    const outDir = path.resolve(process.cwd(), 'out');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    let filePath;
    switch (format) {
      case 'json':
        filePath = path.join(outDir, 'export-case.json');
        fs.writeFileSync(filePath, JSON.stringify(caseVo, null, 2), 'utf-8');
        break;
      case 'csv': {
        filePath = path.join(outDir, 'export-case.csv');
        const lines = ['orderNum,apiMethod,apiName,apiUrl,requestType,requestHeaders,requestBody'];
        if (caseVo.apiVos) {
          for (const api of caseVo.apiVos) {
            lines.push([
              api.orderNum, api.apiMethod, api.apiName, api.apiUrl,
              api.requestType,
              `"${(api.requestHeaders || '').replace(/"/g, '""')}"`,
              `"${(api.requestBody || '').replace(/"/g, '""')}"`,
            ].join(','));
          }
        }
        fs.writeFileSync(filePath, '\uFEFF' + lines.join('\n'), 'utf-8');
        break;
      }
      default:
        throw new Error(`不支持的导出格式: ${format}`);
    }

    return { filePath, format };
  }
}

module.exports = { BaseConnector };
