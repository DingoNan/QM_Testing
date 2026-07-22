/**
 * assembler.test.js - AssemblerAgent 单元测试
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { AssemblerAgent } = require('../agents/assembler');

describe('AssemblerAgent', () => {
  let assembler;
  let tmpDir;

  const MOCK_LINKED = [
    { seq: 1, method: 'GET', url: 'https://api.example.com/api/v1/user/list', path: '/api/v1/user/list', domain: 'https://api.example.com', requestHeaders: { token: 'abc' }, requestBody: null, responseBody: { code: 0, data: [] }, status: 200 },
    { seq: 2, method: 'POST', url: 'https://api.example.com/api/v1/user/create', path: '/api/v1/user/create', domain: 'https://api.example.com', requestHeaders: { 'content-type': 'application/json', 'x-csrf-token': 'csrf123' }, requestBody: { name: 'test' }, responseBody: { code: 0, data: { id: 1 } }, status: 200 },
  ];

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-test-'));
    assembler = new AssemblerAgent({ outDir: tmpDir });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('应该拼装完整 CaseVo', async () => {
    const result = await assembler.execute({
      data: MOCK_LINKED,
      config: { projectId: 2, environment: 1, name: '测试用例' },
      envConfig: { baseURL: 'https://api.example.com' },
    });

    assert.ok(result.caseVo);
    assert.equal(result.caseVo.name, '测试用例');
    assert.equal(result.caseVo.projectId, 2);
    assert.equal(result.caseVo.environment, 1);
    assert.equal(result.caseVo.apiCount, 2);
    assert.equal(result.stats.apiCount, 2);
  });

  it('每个 API 应有断言', async () => {
    const result = await assembler.execute({
      data: MOCK_LINKED,
      config: {},
      envConfig: {},
    });
    for (const api of result.caseVo.apiVos) {
      assert.ok(api.assertVos);
      assert.ok(api.assertVos.length > 0);
    }
  });

  it('请求头应为 JSON 字符串', async () => {
    const result = await assembler.execute({
      data: MOCK_LINKED,
      config: {},
      envConfig: {},
    });
    for (const api of result.caseVo.apiVos) {
      assert.equal(typeof api.requestHeaders, 'string');
      const headers = JSON.parse(api.requestHeaders);
      assert.ok(headers);
    }
  });

  it('应输出 case-save.json 文件', async () => {
    await assembler.execute({ data: MOCK_LINKED, config: {}, envConfig: {} });
    assert.ok(fs.existsSync(path.join(tmpDir, 'case-save.json')));
  });

  it('空数据应抛出错误', async () => {
    await assert.rejects(
      () => assembler.execute({ data: [] }),
      { message: /输入数据为空/ }
    );
  });
});
