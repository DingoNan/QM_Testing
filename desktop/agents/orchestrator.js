/**
 * orchestrator.js - 管道编排器
 * 负责 Agent 调度、状态管理、异常恢复、断点续传
 * 支持异步分片处理，避免阻塞事件循环
 */
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const logger = require('../core/logger');

const log = logger.create('Orchestrator');

/** 每次 await 的分片间隔 (ms)，让事件循环有机会处理 UI 更新 */
const YIELD_INTERVAL = 50;

class Orchestrator extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.outDir = opts.outDir || path.resolve(process.cwd(), 'out');
    this.pipeline = opts.pipeline || { stages: [] };
    this.agents = {};
    this.context = {};
    this.results = {};
    this._currentIndex = 0;
    this._running = false;
    this._aborted = false;
  }

  registerAgent(agent) {
    this.agents[agent.id] = agent;
    return this;
  }

  /**
   * 异步让出控制权，防止长任务阻塞事件循环
   */
  _yield() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * 分块处理数组，每块后让出控制权
   * @param {Array} items
   * @param {Function} fn - 处理函数 (item, index) => any
   * @param {number} chunkSize - 每块大小
   */
  async processInChunks(items, fn, chunkSize = 50) {
    const results = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      if (this._aborted) break;
      const chunk = items.slice(i, i + chunkSize);
      for (let j = 0; j < chunk.length; j++) {
        results.push(await fn(chunk[j], i + j));
      }
      // 每块完成后让出事件循环
      if (i + chunkSize < items.length) {
        await this._yield();
      }
    }
    return results;
  }

  async run(initialContext = {}) {
    this._running = true;
    this._aborted = false;
    this.context = { ...initialContext, outDir: this.outDir };

    // 确保输出目录存在
    if (!fs.existsSync(this.outDir)) {
      fs.mkdirSync(this.outDir, { recursive: true });
    }

    this.emit('pipeline:start', { total: this.pipeline.stages.length });
    // 让 UI 有机会更新
    await this._yield();

    for (let i = 0; i < this.pipeline.stages.length; i++) {
      if (this._aborted) break;

      const stage = this.pipeline.stages[i];
      const agentId = stage.agentId || stage.agent;
      const agent = this.agents[agentId];

      if (!agent) {
        this.emit('stage:error', { stage: stage.name, error: `Agent ${agentId} 未注册` });
        if (stage.required !== false) {
          this._running = false;
          return false;
        }
        continue;
      }

      this._currentIndex = i;
      this.emit('stage:start', { name: stage.name, agentId, index: i });
      await this._yield();

      try {
        agent.onProgress((msg) => {
          this.emit('agent:progress', msg);
          // 进度更新时也让出
          setImmediate(() => {});
        });
        agent.onWaitingUser((msg) => {
          this._running = false; // 暂停等待用户
          this.emit('agent:waiting_user', msg);
        });

        const input = this._buildInput(stage);

        const output = await agent.execute(input);

        this.results[agentId] = output;
        this.context[`${agentId}_output`] = output;

        // 如果 Agent 输出包含 environment 信息，传播到 context.envConfig
        // 确保下游 Agent（如 Assembler）能获取到正确的环境配置
        if (output && output.environment) {
          // 优先用 Agent 识别到的环境信息，保留已有字段（如 globalHeaders）
          this.context.envConfig = { ...this.context.envConfig, ...output.environment };
        }

        this.emit('stage:complete', { name: stage.name, agentId, output });
        await this._yield();
      } catch (error) {
        this.results[agentId] = { error: error.message };
        this.emit('stage:error', { name: stage.name, agentId, error: error.message });

        if (stage.required !== false) {
          this._running = false;
          return false;
        }
        // 非 required 阶段失败则跳过
        this.context[`${agentId}_output`] = null;
      }
    }

    this._running = false;
    this.emit('pipeline:complete', { results: this.results });
    return true;
  }

  _buildInput(stage) {
    const input = {
      outDir: this.outDir,
      config: stage.config || {},
      envConfig: this.context.envConfig || {},
      // 扩展配置透传
      dataPoolConfig: this.context.dataPoolConfig || null,
      chainRules: this.context.chainRules || [],
      iterationMode: this.context.iterationMode || 'none',
    };

    // 优先从 context 读取上游输出
    if (stage.inputFrom && this.context[stage.inputFrom]) {
      const ctxData = this.context[stage.inputFrom];
      // Agent 返回 { records: [...], ... } 格式，下游期望 records 数组
      input.data = (ctxData && Array.isArray(ctxData.records)) ? ctxData.records : ctxData;
      return input;
    }

    // 回退：从文件读取
    if (stage.inputFile) {
      const fs = require('fs');
      const inputPath = path.resolve(this.outDir, stage.inputFile);
      if (fs.existsSync(inputPath)) {
        try {
          input.data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
        } catch (e) {
          log.error(`Failed to read ${inputPath}: ${e.message}`);
          input.data = [];
        }
      } else {
        log.warn(`Input file not found: ${inputPath}`);
        input.data = [];
      }
    }

    // 如果还没有数据，尝试用 context 中的 inputData
    if (!input.data && this.context.inputData) {
      input.data = this.context.inputData;
    }

    return input;
  }

  resume(userInput) {
    const currentStage = this.pipeline.stages[this._currentIndex];
    if (!currentStage) return;

    const agentId = currentStage.agentId || currentStage.agent;
    const agent = this.agents[agentId];
    if (agent && agent._status === 'waiting_user') {
      this._running = true;
      this._runAgentWithUserInput(currentStage, agent, userInput);
    }
  }

  async _runAgentWithUserInput(stage, agent, userInput) {
    this.emit('stage:resume', { name: stage.name, agentId: agent.id });
    try {
      const input = this._buildInput(stage);
      input.userInput = userInput;
      const output = await agent.execute(input);
      this.results[agent.id] = output;
      this.context[`${agent.id}_output`] = output;

      // 如果 Agent 输出包含 environment 信息，传播到 context.envConfig
      if (output && output.environment) {
        this.context.envConfig = { ...this.context.envConfig, ...output.environment };
      }

      this.emit('stage:complete', { name: stage.name, agentId: agent.id, output });
    } catch (error) {
      this.emit('stage:error', { name: stage.name, agentId: agent.id, error: error.message });
    }
  }

  abort() {
    this._aborted = true;
    this._running = false;
    this.emit('pipeline:abort');
  }

  getState() {
    return {
      running: this._running,
      currentIndex: this._currentIndex,
      total: this.pipeline.stages.length,
      stages: this.pipeline.stages.map((s, i) => ({
        name: s.name,
        agentId: s.agentId || s.agent,
        status: i < this._currentIndex ? 'completed'
              : i === this._currentIndex ? (this._running ? 'running' : 'pending')
              : 'pending',
        result: this.results[s.agentId || s.agent] || null,
      })),
    };
  }
}

module.exports = { Orchestrator };
