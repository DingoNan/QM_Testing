/**
 * FunctionRegistry.js - 运行时函数注册表
 * 提供数据生成和运行时转换函数
 * 5 类函数: RANDOM / TIME / ENCODE / STRING / COND
 */

const crypto = require('crypto');

class FunctionRegistry {
  constructor() {
    this._functions = new Map();
    this._registerBuiltins();
  }

  /** 注册自定义函数 */
  register(name, fn, category = 'CUSTOM', description = '') {
    if (this._functions.has(name)) {
      throw new Error(`函数 "${name}" 已存在`);
    }
    this._functions.set(name, { fn, category, description });
  }

  /** 调用函数 */
  call(name, ...args) {
    const entry = this._functions.get(name);
    if (!entry) {
      throw new Error(`未知函数: "${name}"`);
    }
    return entry.fn(...args);
  }

  /** 检查函数是否存在 */
  hasFunction(name) {
    return this._functions.has(name);
  }

  /** 获取函数帮助信息 */
  getHelp(name) {
    const entry = this._functions.get(name);
    if (!entry) return null;
    return { name, category: entry.category, description: entry.description };
  }

  /** 按分类列出函数 */
  listFunctions(category) {
    const all = [];
    for (const [name, entry] of this._functions) {
      if (!category || entry.category === category) {
        all.push({ name, category: entry.category, description: entry.description });
      }
    }
    return all;
  }

  /**
   * 解析并执行字符串中的函数调用
   * 格式: $sys.funcName 或 $sys.funcName(arg1, arg2)
   * 支持嵌套: $sys.concat($data.prefix, "_", $sys.uuid)
   */
  resolveFunctionCall(expr, resolveVar) {
    // expr: "funcName" or "funcName(arg1, arg2)" or "concat(a, b)"
    const match = expr.match(/^(\w+)\((.+)\)$/s);
    if (!match) {
      // plain function name without args
      const name = expr.trim();
      if (this.hasFunction(name)) return String(this.call(name));
      return null; // not a function
    }

    const funcName = match[1];
    const argsStr = match[2];

    if (!this.hasFunction(funcName)) return null;

    // Parse arguments, supporting nested calls
    const args = this._parseArgs(argsStr, resolveVar);
    return String(this.call(funcName, ...args));
  }

  /**
   * 解析函数参数列表，支持嵌套函数和变量引用
   */
  _parseArgs(argsStr, resolveVar) {
    const args = [];
    let depth = 0;
    let current = '';
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < argsStr.length; i++) {
      const ch = argsStr[i];

      if (inString) {
        current += ch;
        if (ch === stringChar) inString = false;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        current += ch;
        continue;
      }

      if (ch === '(') { depth++; current += ch; continue; }
      if (ch === ')') { depth--; current += ch; continue; }

      if (ch === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) args.push(current.trim());

    // Resolve each arg: if it's a $sys.func() call, recurse
    return args.map(arg => {
      // Variable reference like $data.xxx
      if (resolveVar && arg.startsWith('$')) {
        return resolveVar(arg);
      }
      // Remove string quotes
      if ((arg.startsWith('"') && arg.endsWith('"')) ||
          (arg.startsWith("'") && arg.endsWith("'"))) {
        return arg.slice(1, -1);
      }
      return arg;
    });
  }

