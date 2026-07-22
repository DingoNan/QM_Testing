/**
 * cleaner.test.js - CleanerAgent 单元测试
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { CleanerAgent } = require('../agents/cleaner');

const MOCK_RECORDS = [
  { url: 'https://api.example.com/api/v1/auth/login', method: 'POST', time: '2026-07-20T10:00:01Z', status: 200, type: 'XHR', requestHeaders: { 'content-type': 'application/json' }, requestBody: { username: 'test' }, responseBody: { code: 0, data: { token: 'abc123' } } },
  { url: 'https://api.example.com/api/v1/user/profile', method: 'GET', time: '2026-07-20T10:00:02Z', status: 200, type: 'XHR', requestHeaders: { token: 'abc123' }, requestBody: null, responseBody: { code: 0, data: { id: 1 } } },
  { url: 'https://api.example.com/api/v1/orders/12345', method: 'GET', time: '2026-07-20T10:00:03Z', status: 200, type: 'XHR', requestHeaders: {}, requestBody: null, responseBody: { code: 0, data: { orderId: 8080 } } },
];

const NOISE_RECORDS = [
  { url: 'https://api.example.com/hm.gif', method: 'GET', time: '2026-07-20T10:00:00Z', status: 200, type: 'XHR' },
  { url: 'https://api.example.com/collect/data', method: 'POST', time: '2026-07-20T10:00:00Z', status: 200, type: 'XHR' },
  { url: 'https://api.example.com/heartbeat', method: 'GET', time: '2026-07-20T10:00:00Z', status: 200, type: 'XHR' },
  { url: 'https://api.example.com/actuator/health', method: 'GET', time: '2026-07-20T10:00:00Z', status: 200, type: 'XHR' },
];

describe('CleanerAgent', () => {
  let cleaner;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleaner-test-'));
    cleaner = new CleanerAgent({ outDir: tmpDir });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('应该过滤噪音记录（静态资源、监控请求等）', async () => {
    const allRecords = [...MOCK_RECORDS, ...NOISE_RECORDS];
    const result = await cleaner.execute({ data: allRecords });

    assert.equal(result.stats.totalOriginal, 7);
    assert.equal(result.stats.noiseFiltered, 4);
    assert.equal(result.stats.finalCount, 3);
    assert.equal(result.records.length, 3);
  });

  it('应该对 URL 进行归一化去重', async () => {
    const dupRecords = [
      ...MOCK_RECORDS,
      { url: 'https://api.example.com/api/v1/user/profile', method: 'GET', time: '2026-07-20T10:00:04Z', status: 200, type: 'XHR', requestHeaders: {}, requestBody: null, responseBody: {} },
    ];
    const result = await cleaner.execute({ data: dupRecords });

    assert.ok(result.stats.dedupMerged >= 1);
    assert.equal(result.records.length, 3);
  });

  it('应该按时间升序排列并重编号', async () => {
    const unsorted = [
      { url: 'https://api.example.com/c', method: 'GET', time: '2026-07-20T10:00:05Z', status: 200, type: 'XHR', requestHeaders: {}, requestBody: null, responseBody: {} },
      { url: 'https://api.example.com/a', method: 'GET', time: '2026-07-20T10:00:01Z', status: 200, type: 'XHR', requestHeaders: {}, requestBody: null, responseBody: {} },
      { url: 'https://api.example.com/b', method: 'GET', time: '2026-07-20T10:00:03Z', status: 200, type: 'XHR', requestHeaders: {}, requestBody: null, responseBody: {} },
    ];
    const result = await cleaner.execute({ data: unsorted });

    assert.equal(result.records[0].seq, 1);
    assert.equal(result.records[1].seq, 2);
    assert.equal(result.records[2].seq, 3);
    // 应按 time 排序
    assert.ok(result.records[0].time <= result.records[1].time);
    assert.ok(result.records[1].time <= result.records[2].time);
  });

  it('应该提取环境信息（域名、认证方式）', async () => {
    const result = await cleaner.execute({ data: MOCK_RECORDS });
    assert.ok(result.environment);
    assert.ok(result.environment.baseURL.includes('api.example.com'));
    assert.ok(result.environment.domains.length > 0);
  });

  it('应该处理空输入并抛出错误', async () => {
    await assert.rejects(
      () => cleaner.execute({ data: [] }),
      { message: /输入数据为空/ }
    );
  });

  it('应该检测 token 在响应体中的路径', async () => {
    const result = await cleaner.execute({ data: MOCK_RECORDS });
    assert.equal(result.environment.authType, 'token');
  });

  it('应该输出 cleaned.json 文件', async () => {
    await cleaner.execute({ data: MOCK_RECORDS });
    const cleanedPath = path.join(tmpDir, 'cleaned.json');
    assert.ok(fs.existsSync(cleanedPath));
    const data = JSON.parse(fs.readFileSync(cleanedPath, 'utf-8'));
    assert.ok(Array.isArray(data));
  });
});
