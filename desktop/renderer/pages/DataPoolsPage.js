// DataPoolsPage.js - 测试数据管理页面
// 包装 TestDataManager 组件，提供 IPC 回调
const DataPoolsPage = () => {
  const [pools, setPools] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  const loadPools = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.appApi.dataPoolList();
      if (Array.isArray(list)) setPools(list);
    } catch (e) {
      console.warn('加载数据池失败:', e);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { loadPools(); }, [loadPools]);

  const handleSave = async (poolData) => {
    try {
      const result = await window.appApi.dataPoolSave(poolData);
      if (result && result.success) {
        window.appApi.showToast('数据池已保存', 'success');
        loadPools();
      } else {
        window.appApi.showToast('保存失败: ' + (result?.error || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('保存失败: ' + e.message, 'error');
    }
  };

  const handleDelete = async (poolId) => {
    try {
      const result = await window.appApi.dataPoolDelete(poolId);
      if (result && result.success) {
        window.appApi.showToast('数据池已删除', 'success');
        loadPools();
      } else {
        window.appApi.showToast('删除失败: ' + (result?.error || '未知错误'), 'error');
      }
    } catch (e) {
      window.appApi.showToast('删除失败: ' + e.message, 'error');
    }
  };

  const handleImportCsv = async (opts) => {
    try {
      const result = await window.appApi.dataPoolImportCsv(opts || {});
      if (result && result.success) {
        window.appApi.showToast('CSV 导入成功', 'success');
        loadPools();
      }
      return result;
    } catch (e) {
      window.appApi.showToast('CSV 导入失败: ' + e.message, 'error');
      return null;
    }
  };

  const handleImportTxt = async (opts) => {
    try {
      const result = await window.appApi.dataPoolImportTxt(opts || {});
      if (result && result.success) {
        window.appApi.showToast('TXT 导入成功', 'success');
        loadPools();
      }
      return result;
    } catch (e) {
      window.appApi.showToast('TXT 导入失败: ' + e.message, 'error');
      return null;
    }
  };

  if (loading) {
    return React.createElement('div', { className: 'page-loading', style: { padding: 40, textAlign: 'center', color: 'var(--text-secondary)' } }, '加载中...');
  }

  return React.createElement(TestDataManager, {
    dataPools: pools,
    onSave: handleSave,
    onDelete: handleDelete,
    onImportCsv: handleImportCsv,
    onImportTxt: handleImportTxt,
  });
};
