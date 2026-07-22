/**
 * casevo.test.js - CaseVo 模型单元测试
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { CaseVo } = require('../models/CaseVo');

describe('CaseVo', () => {
  it('应该从 linked 记录构建完整的 CaseVo', () => {
    const records = [
      { seq: 1, method: 'GET', url: 'https://api.example.com/api/v1/user/list', path: '/api/v1/user/list', domain: 'https://api.example.com', requestHeaders: { token: 'abc123' }, requestBody: null, responseBody: {} },
      { seq: 2, method: 'POST', url: 'https://api.example.com/api/v1/user/create', path: '/api/v1/user/create', domain: 'https://api.example.com', requestHeaders: { 'content-type': 'application/json' }, requestBody: { name: 'test' }, responseBody: {} },
    ];

    const caseVo = CaseVo.fromLinkedRecords(records, {
      name: '测试用例',
      projectId: 1,
      environment: 1,
      domainName: 'https://api.example.com',
    });

    assert.equal(caseVo.name, '测试用例');
    assert.equal(caseVo.projectId, 1);
    assert.equal(caseVo.environment, 1);
    assert.equal(caseVo.apiCount, 2);
    assert.equal(caseVo.apiVos.length, 2);
  });

  it('CaseVo 中的 api 应有默认断言', () => {
    const records = [
      { seq: 1, method: 'GET', url: 'https://api.example.com/api/test', path: '/api/test', domain: 'https://api.example.com', requestHeaders: {}, requestBody: null, responseBody: {} },
    ];
    const caseVo = CaseVo.fromLinkedRecords(records, { projectId: 1 });
    assert.ok(caseVo.apiVos[0].assertVos);
    assert.ok(caseVo.apiVos[0].assertVos.length > 0);
  });

  it('请求头白名单应正确过滤', () => {
    const records = [
      { seq: 1, method: 'GET', url: 'https://example.com/api/test', path: '/api/test', domain: 'https://example.com', requestHeaders: { token: 'abc', authorization: 'Bearer def', 'x-requested-with': 'XMLHttpRequest', 'x-custom-header': 'secret' }, requestBody: null, responseBody: {} },
    ];
    const caseVo = CaseVo.fromLinkedRecords(records, { projectId: 1 });
    const headersStr = caseVo.apiVos[0].requestHeaders;
    const headers = JSON.parse(headersStr);
    assert.ok(headers.token);
    assert.ok(headers.authorization);
    assert.ok(headers['x-requested-with']);
    assert.equal(headers['x-custom-header'], undefined);
  });

  it('toJSON 应返回正确结构的对象', () => {
    const caseVo = new CaseVo({ name: 'test', projectId: 1, environment: 2, domainName: 'https://example.com' });
    const json = caseVo.toJSON();
    assert.equal(json.name, 'test');
    assert.equal(json.projectId, 1);
    assert.equal(json.environment, 2);
    assert.equal(json.domainName, 'https://example.com');
    assert.equal(json.type, 1);
  });
});
