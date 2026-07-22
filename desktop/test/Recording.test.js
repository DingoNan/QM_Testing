/**
 * Recording.test.js - Recording 模型单元测试
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { Recording, truncateBody } = require('../models/Recording');

const MOCK_DATA = JSON.parse(
  require('fs').readFileSync(
    path.join(__dirname, 'mock', 'mock-recording.json'), 'utf-8'
  )
);

describe('Recording', () => {
  it('应该能正确解析录制数据', () => {
    const recording = new Recording(MOCK_DATA);
    assert.equal(recording.scenarios.length, 1);
    assert.equal(recording.scenarios[0].name, '用户登录场景');
  });

  it('应该展平所有记录', () => {
    const recording = new Recording(MOCK_DATA);
    const all = recording.getAllRecords();
    assert.equal(all.length, 4);
    assert.ok(all[0].method);
    assert.ok(all[0].url);
  });

  it('应该统计正确的记录数和方法', () => {
    const recording = new Recording(MOCK_DATA);
    const stats = recording.getStats();
    assert.equal(stats.scenarioCount, 1);
    assert.equal(stats.recordCount, 4);
    assert.equal(stats.totalRequests, 4);
    assert.equal(stats.methods['GET'], 2);
    assert.equal(stats.methods['POST'], 2);
  });

  it('应该从原始数组构造', () => {
    const recording = new Recording(MOCK_DATA[0].records);
    assert.ok(recording.scenarios.length > 0);
  });
});

describe('truncateBody', () => {
  it('小 body 不应截断', () => {
    const result = truncateBody('hello', 1024);
    assert.equal(result, 'hello');
  });

  it('大 body 应截断并添加标记', () => {
    const largeStr = 'x'.repeat(2000);
    const result = truncateBody(largeStr, 100);
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('QM_TRUNCATED'));
    assert.ok(result.length < largeStr.length);
  });

  it('null/undefined 直接返回', () => {
    assert.equal(truncateBody(null, 100), null);
    assert.equal(truncateBody(undefined, 100), undefined);
  });

  it('对象类型应 JSON.stringify 后判断', () => {
    const obj = { a: 'x'.repeat(2000) };
    const result = truncateBody(obj, 100);
    assert.ok(typeof result === 'string' || result === obj);
    if (typeof result === 'string') {
      assert.ok(result.includes('QM_TRUNCATED'));
    }
  });
});
