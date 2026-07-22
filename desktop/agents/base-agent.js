/**
 * base-agent.js - Agent 基类
 * 所有 Agent 继承此类，统一生命周期
 */

const path = require('path');
const fs = require('fs');

class BaseAgent {
  /**
   * @param {Object} opts
   * @param {string} opts.id - Agent ID
   * @param {string} opts.name - Agent 名称
   * @param {string} opts.description - 描述
   */
  constructor(opts = {}) {
    this.id = opts.id || 'base';
    this.name = opts.name || 'BaseAgent';
    this.description = opts.description || '';
    this.outDir = opts.outDir || 'out';
    this._status = 'pending'; // pending/running/completed/failed/waiting_user
    this._progress = 0;
    this._onProgress = null;
    this._onComplete = null;
    this._onError = null;
    this._onWaitingUser = null;
  }

  get status() { return this._status; }
  get progress() { return this._progress; }

  /**
   * 执行 Agent 处理
   * @param {Object} input - 输入数据
   * @returns {Promise<Object>} 输出数据
   */
  async execute(input) {
    throw new Error('子类必须实现 execute 方法');
  }

  /**
   * 更新进度
   */
  _updateProgress(progress, message) {
    this._progress = Math.min(100, Math.max(0, progress));
    if (this._onProgress) {
      this._onProgress({ agentId: this.id, progress: this._progress, message });
    }
  }

  /**
   * 标记等待用户输入
   */
  _waitForUser(payload) {
    this._status = 'waiting_user';
    if (this._onWaitingUser) {
      this._onWaitingUser({ agentId: this.id, payload });
    }
  }

  /**
   * 标记完成
   */
  _markComplete(output) {
    this._status = 'completed';
    this._progress = 100;
    if (this._onComplete) {
      this._onComplete({ agentId: this.id, output });
    }
  }

  /**
   * 标记失败
   */
  _markError(error) {
    this._status = 'failed';
    if (this._onError) {
      this._onError({ agentId: this.id, error: error.message || String(error) });
    }
  }

  /**
   * 读取 JSON 文件辅助方法
   */
  _readJSON(filePath) {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`文件不存在: ${absPath}`);
    }
    return JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  }

  /**
   * 写入 JSON 文件辅助方法
   */
  _writeJSON(filePath, data) {
    const absPath = path.resolve(filePath);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, JSON.stringify(data, null, 2), 'utf-8');
    return absPath;
  }

  /**
   * 设置回调
   */
  onProgress(cb) { this._onProgress = cb; return this; }
  onComplete(cb) { this._onComplete = cb; return this; }
  onError(cb) { this._onError = cb; return this; }
  onWaitingUser(cb) { this._onWaitingUser = cb; return this; }
}

module.exports = { BaseAgent };
