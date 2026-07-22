/**
 * env-analyzer.test.js - EnvAnalyzerAgent 单元测试
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { EnvAnalyzerAgent } = require('../agents/env-analyzer');

describe('EnvAnalyzerAgent', () => {
  let analyzer;
  let tmpDir;

  const MOCK_CLEANED = [
    { seq: 1, method: 'POST', url: 'https://api.example.com/api/v1/auth/login', domain: 'https://api.example.com', path: '/api/v1/auth/login', requestHeaders: { 'content-type': 'application/json' }, requestBody: { username: 'test' }, responseBody: { code: 0, data: { token: 'abc123' } }, env_host: '' },
    { seq: 2, method: 'GET', url: 'https://api.example.com/api/v1/user/profile', domain: 'https://api.example.com', path: '/api/v1/user/profile', requestHeaders: { token: 'abc123' }, requestBody: null, responseBody: { code: 0, data: { userId: 1 } }, env_host: '' },
  ];

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
    analyzer = new EnvAnalyzerAgent({ outDir: tmpDir });
  });

  it('应该自动提取环境信息', async () => {
    const result = await analyzer.execute({ data: MOCK_CLEANED });
    assert.ok(result.environment);
    assert.equal(result.environment.baseURL, 'https://api.example.com');
    assert.equal(result.environment.authType, 'token');
  });

  it('应该在每条记录附加 env_host 字段', async () => {
    const result = await analyzer.execute({ data: MOCK_CLEANED });
    for (const r of result.records) {
      assert.ok(r.env_host);
      assert.equal(r.env_host, 'https://api.example.com');
    }
  });

  it('应该输出 env-config.json', async () => {
    await analyzer.execute({ data: MOCK_CLEANED });
    assert.ok(fs.existsSync(path.join(tmpDir, 'env-config.json')));
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'env-config.json'), 'utf-8'));
    assert.ok(content.baseURL);
    assert.ok(content.authType);
  });

  it('空数据应抛出错误', async () => {
    await assert.rejects(
      () => analyzer.execute({ data: [] }),
      { message: /输入数据为空/ }
    );
  });
});
