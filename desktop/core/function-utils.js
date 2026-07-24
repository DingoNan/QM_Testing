/**
 * function-utils.js - 平台函数库
 *
 * 实现 PW-Recorder_api 的平台函数（${Tel} / ${IC} / ${RandomUUID} 等），
 * 集成到 VarResolver 中解析，支持嵌套 seq 引用和函数组合。
 *
 * 函数清单:
 *   ${Tel}                         - 随机手机号
 *   ${IC}                          - 随机身份证号
 *   ${RandomUUID}                  - UUID v4
 *   ${Random} / ${Random(N)}       - 随机数（N位数字）
 *   ${Time} / ${Time(,Nd)}         - 毫秒时间戳（+N天偏移）
 *   ${DateTime} / ${DateTime(fmt,Nd)} - 格式化时间（yyyy-MM-dd HH:mm:ss）
 *   ${MD5Encode(s)}                - MD5 哈希
 *   ${MD5Encode(s,Upper)}          - MD5 大写
 *   ${MD5Encode(s,N)}              - MD5 取前N位
 *   ${Calculate[expr]}             - 四则运算（支持嵌套 ${seq.xxx}）
 *   ${Param(id)}                   - 全局参数引用
 *   ${Sign} / ${LoginSign} / ...   - 签名占位（标记 UNSUPPORTED）
 */

const crypto = require('crypto');

// ===================== 手机号 =====================
function genTel() {
  const prefixes = [
    '130','131','132','133','134','135','136','137','138','139',
    '150','151','152','153','155','156','157','158','159',
    '170','171','173','175','176','177','178',
    '180','181','182','183','184','185','186','187','188','189',
    '198','199'
  ];
  const p = prefixes[Math.floor(Math.random() * prefixes.length)];
  const tail = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return p + '****' + tail;
}

// ===================== 身份证 =====================
function genIC() {
  const area = ['110101','310101','440101','440301'][Math.floor(Math.random() * 4)];
  const year = 1949 + Math.floor(Math.random() * 60);
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  const base = area + year + month + day + seq;
  const weights = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
  const sum = weights.reduce((s, w, i) => s + parseInt(base[i]) * w, 0);
  const check = '10X98765432'[sum % 11];
  return base + check;
}

// ===================== UUID =====================
function genRandomUUID() {
  return crypto.randomUUID();
}

