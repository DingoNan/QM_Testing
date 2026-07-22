// DiffPreview.jsx - 差异预览组件 (Modern)
const DiffPreview = ({ candidate }) => {
  if (!candidate) return null;

  const getActionColor = (action) => {
    if (action === 'delete_api') return 'var(--danger)';
    if (action?.startsWith('replace')) return 'var(--warning)';
    return 'var(--primary)';
  };

  const typeLabel = {
    hardcoded_seed_value: '硬编码值',
    likely_auxiliary_interface: '辅助接口',
    unstable_array_index: '不稳定下标',
  };

  const typeColors = {
    hardcoded_seed_value: 'tag-warning',
    likely_auxiliary_interface: 'tag-error',
    unstable_array_index: 'tag-info',
  };

  return React.createElement('div', { className: 'card' }, [
    React.createElement('div', { className: 'card-header', key: 'h' },
      React.createElement('div', { className: 'card-title', key: 't' }, [
        '修改建议 #' + candidate.id,
        React.createElement('span', {
          className: 'tag ' + (typeColors[candidate.type] || 'tag-default'),
          key: 'tag',
        }, typeLabel[candidate.type] || candidate.type),
      ]),
    ),
    React.createElement('div', { className: 'config-display', key: 'body' }, [
      React.createElement('span', { className: 'label' }, '位置'),
      React.createElement('span', { className: 'value', style: { fontFamily: "'SF Mono','Fira Code',monospace", fontSize: 12 } }, candidate.location),
      React.createElement('span', { className: 'label' }, '当前值'),
      React.createElement('span', { className: 'value' },
        React.createElement('code', { className: 'code-inline' }, candidate.currentValue)),
      candidate.suggestedValue && [
        React.createElement('span', { className: 'label', key: 'l' }, '建议值'),
        React.createElement('span', { className: 'value', key: 'v' },
          React.createElement('code', { className: 'code-inline', style: { color: 'var(--success)' } },
            candidate.suggestedValue)),
      ],
      React.createElement('span', { className: 'label' }, '置信度'),
      React.createElement('span', { className: 'value' }, candidate.confidence || '-'),
      React.createElement('span', { className: 'label' }, '建议操作'),
      React.createElement('span', { className: 'value', style: { color: getActionColor(candidate.suggestedAction), fontWeight: 600 } },
        candidate.suggestedAction === 'delete_api' ? '删除该接口' :
        candidate.suggestedAction === 'replace_value' ? '替换值' : '保留'),
      React.createElement('span', { className: 'label' }, '理由'),
      React.createElement('span', { className: 'value', style: { color: 'var(--text-secondary)', fontSize: 13 } },
        candidate.reason || '-'),
    ]),
  ]);
};
