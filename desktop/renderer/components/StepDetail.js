// StepDetail.jsx - Modern Step Detail Panel
const StepDetail = ({ records = [], title = '接口列表' }) => {
  const [expanded, setExpanded] = React.useState(null);

  const toggleExpand = (idx) => setExpanded(expanded === idx ? null : idx);

  if (!records || records.length === 0) {
    return React.createElement('div', { className: 'card' }, [
      React.createElement('div', { className: 'card-header', key: 'h' },
        React.createElement('div', { className: 'card-title', key: 't' }, title)),
      React.createElement('div', { className: 'empty-state', key: 'e' },
        React.createElement('span', { className: 'empty-state-icon' }, '📄'),
        React.createElement('h3', null, '暂无数据'),
        React.createElement('p', null, '请先完成管道处理')),
    ]);
  }

  return React.createElement('div', { className: 'card' }, [
    React.createElement('div', { className: 'card-header', key: 'h' }, [
      React.createElement('div', { className: 'card-title', key: 't' }, [
        title,
        React.createElement('span', { className: 'badge', key: 'b' }, records.length + ' 项'),
      ]),
    ]),
    React.createElement('div', { className: 'table-wrapper', key: 'tbl' },
      React.createElement('table', { className: 'table' }, [
        React.createElement('thead', { key: 'th' },
          React.createElement('tr', null, [
            React.createElement('th', { key: 'seq' }, '#'),
            React.createElement('th', { key: 'method' }, '方法'),
            React.createElement('th', { key: 'url' }, 'URL'),
            React.createElement('th', { key: 'status' }, '状态'),
            React.createElement('th', { key: 'expand', style: { width: 50 } }, '详情'),
          ]),
        ),
        React.createElement('tbody', { key: 'tb' },
          records.map((r, i) =>
            React.createElement(React.Fragment, { key: i }, [
              React.createElement('tr', {
                onClick: () => toggleExpand(i),
                style: { cursor: 'pointer' },
              }, [
                React.createElement('td', null, r.seq || i + 1),
                React.createElement('td', null,
                  React.createElement('span', {
                    className: 'method-badge ' + ((r.method || 'GET').toLowerCase()),
                  }, r.method || 'GET'),
                ),
                React.createElement('td', {
                  style: { maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'SF Mono','Fira Code',monospace", fontSize: 12 },
                }, r.url || r.path || '-'),
                React.createElement('td', null,
                  React.createElement('span', {
                    className: 'tag ' + (r.status === 200 || r.status === '200' ? 'tag-success' : r.status && r.status !== '-' ? 'tag-error' : 'tag-default'),
                  }, r.status || '-'),
                ),
                React.createElement('td', { style: { color: 'var(--text-tertiary)', fontSize: 12 } },
                  expanded === i ? '收起' : '展开'),
              ]),
              expanded === i &&
                React.createElement('tr', { key: 'det-' + i },
                  React.createElement('td', {
                    colSpan: 5,
                    style: { padding: '16px 24px', background: 'var(--bg)' },
                  },
                    React.createElement('div', { style: { fontSize: 13, lineHeight: 1.8 } }, [
                      React.createElement('div', { className: 'detail-section', key: 'req-h' },
                        React.createElement('h5', null, '请求头'),
                        React.createElement('div', { className: 'code-block' },
                          JSON.stringify(r.requestHeaders || {}, null, 2)),
                      ),
                      r.requestBody !== undefined &&
                        React.createElement('div', { className: 'detail-section', key: 'req-b' },
                          React.createElement('h5', null, '请求体'),
                          React.createElement('div', { className: 'code-block' },
                            typeof r.requestBody === 'object'
                              ? JSON.stringify(r.requestBody, null, 2)
                              : (r.requestBody || '-')),
                        ),
                      r.responseBody &&
                        React.createElement('div', { className: 'detail-section', key: 'res-b' },
                          React.createElement('h5', null, '响应体（截取前 1000 字符）'),
                          React.createElement('div', {
                            className: 'code-block',
                            style: { maxHeight: 200, overflow: 'auto' },
                          }, typeof r.responseBody === 'object'
                            ? JSON.stringify(r.responseBody, null, 2).slice(0, 1000)
                            : String(r.responseBody).slice(0, 1000)),
                        ),
                    ]),
                  ),
                ),
            ])
          )
        ),
      ])
    ),
  ]);
};
