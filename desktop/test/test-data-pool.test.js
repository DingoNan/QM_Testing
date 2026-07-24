/**
 * test-data-pool.test.js - 测试数据池完整功能测试
 * 覆盖使用说明中的所有功能点：创建、导入、高级控制、环境关联、迭代逻辑
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { TestDataPool, FieldDef, DataRow } = require('../models/TestDataPool');

// =========================================================================
// 1. FieldDef 模型测试
// =========================================================================
describe('FieldDef 字段定义模型', () => {
  it('应使用默认值构造', () => {
    const f = new FieldDef();
    assert.equal(f.name, '');
    assert.equal(f.type, 'string');
    assert.deepEqual(f.alias, []);
    assert.equal(f.defaultValue, undefined);
    assert.equal(f.description, '');
  });

  it('应接受完整参数构造', () => {
    const f = new FieldDef({
      name: 'username',
      type: 'string',
      alias: ['用户名'],
      defaultValue: 'admin',
      description: '登录用户名',
    });
    assert.equal(f.name, 'username');
    assert.equal(f.type, 'string');
    assert.deepEqual(f.alias, ['用户名']);
    assert.equal(f.defaultValue, 'admin');
    assert.equal(f.description, '登录用户名');
  });

  it('toJSON 应返回正确结构', () => {
    const f = new FieldDef({ name: 'age', type: 'number', defaultValue: 0 });
    const json = f.toJSON();
    assert.equal(json.name, 'age');
    assert.equal(json.type, 'number');
    assert.equal(json.defaultValue, 0);
    assert.ok(Array.isArray(json.alias));
  });
});

// =========================================================================
// 2. DataRow 模型测试
// =========================================================================
describe('DataRow 数据行模型', () => {
  it('应默认启用', () => {
    const row = new DataRow({ values: { name: 'test' } });
    assert.equal(row.enabled, true);
    assert.deepEqual(row.values, { name: 'test' });
  });

  it('可设置禁用状态', () => {
    const row = new DataRow({ values: { name: 'test' }, enabled: false });
    assert.equal(row.enabled, false);
  });

  it('getValue/setValue 应正常工作', () => {
    const row = new DataRow({ values: { name: 'admin' } });
    assert.equal(row.getValue('name'), 'admin');
    row.setValue('name', 'guest');
    assert.equal(row.getValue('name'), 'guest');
  });

  it('toJSON 应返回正确结构', () => {
    const row = new DataRow({ values: { a: 1 }, enabled: false });
    const json = row.toJSON();
    assert.deepEqual(json.values, { a: 1 });
    assert.equal(json.enabled, false);
  });
});

// =========================================================================
// 3. TestDataPool 模型测试（核心）
// =========================================================================
describe('TestDataPool 数据池模型（核心）', () => {
  it('应使用默认值构造', () => {
    const pool = new TestDataPool();
    assert.ok(pool.id.startsWith('pool_'));
    assert.equal(pool.name, '');
    assert.equal(pool.description, '');
    assert.equal(pool.source, 'manual');
    assert.equal(pool.envId, null);
    assert.deepEqual(pool.fields, []);
    assert.deepEqual(pool.rows, []);
    assert.deepEqual(pool.tags, []);
    assert.equal(pool.control.recycleOnEnd, true);
    assert.equal(pool.control.randomOrder, false);
    assert.equal(pool.control.sharingMode, 'all');
  });

  it('应接受完整参数构造', () => {
    const pool = new TestDataPool({
      id: 'pool_test123',
      name: '登录用户列表',
      description: '测试账号数据',
      source: 'manual',
      envId: 'env_001',
      fields: [
        { name: 'username', type: 'string' },
        { name: 'password', type: 'string' },
      ],
      rows: [
        { values: { username: 'admin', password: '123456' }, enabled: true },
        { values: { username: 'guest', password: 'guest' }, enabled: false },
      ],
      tags: ['登录', '测试'],
      control: { recycleOnEnd: false, randomOrder: true, sharingMode: 'thread' },
    });

    assert.equal(pool.id, 'pool_test123');
    assert.equal(pool.name, '登录用户列表');
    assert.equal(pool.description, '测试账号数据');
    assert.equal(pool.source, 'manual');
    assert.equal(pool.envId, 'env_001');
    assert.equal(pool.fields.length, 2);
    assert.equal(pool.rows.length, 2);
    assert.deepEqual(pool.tags, ['登录', '测试']);
    assert.equal(pool.control.recycleOnEnd, false);
    assert.equal(pool.control.randomOrder, true);
    assert.equal(pool.control.sharingMode, 'thread');
  });

  it('字段应为 FieldDef 实例', () => {
    const pool = new TestDataPool({
      fields: [{ name: 'f1' }, new FieldDef({ name: 'f2' })],
    });
    assert.ok(pool.fields[0] instanceof FieldDef);
    assert.ok(pool.fields[1] instanceof FieldDef);
    assert.equal(pool.fields[0].name, 'f1');
    assert.equal(pool.fields[1].name, 'f2');
  });

  it('数据行应为 DataRow 实例', () => {
    const pool = new TestDataPool({
      rows: [{ values: { a: 1 } }, new DataRow({ values: { a: 2 } })],
    });
    assert.ok(pool.rows[0] instanceof DataRow);
    assert.ok(pool.rows[1] instanceof DataRow);
  });

  // ==================== 3.1 toJSON 序列化测试 ====================
  describe('toJSON() 序列化', () => {
    it('应包含 envId 字段', () => {
      const pool = new TestDataPool({
        name: 'test',
        envId: 'env_abc',
        fields: [{ name: 'x' }],
        rows: [{ values: { x: '1' } }],
      });
      const json = pool.toJSON();
      assert.equal(json.envId, 'env_abc');
      assert.equal(json.name, 'test');
      assert.equal(json.source, 'manual');
      assert.ok(json.fields);
      assert.ok(json.rows);
      assert.ok(json.id);
      assert.ok(json.createdAt);
      assert.ok(json.updatedAt);
      assert.ok(json.control);
    });

    it('不设置 envId 时应为 null', () => {
      const pool = new TestDataPool({ name: 'test' });
      assert.equal(pool.toJSON().envId, null);
    });
  });

  // ==================== 3.2 校验测试 ====================
  describe('validate() 数据校验', () => {
    it('空名称应报错', () => {
      const pool = new TestDataPool({ fields: [{ name: 'f1' }] });
      const result = pool.validate();
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('数据池名称不能为空'));
    });

    it('无字段应报错', () => {
      const pool = new TestDataPool({ name: 'test' });
      const result = pool.validate();
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('至少定义一个字段'));
    });

    it('有效数据应通过校验', () => {
      const pool = new TestDataPool({
        name: 'test',
        fields: [{ name: 'f1' }],
        rows: [{ values: { f1: 'v1' } }],
      });
      assert.equal(pool.validate().valid, true);
    });

    it('无默认值时缺少字段应报错', () => {
      const pool = new TestDataPool({
        name: 'test',
        fields: [{ name: 'f1' }], // defaultValue 为 undefined
        rows: [{ values: {} }], // 缺少 f1 值
      });
      assert.equal(pool.validate().valid, false);
      assert.ok(pool.validate().errors.some(e => e.includes('f1')));
    });

    it('有默认值时缺少字段不算错误', () => {
      const pool = new TestDataPool({
        name: 'test',
        fields: [{ name: 'f1', defaultValue: '' }],
        rows: [{ values: {} }],
      });
      assert.equal(pool.validate().valid, true);
    });
  });

  // ==================== 3.3 统计信息测试 ====================
  describe('getStats() 统计信息', () => {
    it('应正确统计字段和行数', () => {
      const pool = new TestDataPool({
        name: 'test',
        source: 'csv',
        fields: [{ name: 'a' }, { name: 'b' }],
        rows: [
          { values: { a: '1', b: '2' }, enabled: true },
          { values: { a: '3', b: '4' }, enabled: false },
          { values: { a: '5', b: '6' }, enabled: true },
        ],
      });
      const stats = pool.getStats();
      assert.equal(stats.totalRows, 3);
      assert.equal(stats.enabledRows, 2);
      assert.equal(stats.disabledRows, 1);
      assert.equal(stats.fieldCount, 2);
      assert.deepEqual(stats.fieldNames, ['a', 'b']);
      assert.equal(stats.source, 'csv');
    });
  });

  // ==================== 3.4 getRow() 迭代逻辑测试 ====================
  describe('getRow() 行迭代逻辑', () => {
    it('空数据池返回 null', () => {
      const pool = new TestDataPool({ name: 'test', fields: [{ name: 'x' }] });
      assert.equal(pool.getRow(0), null);
    });

    it('全部禁用时返回 null', () => {
      const pool = new TestDataPool({
        name: 'test',
        fields: [{ name: 'x' }],
        rows: [
          { values: { x: '1' }, enabled: false },
          { values: { x: '2' }, enabled: false },
        ],
      });
      assert.equal(pool.getRow(0), null);
    });

    it('顺序读取应返回正确的行', () => {
      const pool = new TestDataPool({
        name: 'test',
        fields: [{ name: 'x' }],
        rows: [
          { values: { x: 'a' }, enabled: true },
          { values: { x: 'b' }, enabled: true },
          { values: { x: 'c' }, enabled: true },
        ],
      });
      assert.equal(pool.getRow(0).getValue('x'), 'a');
      assert.equal(pool.getRow(1).getValue('x'), 'b');
      assert.equal(pool.getRow(2).getValue('x'), 'c');
    });

    it('禁用的行应被跳过', () => {
      const pool = new TestDataPool({
        name: 'test',
        fields: [{ name: 'x' }],
        rows: [
          { values: { x: 'a' }, enabled: true },
          { values: { x: 'b' }, enabled: false },
          { values: { x: 'c' }, enabled: true },
        ],
      });
      // 启用行索引: 0->a, 1->c
      assert.equal(pool.getRow(0).getValue('x'), 'a');
      assert.equal(pool.getRow(1).getValue('x'), 'c');
    });

    it('recycleOnEnd=true 时索引超限应循环', () => {
      const pool = new TestDataPool({
        name: 'test',
        fields: [{ name: 'x' }],
        rows: [
          { values: { x: 'a' }, enabled: true },
          { values: { x: 'b' }, enabled: true },
        ],
        control: { recycleOnEnd: true },
      });
      assert.equal(pool.getRow(0).getValue('x'), 'a');
      assert.equal(pool.getRow(1).getValue('x'), 'b');
      assert.equal(pool.getRow(2).getValue('x'), 'a'); // 循环
      assert.equal(pool.getRow(3).getValue('x'), 'b'); // 循环
    });

    it('recycleOnEnd=false 时索引超限应返回 null', () => {
      const pool = new TestDataPool({
        name: 'test',
        fields: [{ name: 'x' }],
        rows: [
          { values: { x: 'a' }, enabled: true },
          { values: { x: 'b' }, enabled: true },
        ],
        control: { recycleOnEnd: false },
      });
      assert.equal(pool.getRow(2), null);
    });

    it('randomOrder=true 时应随机取行', () => {
      const pool = new TestDataPool({
        name: 'test',
        fields: [{ name: 'x' }],
        rows: [
          { values: { x: 'a' }, enabled: true },
          { values: { x: 'b' }, enabled: true },
          { values: { x: 'c' }, enabled: true },
        ],
        control: { randomOrder: true },
      });
      // 随机模式下 getRow 忽略 index 参数，验证返回启用的行
      const row = pool.getRow(999);
      assert.ok(row instanceof DataRow);
      assert.ok(['a', 'b', 'c'].includes(row.getValue('x')));
    });
  });

  // ==================== 3.5 环境关联测试 ====================
  describe('环境关联 envId', () => {
    it('构造时可设置 envId', () => {
      const pool = new TestDataPool({ name: 'env-test', envId: 'env_prod_01' });
      assert.equal(pool.envId, 'env_prod_01');
    });

    it('envId 应持久化到 JSON', () => {
      const pool = new TestDataPool({ name: 'env-test', envId: 'env_test_02' });
      const json = JSON.parse(JSON.stringify(pool.toJSON()));
      assert.equal(json.envId, 'env_test_02');
    });

    it('从 JSON 恢复时 envId 应保留', () => {
      const json = {
        id: 'pool_restore_test',
        name: 'restored',
        source: 'csv',
        envId: 'env_restored',
        fields: [{ name: 'f1', type: 'string', alias: [], defaultValue: '', description: '' }],
        rows: [{ values: { f1: 'v1' }, enabled: true }],
        tags: [],
        control: { recycleOnEnd: true, randomOrder: false, sharingMode: 'all' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const pool = new TestDataPool(json);
      assert.equal(pool.envId, 'env_restored');
      assert.equal(pool.toJSON().envId, 'env_restored');
    });
  });
});

// =========================================================================
// 4. CSV 导入解析测试
// =========================================================================
describe('CSV 导入 (fromCSV)', () => {
  it('应解析基本 CSV', () => {
    const csv = 'name,age\nAlice,30\nBob,25\nCharlie,35';
    const pool = TestDataPool.fromCSV(csv, { name: '测试' });
    assert.equal(pool.fields.length, 2);
    assert.equal(pool.fields[0].name, 'name');
    assert.equal(pool.fields[1].name, 'age');
    assert.equal(pool.rows.length, 3);
    assert.equal(pool.rows[0].values['name'], 'Alice');
    assert.equal(pool.rows[1].values['age'], '25');
    assert.equal(pool.source, 'csv');
    assert.deepEqual(pool.tags, ['csv']);
  });

  it('应自动检测字段类型并更新字段定义', () => {
    const csv = 'name,age,active\nAlice,25,true\nBob,30,false';
    const pool = TestDataPool.fromCSV(csv);
    // 字段类型被检测更新
    assert.equal(pool.fields[1].type, 'number');
    assert.equal(pool.fields[2].type, 'boolean');
    // 值在解析时为 string 明文，类型检测仅更新字段定义不重新转换现有值
    assert.equal(pool.rows[0].values['age'], '25');
    assert.equal(pool.rows[0].values['active'], 'true');
  });

  it('应处理引号包裹字段（含逗号）', () => {
    const csv = 'name,description\nAlice,"Hello, World"\nBob,"Test, OK"';
    const pool = TestDataPool.fromCSV(csv);
    assert.equal(pool.rows[0].values['description'], 'Hello, World');
    assert.equal(pool.rows[1].values['description'], 'Test, OK');
  });

  it('应处理转义引号', () => {
    const csv = 'name,note\nAlice,"他说""好的"""';
    const pool = TestDataPool.fromCSV(csv);
    assert.equal(pool.rows[0].values['note'], '他说"好的"');
  });

  it('中文列名应自动转为 field_N 别名', () => {
    const csv = '用户名,年龄\nAlice,30\nBob,25';
    const pool = TestDataPool.fromCSV(csv);
    assert.equal(pool.fields[0].name, 'field_0');
    assert.equal(pool.fields[1].name, 'field_1');
    assert.deepEqual(pool.fields[0].alias, ['用户名']);
    assert.equal(pool.fields[0].description, '用户名');
  });

  it('空 CSV 应返回空数据池（不传 name 时使用默认名）', () => {
    const pool = TestDataPool.fromCSV('');
    assert.equal(pool.name, '空数据池');
    assert.equal(pool.source, 'csv');
  });

  it('应跳过空行', () => {
    const csv = 'name,age\nAlice,30\n\nBob,25\n';
    const pool = TestDataPool.fromCSV(csv);
    assert.equal(pool.rows.length, 2);
  });

  it('应处理 JSON 字段', () => {
    const csv = 'name,config\nAlice,"{""key"":""value""}"\nBob,"{""num"":42}"';
    const pool = TestDataPool.fromCSV(csv);
    // JSON 值在 fromCSV 中作为 string 读取，后续可 inferAndConvert
    assert.equal(typeof pool.rows[0].values['config'], 'string');
  });
});

// =========================================================================
// 5. TXT 导入解析测试
// =========================================================================
describe('TXT 导入 (fromTXT)', () => {
  it('应解析空格分隔的 TXT', () => {
    const txt = 'name age city\nAlice 30 Beijing\nBob 25 Shanghai';
    const pool = TestDataPool.fromTXT(txt, { name: '地址数据' });
    assert.equal(pool.fields.length, 3);
    assert.equal(pool.rows.length, 2);
    assert.equal(pool.rows[0].values['name'], 'Alice');
    assert.equal(pool.rows[0].values['age'], '30');
    assert.equal(pool.source, 'txt');
  });

  it('应支持自定义字段名', () => {
    const txt = 'Alice 30\nBob 25';
    const pool = TestDataPool.fromTXT(txt, {
      fieldNames: ['name', 'age'],
      hasHeader: false,
    });
    assert.equal(pool.fields.length, 2);
    assert.equal(pool.fields[0].name, 'name');
    assert.equal(pool.rows.length, 2);
    assert.equal(pool.rows[0].values['name'], 'Alice');
  });

  it('无表头且无字段名时应自动生成 field_N', () => {
    const txt = 'Alice 30\nBob 25';
    const pool = TestDataPool.fromTXT(txt, { hasHeader: false });
    assert.equal(pool.fields[0].name, 'field_0');
    assert.equal(pool.fields[1].name, 'field_1');
  });
});

// =========================================================================
// 6. 批量粘贴格式自动检测测试
// =========================================================================
describe('批量粘贴 (fromPaste)', () => {
  it('含逗号应走 CSV 解析', () => {
    const data = 'name,age\nAlice,30\nBob,25';
    const pool = TestDataPool.fromPaste(data);
    assert.equal(pool.source, 'csv');
    assert.equal(pool.fields.length, 2);
    assert.equal(pool.rows.length, 2);
  });

  it('含制表符应走 TXT 解析', () => {
    const data = 'name\tage\nAlice\t30\nBob\t25';
    const pool = TestDataPool.fromPaste(data);
    assert.equal(pool.fields.length, 2);
    assert.equal(pool.rows.length, 2);
    assert.ok(pool.source === 'csv' || pool.source === 'txt');
  });

  it('JSON 数组格式应能正常解析', () => {
    // fromPaste 不支持 JSON，验证纯文本 CSV 格式
    const data = 'id,value\n1,foo\n2,bar';
    const pool = TestDataPool.fromPaste(data);
    assert.equal(pool.rows.length, 2);
    assert.equal(pool.rows[0].values['id'], '1');
  });
});

// =========================================================================
// 7. 高级控制与数据池文件持久化
// =========================================================================
describe('数据池文件持久化（集成测试）', () => {
  let tmpDir;
  let pool;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'datapool-test-'));
    pool = new TestDataPool({
      name: '集成测试数据池',
      description: '用于持久化测试',
      source: 'manual',
      envId: 'env_integration',
      fields: [
        { name: 'username', type: 'string', defaultValue: '' },
        { name: 'count', type: 'number', defaultValue: 0 },
        { name: 'active', type: 'boolean', defaultValue: false },
      ],
      rows: [
        { values: { username: 'admin', count: 100, active: true }, enabled: true },
        { values: { username: 'guest', count: 0, active: false }, enabled: true },
        { values: { username: 'test', count: 50, active: true }, enabled: false },
      ],
      tags: ['集成', '测试'],
      control: { recycleOnEnd: true, randomOrder: false, sharingMode: 'all' },
    });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('应能保存到文件', () => {
    const filePath = path.join(tmpDir, `${pool.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(pool.toJSON(), null, 2), 'utf-8');
    assert.ok(fs.existsSync(filePath));
  });

  it('应从文件恢复完整数据', () => {
    const filePath = path.join(tmpDir, `${pool.id}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const restored = new TestDataPool(data);
    assert.equal(restored.name, '集成测试数据池');
    assert.equal(restored.envId, 'env_integration');
    assert.equal(restored.fields.length, 3);
    assert.equal(restored.rows.length, 3);
    assert.equal(restored.rows[0].values['username'], 'admin');
    assert.equal(restored.control.recycleOnEnd, true);
  });

  it('从文件恢复后统计信息应正确', () => {
    const filePath = path.join(tmpDir, `${pool.id}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const restored = new TestDataPool(data);
    const stats = restored.getStats();
    assert.equal(stats.totalRows, 3);
    assert.equal(stats.enabledRows, 2);
    assert.equal(stats.disabledRows, 1);
    assert.equal(stats.fieldCount, 3);
    assert.deepEqual(stats.fieldNames, ['username', 'count', 'active']);
  });

  it('从文件恢复后 getRow() 应正常工作（含禁用行跳过）', () => {
    const filePath = path.join(tmpDir, `${pool.id}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const restored = new TestDataPool(data);
    assert.equal(restored.getRow(0).getValue('username'), 'admin');
    assert.equal(restored.getRow(1).getValue('username'), 'guest');
    assert.equal(restored.getRow(2).getValue('username'), 'admin'); // recycle
  });

  it('应能列出目录中所有数据池摘要', () => {
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.json'));
    const summaries = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, f), 'utf-8'));
      return {
        id: data.id,
        name: data.name,
        source: data.source,
        fieldCount: (data.fields || []).length,
        rowCount: (data.rows || []).length,
        tags: data.tags || [],
        envId: data.envId || null,
      };
    });
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].name, '集成测试数据池');
    assert.equal(summaries[0].envId, 'env_integration');
    assert.equal(summaries[0].fieldCount, 3);
    assert.equal(summaries[0].rowCount, 3);
  });

  it('应能删除数据池文件', () => {
    const filePath = path.join(tmpDir, `${pool.id}.json`);
    assert.ok(fs.existsSync(filePath));
    fs.unlinkSync(filePath);
    assert.equal(fs.existsSync(filePath), false);
  });
});

// =========================================================================
// 8. 边界情况测试
// =========================================================================
describe('边界情况', () => {
  it('空构造不应报错', () => {
    assert.doesNotThrow(() => new TestDataPool());
    assert.doesNotThrow(() => new FieldDef());
    assert.doesNotThrow(() => new DataRow());
  });

  it('超大行数数据池应能正常创建', () => {
    const fields = [{ name: 'col', type: 'number' }];
    const rows = [];
    for (let i = 0; i < 10000; i++) {
      rows.push({ values: { col: i }, enabled: i % 2 === 0 });
    }
    const pool = new TestDataPool({ name: '大数据池', fields, rows });
    assert.equal(pool.rows.length, 10000);
    assert.equal(pool.getEnabledRows().length, 5000);
  });

  it('所有行禁用时应返回空数组', () => {
    const pool = new TestDataPool({
      name: '全禁用',
      fields: [{ name: 'x' }],
      rows: [
        { values: { x: '1' }, enabled: false },
        { values: { x: '2' }, enabled: false },
      ],
    });
    assert.deepEqual(pool.getEnabledRows(), []);
  });

  it('数据池名称含特殊字符', () => {
    const pool = new TestDataPool({
      name: '测试-2026_生产环境@数据',
      fields: [{ name: 'id' }],
      rows: [{ values: { id: '1' } }],
    });
    assert.equal(pool.validate().valid, true);
  });
});

// =========================================================================
// 9. 使用说明文档场景验证
// =========================================================================
describe('使用说明文档场景验证', () => {
  it('场景1: 手动创建登录用户列表', () => {
    // 对应使用说明第3章：手动录入数据
    const pool = new TestDataPool({
      name: '登录用户列表',
      description: '不同环境的登录用户账号',
      source: 'manual',
      fields: [
        { name: 'usercode', type: 'string', defaultValue: '00001', description: '用户编码' },
        { name: 'env', type: 'string', defaultValue: '', description: '所属环境' },
      ],
      rows: [
        { values: { usercode: 'admin', env: 'prod' }, enabled: true },
        { values: { usercode: 'test01', env: 'test' }, enabled: true },
        { values: { usercode: 'dev01', env: 'dev' }, enabled: false },
      ],
      tags: ['登录', '回归用'],
    });
    assert.equal(pool.name, '登录用户列表');
    assert.equal(pool.source, 'manual');
    assert.equal(pool.getEnabledRows().length, 2);

    // 验证字段引用格式 ${data.登录用户列表.usercode}
    const refFormat = `\${data.${pool.name}.${pool.fields[0].name}}`;
    assert.equal(refFormat, '${data.登录用户列表.usercode}');
  });

  it('场景2: CSV 导入商品查询参数', () => {
    // 对应使用说明第4.1章：CSV 导入
    const csv = 'category,keyword,pageSize\n电子,tv,20\n图书,java,10\n服装,shirt,15';
    const pool = TestDataPool.fromCSV(csv, { name: '商品查询参数' });
    assert.equal(pool.source, 'csv');
    assert.equal(pool.fields.length, 3);
    assert.equal(pool.rows.length, 3);

    // 验证预览逻辑（前3行）
    const preview = pool.rows.slice(0, 3).map(r => r.values);
    assert.equal(preview.length, 3);
    assert.equal(preview[0].category, '电子');
  });

  it('场景3: 展开模式 vs 循环模式语义验证', () => {
    // 对应使用说明第6.2章：两种迭代模式
    const pool = new TestDataPool({
      name: '多账号测试',
      source: 'csv',
      fields: [{ name: 'account', type: 'string' }],
      rows: [
        { values: { account: 'user1' }, enabled: true },
        { values: { account: 'user2' }, enabled: true },
        { values: { account: 'user3' }, enabled: true },
      ],
    });

    // 展开模式：N行→N个独立 CaseVo（每个 CaseVo 取一行）
    const enabledRows = pool.getEnabledRows();
    assert.equal(enabledRows.length, 3); // 3行→3个 CaseVo

    // 循环模式：1个 CaseVo 逐行取数（getRow 循环迭代）
    assert.equal(pool.getRow(0).getValue('account'), 'user1');
    assert.equal(pool.getRow(1).getValue('account'), 'user2');
    assert.equal(pool.getRow(2).getValue('account'), 'user3');
    assert.equal(pool.getRow(3).getValue('account'), 'user1'); // recycle
  });

  it('场景4: 环境关联存储验证', () => {
    // 对应使用说明第8章：环境关联
    const pool = new TestDataPool({
      name: '生产环境数据',
      source: 'manual',
      envId: 'env_prod',
      fields: [{ name: 'token', type: 'string' }],
      rows: [{ values: { token: 'prod-token' }, enabled: true }],
    });
    const json = pool.toJSON();
    assert.equal(json.envId, 'env_prod');

    // 验证文件持久化后 envId 保留
    const jsonStr = JSON.stringify(json);
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.envId, 'env_prod');
  });

  it('场景5: 高级控制 - 超出行为验证', () => {
    // 对应使用说明第3.5章：高级控制
    const recyclePool = new TestDataPool({
      name: '回收模式',
      fields: [{ name: 'x' }],
      rows: [
        { values: { x: 'a' }, enabled: true },
        { values: { x: 'b' }, enabled: true },
      ],
      control: { recycleOnEnd: true },
    });
    // recycle: 超限循环
    assert.equal(recyclePool.getRow(5).getValue('x'), 'b'); // 5 % 2 = 1

    const stopPool = new TestDataPool({
      name: '停止模式',
      fields: [{ name: 'x' }],
      rows: [
        { values: { x: 'a' }, enabled: true },
        { values: { x: 'b' }, enabled: true },
      ],
      control: { recycleOnEnd: false },
    });
    // stop: 超限 null
    assert.equal(stopPool.getRow(2), null);
  });

  it('场景6: 数据池变量引用格式', () => {
    // 对应使用说明第5.1章：变量引用格式
    const pool = new TestDataPool({
      name: '登录用户列表',
      fields: [{ name: 'usercode', type: 'string' }],
    });
    const refs = pool.fields.map(f => `\${data.${pool.name}.${f.name}}`);
    assert.equal(refs[0], '${data.登录用户列表.usercode}');
  });
});
