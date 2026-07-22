/**
 * TestDataPool.js - 测试数据池模型
 * 管理外部测试数据（CSV/TXT/手动输入），与接口用例解耦
 * 支持高级迭代控制：recycle/random/sharing
 */

class FieldDef {
  /**
   * @param {Object} opts
   * @param {string} opts.name - 字段名
   * @param {'string'|'number'|'json'|'boolean'} opts.type - 数据类型
   * @param {string[]} opts.alias - 别名（如中文名）
   * @param {*} opts.defaultValue - 默认值
   * @param {string} opts.description - 描述
   */
  constructor(opts = {}) {
    this.name = opts.name || '';
    this.type = opts.type || 'string';
    this.alias = opts.alias || [];
    this.defaultValue = opts.defaultValue !== undefined ? opts.defaultValue : '';
    this.description = opts.description || '';
  }

  toJSON() {
    return {
      name: this.name,
      type: this.type,
      alias: this.alias,
      defaultValue: this.defaultValue,
      description: this.description,
    };
  }
}

class DataRow {
  /**
   * @param {Object} opts
   * @param {Object} opts.values - { fieldName: value, ... }
   * @param {boolean} opts.enabled - 是否启用
   */
  constructor(opts = {}) {
    this.values = opts.values || {};
    this.enabled = opts.enabled !== undefined ? opts.enabled : true;
  }

  getValue(name) {
    return this.values[name];
  }

  setValue(name, value) {
    this.values[name] = value;
  }

  toJSON() {
    return {
      values: { ...this.values },
      enabled: this.enabled,
    };
  }
}

