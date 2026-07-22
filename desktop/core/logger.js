/**
 * logger.js — QM-Testing 日志系统
 *
 * 特性:
 *  - 5 级日志: DEBUG / INFO / WARN / ERROR / FATAL
 *  - 彩色控制台输出 (ANSI)
 *  - 文件输出 (自动按天轮转, 保留 14 天)
 *  - 日志级别通过 LOG_LEVEL 环境变量控制 (默认 INFO)
 *  - 日志目录通过 LOG_DIR 环境变量控制 (默认 ./logs)
 *  - 支持 IPC 推送日志到 Electron 渲染进程
 */

const fs = require('fs');
const path = require('path');

/* ═══════════════════════════════════════════════════════════════════
 * 级别定义
 * ═══════════════════════════════════════════════════════════════════ */
const LEVELS = {
  DEBUG: { value: 0, label: 'DEBUG', color: '\x1b[36m' },
  INFO: { value: 1, label: 'INFO', color: '\x1b[32m' },
  WARN: { value: 2, label: 'WARN', color: '\x1b[33m' },
  ERROR: { value: 3, label: 'ERROR', color: '\x1b[31m' },
  FATAL: { value: 4, label: 'FATAL', color: '\x1b[35m' },
};
const RESET = '\x1b[0m';
const GRAY = '\x1b[90m';

/* ═══════════════════════════════════════════════════════════════════
 * 配置（从环境变量读取，支持 .env）
 * ═══════════════════════════════════════════════════════════════════ */
const config = {
  level: (process.env.LOG_LEVEL || 'INFO').toUpperCase(),
  dir: process.env.LOG_DIR || path.join(process.cwd(), 'logs'),
  filename: process.env.LOG_FILE || 'qm-testing.log',
  maxDays: parseInt(process.env.LOG_MAX_DAYS || '14', 10),
  /** Electron IPC 回调，由 main.js 注入 */
  ipcPush: null,
};

function getEffectiveLevel() {
  const lv = config.level;
  if (LEVELS[lv]) return LEVELS[lv].value;
  console.warn(`[logger] 未知日志级别 "${lv}"，回退到 INFO`);
  return 1; // INFO
}

/** 运行时有效级别（每次调用重新计算，支持动态 configure） */
function currentLevel() {
  return getEffectiveLevel();
}

/* ═══════════════════════════════════════════════════════════════════
 * 文件日志（带轮转）
 * ═══════════════════════════════════════════════════════════════════ */
let logStream = null;
let currentDate = '';

function getDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ensureLogStream() {
  const today = getDateStr();
  if (logStream && currentDate === today) return;

  // 关闭旧流
  if (logStream) {
    try { logStream.end(); } catch { /* ignore */ }
  }

  // 确保目录存在
  if (!fs.existsSync(config.dir)) {
    fs.mkdirSync(config.dir, { recursive: true });
  }

  const filePath = path.join(config.dir, `${today}_${config.filename}`);
  logStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' });
  currentDate = today;

  // 清理过期日志文件
  cleanupOldLogs();
}

