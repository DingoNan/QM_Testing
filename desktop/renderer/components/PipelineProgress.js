// PipelineProgress.jsx - Modern Stepper Style
const PipelineProgress = ({ stages = [], progress = {}, running }) => {
  if (!stages || stages.length === 0) {
    return React.createElement('div', { className: 'card' },
      React.createElement('div', { className: 'card-title' }, '管道进度'),
      React.createElement('div', { className: 'empty-state' },
        React.createElement('p', null, '请先导入录制文件')),
    );
  }

  const completed = stages.filter(s => s.status === 'completed').length;
  const total = stages.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const stageIcons = { pending: '', completed: '✓', running: '◉', failed: '✕' };

  return React.createElement('div', { className: 'card' }, [
    React.createElement('div', { className: 'card-header', key: 'h' }, [
      React.createElement('div', { className: 'card-title', key: 't' }, '管道进度'),
      React.createElement('span', {
        key: 'pct',
        style: { fontSize: 13, fontWeight: 600, color: 'var(--primary)' }
      }, completed + '/' + total + ' (' + pct + '%)'),
    ]),

    React.createElement('div', { className: 'progress-bar', key: 'bar' },
      React.createElement('div', {
        className: 'progress-bar-fill' + (pct === 100 ? ' complete' : ''),
        style: { width: pct + '%' },
      }),
    ),

    React.createElement('div', { className: 'stage-stepper', key: 'stepper' },
      stages.map((stage, i) => {
        let cls = 'pending';
        if (stage.status === 'completed') cls = 'completed';
        else if (stage.status === 'running') cls = 'running';
        else if (stage.status === 'failed') cls = 'failed';

        const statusText = {
          completed: '已完成',
          running: '处理中...',
          failed: '失败',
          pending: '等待中',
        };

        return React.createElement('div', { className: 'stage-step ' + cls, key: i }, [
          React.createElement('div', { className: 'stage-step-connector', key: 'con' }, [
            React.createElement('div', { className: 'stage-step-dot', key: 'dot' }, stageIcons[stage.status] || ''),
            i < stages.length - 1 && React.createElement('div', { className: 'stage-step-line', key: 'line' }),
          ]),
          React.createElement('div', { className: 'stage-step-content', key: 'content' }, [
            React.createElement('div', { className: 'stage-step-info', key: 'info' }, [
              React.createElement('h4', { key: 'name' }, stage.name || stage.agentId),
              React.createElement('p', { key: 'desc' },
                stage.status === 'completed' ? '已完成' : statusText[stage.status] || '等待中'),
            ]),
            progress[stage.agentId] !== undefined &&
              React.createElement('span', { className: 'stage-step-progress', key: 'prog' },
                progress[stage.agentId] + '%'),
          ]),
        ]);
      })
    ),
  ]);
};