class TestDataPool {
  /**
   * @param {Object} opts
   * @param {string} opts.id
   * @param {string} opts.name - 数据池名称
   * @param {string} opts.description
   * @param {'csv'|'txt'|'paste'|'manual'} opts.source - 数据来源
   * @param {FieldDef[]} opts.fields - 字段定义
   * @param {DataRow[]} opts.rows - 数据行
   * @param {string[]} opts.tags - 标签
   * @param {Object} opts.control - 高级控制
   */
  constructor(opts = {}) {
    this.id = opts.id || `pool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.name = opts.name || '';
    this.description = opts.description || '';
    this.source = opts.source || 'manual';
    this.fields = (opts.fields || []).map(f => f instanceof FieldDef ? f : new FieldDef(f));
    this.rows = (opts.rows || []).map(r => r instanceof DataRow ? r : new DataRow(r));
    this.tags = opts.tags || [];
    this.createdAt = opts.createdAt || new Date().toISOString();
    this.updatedAt = opts.updatedAt || new Date().toISOString();
    // 高级控制
    this.control = {
      recycleOnEnd: opts.control?.recycleOnEnd ?? true, // 数据行超出时是否重新从头读取
      randomOrder: opts.control?.randomOrder ?? false,   // 是否随机取行
      sharingMode: opts.control?.sharingMode ?? 'all',   // 'all' | 'thread' | 'copy'
      ...(opts.control || {}),
    };
  }

  /**
   * 从 CSV 内容解析数据池
   * @param {string} csvContent - CSV 文本内容
   * @param {Object} opts - 配置 { name, tags, skipLines, delimiter }
   * @returns {TestDataPool}
   */
  static fromCSV(csvContent, opts = {}) {
    const lines = csvContent.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 1) return new TestDataPool({ name: opts.name || '空数据池', source: 'csv' });

    const delimiter = opts.delimiter || ',';
    const skipLines = opts.skipLines || 0;
    const dataLines = lines.slice(skipLines);

    // Parse header line - handle quoted fields
    const headerTokens = TestDataPool._parseCSVLine(dataLines[0], delimiter);
    const fields = headerTokens.map((h, i) => {
      const name = h.trim();
      const isChinese = /[\u4e00-\u9fa5]/.test(name);
      return new FieldDef({
        name: isChinese ? `field_${i}` : name,
        alias: isChinese ? [name] : [],
        description: isChinese ? name : '',
      });
    });

    // Parse data rows
    const rows = [];
    for (let i = 1; i < dataLines.length; i++) {
      if (!dataLines[i].trim()) continue;
      const tokens = TestDataPool._parseCSVLine(dataLines[i], delimiter);
      const values = {};
      for (let j = 0; j < fields.length; j++) {
        const rawValue = tokens[j] !== undefined ? tokens[j].trim() : fields[j].defaultValue;
        const field = fields[j];
        values[field.name] = TestDataPool._inferAndConvert(rawValue, field.type);
      }
      rows.push(new DataRow({ values }));
    }

    // Auto-detect field types from data
    for (let i = 0; i < fields.length; i++) {
      const sampleValues = rows.filter(r => r.values[fields[i].name] !== '').map(r => r.values[fields[i].name]);
      if (sampleValues.length > 0) {
        fields[i].type = TestDataPool._detectType(sampleValues);
      }
    }

    return new TestDataPool({
      name: opts.name || 'CSV 导入数据',
      source: 'csv',
      fields,
      rows,
      tags: opts.tags || ['csv'],
    });
  }

  /**
   * 从 TXT 内容解析数据池
   * 每行一条记录，用分隔符或正则分割字段
   */
  static fromTXT(txtContent, opts = {}) {
    const lines = txtContent.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 1) return new TestDataPool({ name: opts.name || '空数据池', source: 'txt' });

    const delimiter = opts.delimiter || /\s+/;
    const fieldNames = opts.fieldNames || [];
    const hasHeader = opts.hasHeader !== false;
    let startIdx = 0;

    let fields;
    if (hasHeader && fieldNames.length === 0) {
      const headerTokens = lines[0].trim().split(delimiter);
      fields = headerTokens.map((h, i) => {
        const name = h.trim();
        const isChinese = /[\u4e00-\u9fa5]/.test(name);
        return new FieldDef({
          name: isChinese ? `field_${i}` : (name || `field_${i}`),
          alias: isChinese ? [name] : [],
        });
      });
      startIdx = 1;
    } else if (fieldNames.length > 0) {
      fields = fieldNames.map((nm, i) => new FieldDef({ name: nm }));
    } else {
      // Auto-generate field names from first line token count
      const sampleTokens = lines[0].trim().split(delimiter);
      fields = sampleTokens.map((_, i) => new FieldDef({ name: `field_${i}` }));
    }

    const rows = [];
    for (let i = startIdx; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const tokens = lines[i].trim().split(delimiter);
      const values = {};
      for (let j = 0; j < fields.length; j++) {
        values[fields[j].name] = tokens[j] !== undefined ? tokens[j].trim() : fields[j].defaultValue;
      }
      rows.push(new DataRow({ values }));
    }

    return new TestDataPool({
      name: opts.name || 'TXT 导入数据',
      source: 'txt',
      fields,
      rows,
      tags: opts.tags || ['txt'],
    });
  }

  /**
   * 从批量粘贴内容解析（自动检测 CSV 或 TXT 格式）
   */
  static fromPaste(content, opts = {}) {
    const hasCommas = content.includes(',');
    const hasTabs = content.includes('\t');
    if (hasCommas || (content.match(/;/g) || []).length > 2) {
      return TestDataPool.fromCSV(content, { ...opts, delimiter: hasCommas ? ',' : ';' });
    }
    return TestDataPool.fromTXT(content, { ...opts, delimiter: hasTabs ? '\t' : /\s+/, hasHeader: true });
  }

  /**
   * 解析 CSV 单行（处理引号包裹和转义）
   */
  static _parseCSVLine(line, delimiter) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        tokens.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    tokens.push(current);
    return tokens;
  }

  /**
   * 推断并转换值类型
   */
  static _inferAndConvert(value, type) {
    if (value === '' || value === undefined || value === null) return value;
    switch (type) {
      case 'number': {
        const n = Number(value);
        return isNaN(n) ? value : n;
      }
      case 'boolean': {
        if (value.toLowerCase() === 'true' || value === '1') return true;
        if (value.toLowerCase() === 'false' || value === '0') return false;
        return value;
      }
      case 'json': {
        try { return JSON.parse(value); } catch { return value; }
      }
      default: return value;
    }
  }

  /**
   * 从样本数据检测字段类型
   */
  static _detectType(samples) {
    if (samples.length === 0) return 'string';
    const nonEmpty = samples.filter(s => s !== '' && s !== null && s !== undefined);
    if (nonEmpty.length === 0) return 'string';

    // Check boolean
    if (nonEmpty.every(s => ['true', 'false', '1', '0', true, false].includes(s))) return 'boolean';
    // Check number
    if (nonEmpty.every(s => !isNaN(Number(s)) && s !== '')) return 'number';
    // Check JSON
    if (nonEmpty.every(s => { try { JSON.parse(s); return true; } catch { return false; } })) return 'json';
    return 'string';
  }

  /**
   * 获取指定索引的数据行（支持 recycle/random）
   */
  getRow(index) {
    if (this.rows.length === 0) return null;
    const enabledRows = this.rows.filter(r => r.enabled);
    if (enabledRows.length === 0) return null;

    if (this.control.randomOrder) {
      return enabledRows[Math.floor(Math.random() * enabledRows.length)];
    }

    if (index >= enabledRows.length) {
      if (this.control.recycleOnEnd) {
        return enabledRows[index % enabledRows.length];
      }
      return null;
    }
    return enabledRows[index];
  }

  /**
   * 获取所有启用的行
   */
  getEnabledRows() {
    return this.rows.filter(r => r.enabled);
  }

  /**
   * 获取数据统计信息
   */
  getStats() {
    const enabled = this.rows.filter(r => r.enabled).length;
    return {
      totalRows: this.rows.length,
      enabledRows: enabled,
      disabledRows: this.rows.length - enabled,
      fieldCount: this.fields.length,
      fieldNames: this.fields.map(f => f.name),
      source: this.source,
    };
  }

  /**
   * 校验数据完整性
   */
  validate() {
    const errors = [];
    if (!this.name) errors.push('数据池名称不能为空');
    if (this.fields.length === 0) errors.push('至少定义一个字段');
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      for (const field of this.fields) {
        if (row.values[field.name] === undefined && field.defaultValue === undefined) {
          errors.push(`第 ${i + 1} 行缺少字段 "${field.name}"`);
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      source: this.source,
      fields: this.fields.map(f => f.toJSON()),
      rows: this.rows.map(r => r.toJSON()),
      tags: this.tags,
      control: { ...this.control },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = { TestDataPool, FieldDef, DataRow };