// ===================== 随机数 =====================
function genRandom(n) {
  if (n === undefined || n === null || n === '') {
    return String(Math.floor(Math.random() * 100000));
  }
  const digits = parseInt(n, 10);
  if (isNaN(digits) || digits < 1) return String(Math.floor(Math.random() * 100000));
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

// ===================== 时间戳 =====================
/**
 * @param {string} nd - 天数偏移，如 "1" 或 "-1"
 */
function genTime(nd) {
  const d = new Date();
  if (nd !== undefined && nd !== null && nd !== '') {
    d.setDate(d.getDate() + parseInt(nd, 10));
  }
  return String(d.getTime());
}

// ===================== 格式化时间 =====================
/**
 * @param {string} format - 格式模板，如 "yyyy-MM-dd HH:mm:ss"
 * @param {string} nd - 天数偏移
 */
function genDateTime(format, nd) {
  const d = new Date();
  if (nd !== undefined && nd !== null && nd !== '') {
    d.setDate(d.getDate() + parseInt(nd, 10));
  }
  if (!format || format === '') format = 'yyyy-MM-dd HH:mm:ss';
  return _formatDate(d, format);
}

function _formatDate(d, fmt) {
  const map = {
    'yyyy': d.getFullYear(),
    'yy': String(d.getFullYear()).slice(2),
    'MM': String(d.getMonth() + 1).padStart(2, '0'),
    'dd': String(d.getDate()).padStart(2, '0'),
    'HH': String(d.getHours()).padStart(2, '0'),
    'mm': String(d.getMinutes()).padStart(2, '0'),
    'ss': String(d.getSeconds()).padStart(2, '0'),
    'SSS': String(d.getMilliseconds()).padStart(3, '0'),
  };
  let result = fmt;
  for (const [k, v] of Object.entries(map)) {
    result = result.replace(k, v);
  }
  return result;
}

// ===================== MD5 =====================
/**
 * @param {string} s - 待编码字符串
 * @param {string} opt - 'Upper' 转大写 | 数字N截断
 */
function genMD5Encode(s, opt) {
  let hash = crypto.createHash('md5').update(String(s)).digest('hex');
  if (opt === 'Upper' || opt === 'upper') {
    hash = hash.toUpperCase();
  }
  const n = parseInt(opt, 10);
  if (!isNaN(n) && n > 0 && n < hash.length) {
    hash = hash.substring(0, n);
  }
  return hash;
}

// ===================== 计算 =====================
function genCalculate(expr) {
  if (!expr) return '0';
  try {
    const result = Function('"use strict"; return (' + expr + ')')();
    return String(result);
  } catch {
    return expr;
  }
}

// ===================== 全局参数 =====================
function genParam(id, params) {
  if (!params || !id) return '';
  return params[id] !== undefined ? String(params[id]) : '';
}

// ===================== 签名占位检测 =====================
const SIGN_FUNCTIONS = new Set([
  'Sign', 'LoginSign', 'paySign', 'rsaSign', 'signData',
  'DigitalSign', 'HmacSign', 'Sm2Sign', 'Sm3Sign', 'Sm4Encrypt'
]);

function isSignFunction(name) {
  return SIGN_FUNCTIONS.has(name);
}

// ===================== 函数映射表 =====================

const FN_MAP = {
  Tel:         { fn: genTel,           argCount: 0 },
  IC:          { fn: genIC,            argCount: 0 },
  RandomUUID:  { fn: genRandomUUID,    argCount: 0 },
  Random:      { fn: genRandom,        argCount: 1 }, // Random(N) N=位数
  Time:        { fn: genTime,          argCount: 1 }, // Time(,Nd) Nd=天数偏移
  DateTime:    { fn: genDateTime,      argCount: 2 }, // DateTime(fmt,Nd)
  MD5Encode:   { fn: genMD5Encode,    argCount: 2 }, // MD5Encode(str,opt)
  // Calculate 和 Param 有特殊语法，单独处理
};

// ===================== 解析入口 =====================

/**
 * 尝试解析一个平台函数名称
 * @param {string} name - 函数名（不含括号和参数）
 * @returns {{ fn: Function, argCount: number } | null}
 */
function getFunctionMeta(name) {
  return FN_MAP[name] || null;
}

/**
 * 判断是否是签名函数（不支持本地执行）
 */
function isSignFunc(name) {
  return isSignFunction(name);
}

/**
 * 解析并执行平台函数调用
 * @param {string} name - 函数名
 * @param {string[]} args - 参数列表（已 resolve 的字符串值）
 * @returns {string}
 */
function callFunction(name, args) {
  const meta = FN_MAP[name];
  if (!meta) {
    if (isSignFunction(name)) return `[UNSUPPORTED:${name}]`;
    return `[UNKNOWN_FN:${name}]`;
  }
  try {
    return String(meta.fn(...args));
  } catch (e) {
    return `[FN_ERROR:${name}]`;
  }
}

/**
 * 从解析后的表达式字符串中提取平台函数的调用信息
 * 支持格式:
 *   Tel           → { name: 'Tel', args: [] }
 *   Random(6)     → { name: 'Random', args: ['6'] }
 *   Time(,1)      → { name: 'Time', args: ['', '1'] }
 *   DateTime(yyyy-MM-dd,3) → { name: 'DateTime', args: ['yyyy-MM-dd', '3'] }
 *   MD5Encode(abc) → { name: 'MD5Encode', args: ['abc'] }
 *   Calculate[1+2] → { name: 'Calculate', args: ['1+2'], isBracket: true }
 *   Param(myKey)  → { name: 'Param', args: ['myKey'] }
 *
 * @param {string} expr - 不带 ${} 的表达式
 * @returns {{ name: string, args: string[], isBracket: boolean } | null}
 */
function parsePlatformCall(expr) {
  if (!expr) return null;

  // Calculate[expr] - 方括号语法
  const bracketMatch = expr.match(/^(\w+)\[(.+)\]$/s);
  if (bracketMatch) {
    const name = bracketMatch[1];
    if (name === 'Calculate') {
      return { name, args: [bracketMatch[2].trim()], isBracket: true };
    }
  }

  // funcName(args) or funcName()
  const parenMatch = expr.match(/^(\w+)\(([\s\S]*)\)$/);
  if (parenMatch) {
    const name = parenMatch[1];
    const argsStr = parenMatch[2];
    const args = _splitArgs(argsStr);
    return { name, args, isBracket: false };
  }

  // Plain function name with no parens
  if (FN_MAP[expr] || isSignFunction(expr)) {
    return { name: expr, args: [], isBracket: false };
  }

  // Param(id) without parentheses? No, Param requires parens.
  return null;
}

/**
 * 分割函数参数，支持空参数（如 Time(,Nd)）
 */
function _splitArgs(argsStr) {
  if (!argsStr || argsStr.trim() === '') return [];
  const args = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (ch === '(') { depth++; current += ch; continue; }
    if (ch === ')') { depth--; current += ch; continue; }
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() || args.length > 0) {
    args.push(current.trim());
  }
  return args;
}

module.exports = {
  getFunctionMeta,
  isSignFunc,
  callFunction,
  parsePlatformCall,
  isSignFunction,
  // 导出单函数以便测试
  genTel,
  genIC,
  genRandomUUID,
  genRandom,
  genTime,
  genDateTime,
  genMD5Encode,
  genCalculate,
  genParam,
};