function cleanupOldLogs() {
  try {
    const files = fs.readdirSync(config.dir);
    const cutoff = Date.now() - config.maxDays * 86400000;
    files.forEach(f => {
      const fp = path.join(config.dir, f);
      try {
        const stat = fs.statSync(fp);
        if (stat.isFile() && stat.birthtimeMs < cutoff) {
          fs.unlinkSync(fp);
        }
      } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

function writeToFile(formatted) {
  try {
    ensureLogStream();
    logStream.write(formatted + '\n');
  } catch (e) {
    console.error('[logger] 文件写入失败:', e.message);
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * 格式化
 * ═══════════════════════════════════════════════════════════════════ */
function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`;
}

function formatMessage(level, moduleName, args) {
  const ts = timestamp();
  const parts = args.map(a =>
    typeof a === 'object' ? (a instanceof Error ? a.stack || a.message : JSON.stringify(a, null, 0)) : String(a)
  );
  const msg = parts.join(' ');
  return `[${ts}] [${level.label}] [${moduleName}] ${msg}`;
}

/* ═══════════════════════════════════════════════════════════════════
 * Logger 类
 * ═══════════════════════════════════════════════════════════════════ */
class Logger {
  constructor(moduleName) {
    this.moduleName = moduleName;
  }

  _log(level, args) {
    if (level.value < currentLevel()) return;

    const formatted = formatMessage(level, this.moduleName, args);

    // 控制台输出（带颜色，直接写流避免 Windows Electron 缓冲问题）
    const stream = level.value >= 2 ? process.stderr : process.stdout;
    stream.write(`${level.color}${formatted}${RESET}\n`);

    // 文件输出（纯文本）
    writeToFile(formatted);

    // IPC 推送（给 Electron 渲染进程）
    if (typeof config.ipcPush === 'function') {
      config.ipcPush({
        timestamp: timestamp(),
        level: level.label,
        module: this.moduleName,
        message: formatMessage(level, this.moduleName, args),
      });
    }
  }

  debug(...args) { this._log(LEVELS.DEBUG, args); }
  info(...args) { this._log(LEVELS.INFO, args); }
  warn(...args) { this._log(LEVELS.WARN, args); }
  error(...args) { this._log(LEVELS.ERROR, args); }
  fatal(...args) { this._log(LEVELS.FATAL, args); }
}

/* ═══════════════════════════════════════════════════════════════════
 * 工厂方法
 * ═══════════════════════════════════════════════════════════════════ */
function create(moduleName) {
  return new Logger(moduleName);
}

/* ═══════════════════════════════════════════════════════════════════
 * 配置接口
 * ═══════════════════════════════════════════════════════════════════ */
function configure(opts) {
  if (opts.level) {
    config.level = opts.level.toUpperCase();
  }
  if (opts.dir) {
    config.dir = opts.dir;
  }
  if (opts.filename) {
    config.filename = opts.filename;
  }
  if (opts.maxDays) {
    config.maxDays = opts.maxDays;
  }
}

function setIpcPush(fn) {
  config.ipcPush = fn;
}

function getConfig() {
  return { ...config };
}

function getCurrentLogFile() {
  const today = getDateStr();
  const filePath = path.join(config.dir, `${today}_${config.filename}`);
  return fs.existsSync(filePath) ? filePath : null;
}

function readRecentLines(count = 200) {
  const filePath = getCurrentLogFile();
  if (!filePath) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-count);
  } catch {
    return [];
  }
}

/** 清理所有日志文件 */
function clearAllLogs() {
  try {
    if (!fs.existsSync(config.dir)) return { success: true, deletedCount: 0 };
    const files = fs.readdirSync(config.dir);
    let deletedCount = 0;
    files.forEach(f => {
      const fp = path.join(config.dir, f);
      try {
        if (fs.statSync(fp).isFile()) {
          fs.unlinkSync(fp);
          deletedCount++;
        }
      } catch { /* ignore */ }
    });
    // 重置日志流
    if (logStream) {
      try { logStream.end(); } catch { /* ignore */ }
      logStream = null;
    }
    currentDate = '';
    return { success: true, deletedCount };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * 优雅关闭
 * ═══════════════════════════════════════════════════════════════════ */
function close() {
  if (logStream) {
    try {
      logStream.end();
    } catch { /* ignore */ }
    logStream = null;
  }
}

module.exports = {
  create,
  configure,
  setIpcPush,
  getConfig,
  getCurrentLogFile,
  readRecentLines,
  clearAllLogs,
  close,
};

// 进程退出时关闭文件流
process.on('exit', close);
process.on('SIGINT', () => { close(); process.exit(0); });
process.on('SIGTERM', () => { close(); process.exit(0); });
