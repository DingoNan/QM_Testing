/**
 * AgentMessage.js - Agent 间通信协议模型
 */

const AGENT_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  WAITING_USER: 'waiting_user',
  SKIPPED: 'skipped',
};

const MESSAGE_TYPE = {
  REQUEST: 'request',
  RESPONSE: 'response',
  ERROR: 'error',
  PROGRESS: 'progress',
  LOG: 'log',
};

class AgentMessage {
  /**
   * @param {Object} opts
   * @param {string} opts.agentId - Agent 唯一标识
   * @param {string} opts.type - 消息类型
   * @param {*} opts.payload - 消息负载
   * @param {Object} opts.metadata - 元数据
   */
  constructor(opts = {}) {
    this.agentId = opts.agentId || '';
    this.type = opts.type || MESSAGE_TYPE.REQUEST;
    this.payload = opts.payload ?? null;
    this.timestamp = Date.now();
    this.metadata = {
      inputFile: opts.metadata?.inputFile || '',
      outputFile: opts.metadata?.outputFile || '',
      progress: opts.metadata?.progress ?? 0,
      status: opts.metadata?.status || AGENT_STATUS.PENDING,
      message: opts.metadata?.message || '',
    };
  }

  /**
   * 创建进度消息
   */
  static progress(agentId, progress, message) {
    return new AgentMessage({
      agentId,
      type: MESSAGE_TYPE.PROGRESS,
      metadata: { progress, status: AGENT_STATUS.RUNNING, message },
    });
  }

  /**
   * 创建完成消息
   */
  static complete(agentId, payload, outputFile) {
    return new AgentMessage({
      agentId,
      type: MESSAGE_TYPE.RESPONSE,
      payload,
      metadata: { progress: 100, status: AGENT_STATUS.COMPLETED, outputFile },
    });
  }

  /**
   * 创建错误消息
   */
  static error(agentId, error) {
    return new AgentMessage({
      agentId,
      type: MESSAGE_TYPE.ERROR,
      payload: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      metadata: { status: AGENT_STATUS.FAILED, message: error.message || String(error) },
    });
  }

  /**
   * 创建等待用户输入消息
   */
  static waitingUser(agentId, payload) {
    return new AgentMessage({
      agentId,
      type: MESSAGE_TYPE.REQUEST,
      payload,
      metadata: { status: AGENT_STATUS.WAITING_USER, message: '等待用户确认' },
    });
  }

  toJSON() {
    return {
      agentId: this.agentId,
      type: this.type,
      payload: this.payload,
      timestamp: this.timestamp,
      metadata: this.metadata,
    };
  }
}

module.exports = { AgentMessage, AGENT_STATUS, MESSAGE_TYPE };
