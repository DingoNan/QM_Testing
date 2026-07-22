/**
 * linker.test.js - LinkerAgent 单元测试
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { LinkerAgent } = require('../agents/linker');

describe('LinkerAgent', () => {
  let linker;
  let tmpDir;

  const LOGIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ';

  const MOCK_LINKED = [
    { seq: 1, method: 'POST', url: 'https://api.example.com/api/v1/auth/login', domain: 'https://api.example.com', path: '/api/v1/auth/login', requestHeaders: {}, requestBody: { username: 'test' }, responseBody: { code: 0, data: { token: LOGIN_TOKEN, userId: 10086 } } },
    { seq: 2, method: 'GET', url: 'https://api.example.com/api/v1/user/profile', domain: 'https://api.example.com', path: '/api/v1/user/profile', requestHeaders: { token: LOGIN_TOKEN, 'content-type': 'application/json' }, requestBody: null, responseBody: { code: 0, data: { userId: 10086, nickname: 'test' } } },
    { seq: 3, method: 'GET', url: 'https://api.example.com/api/v1/orders/10086', domain: 'https://api.example.com', path: '/api/v1/orders/10086', requestHeaders: { token: LOGIN_TOKEN }, requestBody: null, responseBody: { code: 0, data: { orderId: 8080, amount: 299.99 } } },
    { seq: 4, method: 'POST', url: 'https://api.example.com/api/v1/orders/8080/pay', domain: 'https://api.example.com', path: '/api/v1/orders/8080/pay', requestHeaders: { token: LOGIN_TOKEN }, requestBody: { orderId: 8080, amount: 299.99 }, responseBody: { code: 0, data: { transactionId: 'TXN123456', payStatus: 'success' } } },
  ];

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linker-test-'));
    linker = new LinkerAgent({ outDir: tmpDir });
  });

  it('应该构建响应值索引', () => {
    const index = linker._buildResponseIndex(MOCK_LINKED);
    assert.ok(index.exact);
    assert.ok(index.subStr);

    // 应该有 token 精确索引
    const tokenKey = `string::${LOGIN_TOKEN}`;
    assert.ok(index.exact[tokenKey], '应有 token 精确索引');
  });

  it('索引中的 token 应该有 auth 标记', () => {
    const index = linker._buildResponseIndex(MOCK_LINKED);
    const authKey = `__auth__::${LOGIN_TOKEN}`;
    assert.ok(index.exact[authKey], '应有 auth 索引');
  });

  it('应该正确查找上游值', () => {
    const index = linker._buildResponseIndex(MOCK_LINKED);
    // 在 seq=3 中查找 userId: 10086，应该找到 seq=1 的
    const found = linker._lookupValue(index, 10086, 3);
    assert.ok(found);
    assert.ok(found.seq < 3);
  });

  it('不应该找到自己的值 (seq 相同)', () => {
    const index = linker._buildResponseIndex(MOCK_LINKED);
    // 在 seq=1 中查找应该找不到自己提供的值
    const found = linker._lookupValue(index, 'test', 1);
    // "test" 在 _isMeaningfulValue 中被过滤掉，所以应该为 null
    assert.equal(found, null);
  });

  it('应该替换 URL 路径中的数字 ID', () => {
    const records = MOCK_LINKED.slice(0, 3); // seq 1-3
    const index = linker._buildResponseIndex(records);
    const result = linker._replaceInUrlPath(
      'https://api.example.com/api/v1/orders/10086',
      index, 3, 'https://api.example.com'
    );
    // URL 中的 10086 对应 seq=1 的 userId 值，应该被替换
    // 注意：10086 < 100，_isMeaningfulValue 中 number 值小于 100 被过滤
    // 但 10086 >= 100，所以有意义
    assert.ok(result.deps.length > 0 || result.url.includes('$'));
  });

  it('应该替换请求体中的字段引用', () => {
    const records = MOCK_LINKED.slice(0, 3);
    const index = linker._buildResponseIndex(records);
    const body = { orderId: 8080, amount: 299.99 };
    const result = linker._walkAndReplace(body, index, 4);

    // 8080 在 seq=3 中出现，所以在 seq=4 中应该找到引用
    assert.ok(result);
    // 至少 orderId 或 amount 之一应被替换
    const hasReplacements = result.deps.length > 0;
    assert.ok(hasReplacements);
  });

  it('应该替换鉴权相关请求头', () => {
    const records = MOCK_LINKED.slice(0, 2);
    const index = linker._buildResponseIndex(records);
    const headers = { token: LOGIN_TOKEN, 'content-type': 'application/json' };
    const result = linker._replaceHeaders(headers, index, 2);

    // token 应该被替换为引用
    assert.ok(result.headers.token.includes('$'));
  });

  it('应该检测鉴权来源', () => {
    const sources = linker._findAuthSources(MOCK_LINKED);
    // seq=1 的 response 中 data.token 是鉴权值
    assert.ok(Object.keys(sources).length > 0);
  });

  it('完整流程应该生成依赖图', async () => {
    const result = await linker.execute({ data: MOCK_LINKED });
    assert.ok(result.records);
    assert.ok(result.deps);
    assert.ok(result.depsGraph);
    assert.ok(result.stats);
    assert.ok(result.records.length > 0);
  });
});
