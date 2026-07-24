/* api-adapter.js - 统一 Electron/Web 双模式 API 调用 */
(function() {
  'use strict';

  const IS_ELECTRON = typeof window !== 'undefined' &&
    (window.process?.type === 'renderer' || typeof window.api !== 'undefined');

  // Toast 辅助
  function showToast(msg, type) {
    const evt = new CustomEvent('app-toast', { detail: { message: msg, type: type || 'info' } });
    window.dispatchEvent(evt);
  }

  // Web 模式文件读取辅助
  function readFileAsJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try { resolve(JSON.parse(e.target.result)); }
        catch (err) { reject(new Error('JSON 解析失败: ' + err.message)); }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }

  // Electron 模式文件选择对话框
  function electronOpenFileDialog() {
    // Electron 通过 preload 暴露的 API
    return window.api.dialogOpenRecording();
  }

  // Web 模式文件选择
  function webOpenFileDialog() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) { resolve(null); return; }
        try {
          const data = await readFileAsJSON(file);
          // 构造类似 Electron 返回的结构 { filePath, recording, scenarios, stats }
          const scenarios = Array.isArray(data) ? data : (data.scenarios || data.recording || [data]);
          const stats = {
            scenarioCount: scenarios.length,
            totalRequests: scenarios.reduce((s, sc) => s + (sc.requests?.length || sc.apiList?.length || 0), 0),
            methods: {},
            domains: new Set(),
          };
          scenarios.forEach(sc => {
            const reqs = sc.requests || sc.apiList || [];
            reqs.forEach(r => {
              const m = (r.method || r.requestMethod || 'GET').toUpperCase();
              stats.methods[m] = (stats.methods[m] || 0) + 1;
              const url = r.url || r.requestUrl || '';
              try { stats.domains.add(new URL(url.startsWith('http') ? url : 'http://' + url).hostname); } catch {}
            });
          });
          stats.domains = [...stats.domains];
          resolve({ filePath: file.name, recording: data, scenarios, stats, name: file.name });
        } catch (err) {
          showToast(err.message, 'error');
          resolve(null);
        }
      };
      input.click();
    });
  }

  // 统一 API
  const api = {
    isElectron: IS_ELECTRON,
    showToast,

    // 打开录制文件选择
    async openRecording() {
      if (IS_ELECTRON) return electronOpenFileDialog();
      return webOpenFileDialog();
    },

    // 导入录制 (Electron: path; Web: file对象或data对象)
    async importRecording(source) {
      if (IS_ELECTRON) {
        try { return await window.api.recordingImport(source); }
        catch (e) { showToast('导入失败: ' + e.message, 'error'); return null; }
      }
      // Web 模式：从 source 对象直接返回
      return source;
    },

    // 启动管道
    async startPipeline(config) {
      if (IS_ELECTRON) {
        try { return await window.api.pipelineStart(config); }
        catch (e) { showToast('管道启动失败: ' + e.message, 'error'); return null; }
      }
      showToast('Web 模式下管道处理为模拟运行', 'info');
      return { ok: true, simulated: true };
    },

    // 获取管道状态
    async getPipelineState() {
      if (IS_ELECTRON) {
        try { return await window.api.getPipelineState?.() || null; }
        catch { return null; }
      }
      return null;
    },

    // 文件读取 (Web: 从 data 读取)
    async readFile(path, dataStore) {
      if (IS_ELECTRON) {
        try { return await window.api.fileRead(path); }
        catch { return null; }
      }
      // Web 模式：从内存数据读取
      return dataStore?.[path] || null;
    },

    // 文件写入 (Web: 写入内存)
    async writeFile(path, data, dataStore) {
      if (IS_ELECTRON) {
        try { return await window.api.fileWrite(path, data); }
        catch (e) { showToast('写入失败: ' + e.message, 'error'); }
      }
      if (dataStore) dataStore[path] = data;
      showToast('文件已保存: ' + path, 'success');
      return true;
    },

    // 目录列表
    async dirList(path) {
      if (IS_ELECTRON) {
        try { return await window.api.dirList?.(path) || []; }
        catch { return []; }
      }
      return [];
    },

    // 文件读取 (兼容 Electron preload 的 fileRead 命名)
    async fileRead(path) {
      if (IS_ELECTRON) {
        try { return await window.api.fileRead(path); }
        catch { return null; }
      }
      return this.readFile(path);
    },

    // 获取关联依赖图
    async getLinkedDeps(outDir) {
      if (IS_ELECTRON) {
        try { return await window.api.getLinkedDeps(outDir); }
        catch { return null; }
      }
      return null;
    },

    // 应用手动关联规则
    async applyManualDeps(outDir, manualDeps) {
      if (IS_ELECTRON) {
        try { return await window.api.applyManualDeps(outDir, manualDeps); }
        catch (e) { return { success: false, error: e.message }; }
      }
      return { success: false, error: 'Web 模式不支持手动关联' };
    },

    // === 增强回归（数据池循环模式） ===
    async runRegressionWithData(params) {
      if (IS_ELECTRON) {
        try { return await window.api.runRegressionWithData(params); }
        catch (e) { return { success: false, error: e.message }; }
      }
      return { success: false, error: 'Web 模式暂不支持' };
    },

    // === 重新组装用例（数据绑定后） ===
    async rerunAssembler(params) {
      if (IS_ELECTRON) {
        try { return await window.api.rerunAssembler(params); }
        catch (e) { return { success: false, error: e.message }; }
      }
      return { success: false, error: 'Web 模式暂不支持' };
    },

    // === 数据池 CRUD (Web 模式用内存/localStorage 存储) ===
    _dataPools: (() => {
      try {
        const saved = localStorage ? localStorage.getItem('qm_dataPools') : null;
        return saved ? JSON.parse(saved) : [];
      } catch { return []; }
    })(),
    _saveDataPoolsToStorage() {
      try {
        if (localStorage) localStorage.setItem('qm_dataPools', JSON.stringify(this._dataPools));
      } catch {}
    },

    async dataPoolList() {
      if (IS_ELECTRON) {
        try { return await window.api.dataPoolList(); }
        catch { return []; }
      }
      return this._dataPools || [];
    },

    async dataPoolSave(poolData) {
      if (IS_ELECTRON) {
        try { return await window.api.dataPoolSave(poolData); }
        catch (e) { return { success: false, error: e.message }; }
      }
      const pools = this._dataPools || [];
      const idx = pools.findIndex(p => p.id === poolData.id);
      if (idx >= 0) {
        pools[idx] = { ...pools[idx], ...poolData };
      } else {
        poolData.id = poolData.id || 'pool_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        poolData.createdAt = new Date().toISOString();
        pools.push(poolData);
      }
      this._dataPools = pools;
      this._saveDataPoolsToStorage();
      return { success: true, pool: poolData };
    },

    async dataPoolGet(poolId) {
      if (IS_ELECTRON) {
        try { return await window.api.dataPoolGet(poolId); }
        catch { return null; }
      }
      const pool = (this._dataPools || []).find(p => p.id === poolId);
      return pool ? { success: true, pool } : { success: false, error: '未找到数据池' };
    },

    async dataPoolDelete(poolId) {
      if (IS_ELECTRON) {
        try { return await window.api.dataPoolDelete(poolId); }
        catch (e) { return { success: false, error: e.message }; }
      }
      this._dataPools = (this._dataPools || []).filter(p => p.id !== poolId);
      this._saveDataPoolsToStorage();
      return { success: true };
    },

    async dataPoolImportCsv(opts) {
      if (IS_ELECTRON) {
        try { return await window.api.dataPoolImportCsv(opts); }
        catch (e) { return { success: false, error: e.message }; }
      }
      window.appApi.showToast('Web 模式暂不支持 CSV 文件导入', 'info');
      return { success: false, error: 'Web 模式暂不支持', canceled: true };
    },

    async dataPoolImportTxt(opts) {
      if (IS_ELECTRON) {
        try { return await window.api.dataPoolImportTxt(opts); }
        catch (e) { return { success: false, error: e.message }; }
      }
      window.appApi.showToast('Web 模式暂不支持 TXT 文件导入', 'info');
      return { success: false, error: 'Web 模式暂不支持', canceled: true };
    },

    // 导出下载 (Web: 触发浏览器下载)
    download(filename, data) {
      if (IS_ELECTRON) return; // Electron 由主进程处理
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  };

  // 挂载到全局
  window.appApi = api;
})();
