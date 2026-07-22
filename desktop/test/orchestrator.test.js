/**
 * orchestrator.test.js - Orchestrator 单元测试
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { Orchestrator } = require('../agents/orchestrator');
const { BaseAgent } = require('../agents/base-agent');

class MockAgent extends BaseAgent {
  constructor(id, opts = {}) {
    super({ id, name: id, description: `Mock ${id}`, ...opts });
    this.shouldFail = opts.shouldFail || false;
    this.shouldWait = opts.shouldWait || false;
  }

  async execute(input) {
    this._updateProgress(50, '正在处理...');
    if (this.shouldFail) throw new Error('模拟失败');
    if (this.shouldWait) {
      this._waitForUser({ message: '需要用户确认' });
      return null;
    }
    return { result: `${this.id}_done`, inputData: input.data };
  }
}

describe('Orchestrator', () => {
  let orch;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
    const pipeline = {
      stages: [
        { name: '清洗', agentId: 'cleaner', config: {} },
        { name: '关联', agentId: 'linker', config: {}, required: true },
        { name: '拼装', agentId: 'assembler', config: {}, required: false },
      ],
    };
    orch = new Orchestrator({ outDir: tmpDir, pipeline });
    orch.registerAgent(new MockAgent('cleaner'));
    orch.registerAgent(new MockAgent('linker'));
    orch.registerAgent(new MockAgent('assembler'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('应该顺序执行全部阶段并返回 true', async () => {
    const result = await orch.run({ inputData: [1, 2, 3] });
    assert.equal(result, true);
  });

  it('执行完成后所有阶段应有输出', () => {
    assert.ok(orch.results.cleaner);
    assert.ok(orch.results.linker);
    assert.ok(orch.results.assembler);
  });

  it('应该触发 pipeline:complete 事件', async () => {
    const events = [];
    orch.on('pipeline:complete', (data) => events.push(data));
    await orch.run({ inputData: ['a'] });
    assert.equal(events.length, 1);
    assert.ok(events[0].results);
  });
});

describe('Orchestrator - processInChunks', () => {
  it('应该分块处理数组', async () => {
    const orch = new Orchestrator({ outDir: os.tmpdir(), pipeline: { stages: [] } });
    const items = Array.from({ length: 120 }, (_, i) => i);
    const results = await orch.processInChunks(items, (n) => n * 2, 50);

    assert.equal(results.length, 120);
    assert.equal(results[0], 0);
    assert.equal(results[50], 100);
    assert.equal(results[119], 238);
  });

  it('空数组应返回空结果', async () => {
    const orch = new Orchestrator({ outDir: os.tmpdir(), pipeline: { stages: [] } });
    const results = await orch.processInChunks([], (n) => n, 10);
    assert.equal(results.length, 0);
  });

  it('aborted 时应提前停止', async () => {
    const orch = new Orchestrator({ outDir: os.tmpdir(), pipeline: { stages: [] } });
    orch._aborted = true;
    const items = [1, 2, 3];
    const results = await orch.processInChunks(items, (n) => n, 1);
    assert.equal(results.length, 0);
  });
});

describe('Orchestrator - 错误处理', () => {
  it('required 阶段失败应终止流水线', async () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-err-'));
    const pipeline = {
      stages: [
        { name: '坏阶段', agentId: 'bad', required: true },
      ],
    };
    const orch = new Orchestrator({ outDir: tmpDir2, pipeline });
    orch.registerAgent(new MockAgent('bad', { shouldFail: true }));

    const result = await orch.run({});
    assert.equal(result, false);
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });

  it('非 required 阶段失败应跳过', async () => {
    const tmpDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-skip-'));
    const pipeline = {
      stages: [
        { name: '可选阶段', agentId: 'optional', required: false },
        { name: '后续阶段', agentId: 'next', required: true },
      ],
    };
    const orch = new Orchestrator({ outDir: tmpDir3, pipeline });
    orch.registerAgent(new MockAgent('optional', { shouldFail: true }));
    orch.registerAgent(new MockAgent('next'));

    const result = await orch.run({});
    assert.equal(result, true);
    fs.rmSync(tmpDir3, { recursive: true, force: true });
  });
});

describe('Orchestrator - _buildInput', () => {
  it('应该从 context.inputData 回退读取', () => {
    const orch = new Orchestrator({ outDir: os.tmpdir(), pipeline: { stages: [] } });
    orch.context.inputData = ['from_context'];
    const input = orch._buildInput({});
    assert.deepEqual(input.data, ['from_context']);
  });
});
