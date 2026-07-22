/**
 * main.js - Electron 应用入口
 * 初始化日志系统、IPC 处理器、主窗口
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const logger = require('../core/logger');

const log = logger.create('Main');
let mainWindow = null;

// Windows 控制台编码修复：确保 UTF-8 输出不变成乱码
function fixConsoleEncoding() {
  if (process.platform !== 'win32') return;
  try {
    require('child_process').execSync('chcp 65001>NUL', { timeout: 1000 });
  } catch (e) {
    // chcp 不可用时静默忽略
  }
}

fixConsoleEncoding();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'QM-Testing - API 自动化测试',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // 初始化日志系统
  const appDir = app.getAppPath();
  logger.configure({
    dir: path.join(appDir, 'logs'),
    level: process.env.LOG_LEVEL || 'DEBUG',
    filename: 'qm-testing.log',
    maxDays: 14,
  });

  // 配置 IPC 日志推送（将日志实时推送到渲染进程）
  logger.setIpcPush((entry) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log:entry', entry);
      }
    } catch { /* 窗口已销毁时忽略 */ }
  });

  const { registerIpcHandlers } = require('./ipc-handlers');
  registerIpcHandlers(ipcMain, mainWindow);
  createWindow();

  log.info('QM-Testing 应用启动完成');
  log.info(`日志目录: ${logger.getConfig().dir}`);
  log.info(`日志级别: ${logger.getConfig().level}`);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  log.info('应用退出');
  logger.close();
  if (process.platform !== 'darwin') app.quit();
});