  /** 注册所有内置函数 */
  _registerBuiltins() {
    // ======== RANDOM - 随机生成类 ========

    this.register('phone', (prefix = '1') => {
      const digits = prefix + Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
      return digits.slice(0, 11).padEnd(11, '0');
    }, 'RANDOM', '生成手机号: $sys.phone(138)');

    this.register('email', () => {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const name = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const domains = ['qq.com', '163.com', 'gmail.com', 'outlook.com', 'company.cn'];
      return `${name}@${domains[Math.floor(Math.random() * domains.length)]}`;
    }, 'RANDOM', '生成随机邮箱');

    this.register('idCard', () => {
      const prefix = ['110101', '310101', '440101', '440301'][Math.floor(Math.random() * 4)];
      const birth = `${1949 + Math.floor(Math.random() * 60)}${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`;
      const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
      const base = prefix + birth + seq;
      const checksum = String([7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
        .reduce((s, w, i) => s + parseInt(base[i]) * w, 0) % 11);
      return base + '10X98765432'[parseInt(checksum)];
    }, 'RANDOM', '生成随机身份证号');

    this.register('randStr', (length = 8, charset = 'alpha') => {
      const sets = {
        alpha: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
        numeric: '0123456789',
        alphanum: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        hex: '0123456789abcdef',
        chinese: '的一了是我不在人们有来他这上着个地到子说去你会小生下就那和大要看天时过学国把如好自都能',
      };
      const pool = sets[charset] || sets.alpha;
      return Array.from({ length: parseInt(length) }, () => pool[Math.floor(Math.random() * pool.length)]).join('');
    }, 'RANDOM', '生成随机字符串: $sys.randStr(8, alphanum)');

    this.register('randNum', (min = 0, max = 9999) => {
      return String(Math.floor(Math.random() * (parseInt(max) - parseInt(min) + 1)) + parseInt(min));
    }, 'RANDOM', '生成随机数字: $sys.randNum(100, 999)');

    this.register('uuid', () => {
      return crypto.randomUUID();
    }, 'RANDOM', '生成 UUID v4');

    // ======== TIME - 时间日期类 ========

    this.register('timestamp', () => String(Date.now()), 'TIME', '当前时间戳(毫秒)');

    this.register('date', (offset = 0, format = 'YYYY-MM-DD') => {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(offset));
      return FunctionRegistry._formatDate(d, format);
    }, 'TIME', '生成日期: $sys.date(0, YYYY-MM-DD)');

    this.register('time', (offset = 0, format = 'HH:mm:ss') => {
      const d = new Date();
      d.setSeconds(d.getSeconds() + parseInt(offset));
      return FunctionRegistry._formatDate(d, format);
    }, 'TIME', '生成时间: $sys.time(0, HH:mm:ss)');

    this.register('now', (format = 'YYYY-MM-DD HH:mm:ss') => {
      return FunctionRegistry._formatDate(new Date(), format);
    }, 'TIME', '当前时间: $sys.now(YYYY-MM-DD HH:mm:ss)');

    this.register('nowPlus', (amount, unit = 'd', format = 'YYYY-MM-DD HH:mm:ss') => {
      const d = new Date();
      const map = { d: 'Date', h: 'Hours', m: 'Minutes', s: 'Seconds', M: 'Month', y: 'FullYear' };
      const method = map[unit] || 'Date';
      d[`set${method}`](d[`get${method}`]() + parseInt(amount));
      return FunctionRegistry._formatDate(d, format);
    }, 'TIME', '相对时间: $sys.nowPlus(7, d, YYYY-MM-DD)');

    // ======== ENCODE - 编码哈希类 ========

    this.register('base64', (str) => {
      return Buffer.from(String(str)).toString('base64');
    }, 'ENCODE', 'Base64 编码');

    this.register('md5', (str) => {
      return crypto.createHash('md5').update(String(str)).digest('hex');
    }, 'ENCODE', 'MD5 哈希');

    this.register('sha256', (str) => {
      return crypto.createHash('sha256').update(String(str)).digest('hex');
    }, 'ENCODE', 'SHA256 哈希');

    // ======== STRING - 字符串处理 ========

    this.register('substring', (str, start, end) => {
      return String(str).substring(parseInt(start), end !== undefined ? parseInt(end) : undefined);
    }, 'STRING', '截取字符串: $sys.substring(str, 0, 5)');

    this.register('concat', (...args) => args.join(''), 'STRING', '拼接字符串: $sys.concat(a, b, c)');

    this.register('replace', (str, search, replacement) => {
      return String(str).replace(new RegExp(search, 'g'), replacement);
    }, 'STRING', '替换字符串: $sys.replace(str, old, new)');

    this.register('upper', (str) => String(str).toUpperCase(), 'STRING', '转大写');
    this.register('lower', (str) => String(str).toLowerCase(), 'STRING', '转小写');
    this.register('trim', (str) => String(str).trim(), 'STRING', '去除首尾空格');
    this.register('length', (str) => String(String(str).length), 'STRING', '字符串长度');

    // ======== COND - 条件逻辑 ========

    this.register('ternary', (condition, trueVal, falseVal) => {
      return condition === 'true' || condition === true || condition === '1' ? trueVal : falseVal;
    }, 'COND', '三元运算: $sys.ternary(cond, t, f)');

    this.register('default', (value, defaultVal) => {
      return (value === '' || value === undefined || value === null) ? defaultVal : value;
    }, 'COND', '默认值: $sys.default(val, default)');

    this.register('ifEmpty', (value, defaultValue) => {
      return (value === '' || value === undefined || value === null) ? defaultValue : value;
    }, 'COND', '为空则取默认值');
  }

  static _formatDate(d, format) {
    const map = {
      'YYYY': d.getFullYear(),
      'YY': String(d.getFullYear()).slice(2),
      'MM': String(d.getMonth() + 1).padStart(2, '0'),
      'DD': String(d.getDate()).padStart(2, '0'),
      'HH': String(d.getHours()).padStart(2, '0'),
      'mm': String(d.getMinutes()).padStart(2, '0'),
      'ss': String(d.getSeconds()).padStart(2, '0'),
      'SSS': String(d.getMilliseconds()).padStart(3, '0'),
    };
    let result = format;
    for (const [key, val] of Object.entries(map)) {
      result = result.replace(key, val);
    }
    return result;
  }
}

module.exports = { FunctionRegistry };
