// ScriptEditor.js - 前置/后置脚本编辑器
// 支持编辑 JavaScript 脚本（前置脚本和后置脚本）
// 提供变量引用快速插入功能
const ScriptEditor = ({ preRequest, postResponse, onPreRequestChange, onPostResponseChange, compact }) => {
  const [expanded, setExpanded] = React.useState(compact ? false : true);
  const [activeTab, setActiveTab] = React.useState('pre');

  // 变量引用模板
  const insertTemplates = [
    { label: '${ctx.}', desc: '上下文变量', insert: '${ctx.}' },
    { label: '${data.}', desc: '数据池字段', insert: '${data.}' },
    { label: '${env.}', desc: '环境变量', insert: '${env.}' },
    { label: '${sys.}', desc: '系统函数', insert: '${sys.}' },
    { label: '${seq.', desc: '响应引用', insert: '${seq.}' },
  ];

  // 常用脚本模板
  const scriptTemplates = {
    preRequest: [
      {
        name: '设置请求头',
        code: '// 设置自定义请求头\nrequest.headers["X-Custom-Header"] = "value";',
      },
      {
        name: '设置请求体字段',
        code: '// 修改请求体\nif (typeof request.body === "object") {\n  request.body.customField = "value";\n}',
      },
      {
        name: '保存上下文变量',
        code: '// 保存值到上下文，供后续接口引用\nctx["userId"] = "12345";\nctx["token"] = "bearer_xxx";',
      },
    ],
    postResponse: [
      {
        name: '自定义断言',
        code: '// 自定义断言\npm.expect(response.status).to.be(200);\npm.expect(response.body.data.state).to.contain("success");',
      },
      {
        name: '提取变量',
        code: '// 从响应提取变量到上下文\nconst id = response.body.data.id;\npm.variables.set("resourceId", id);',
      },
      {
        name: '复杂断言',
        code: '// 数组长度检查\nif (Array.isArray(response.body.data.list)) {\n  pm.expect(response.body.data.list.length).to.be.gte(1);\n}',
      },
    ],
  };

  const insertAtCursor = (textarea, insertText) => {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    const newVal = val.substring(0, start) + insertText + val.substring(end);
    // 通过回调通知父组件更新
    return newVal;
  };

  const handleInsert = (type, template) => {
    const currentCode = type === 'pre' ? preRequest : postResponse;
    const newCode = (currentCode || '') + template.insert || template;
    if (type === 'pre') {
      onPreRequestChange(newCode);
    } else {
      onPostResponseChange(newCode);
    }
  };

  const handleTemplateApply = (type, code) => {
    if (type === 'pre') {
      onPreRequestChange(code);
    } else {
      onPostResponseChange(code);
    }
  };

  return React.createElement('div', {
    className: 'script-editor' + (compact ? ' script-editor-compact' : ''),
    style: {
      border: '1px solid var(--border)',
      borderRadius: 6,
      overflow: 'hidden',
      marginTop: 8,
    },
  }, [
    // Header
    React.createElement('div', {
      key: 'header',
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
      },
      onClick: () => setExpanded(!expanded),
    }, [
      React.createElement('span', {
        key: 'title',
        style: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' },
      }, '⚡ 脚本编辑' + (preRequest || postResponse ? ' (已配置)' : '')),
      React.createElement('span', {
        key: 'arrow',
        style: { fontSize: 11, color: 'var(--text-tertiary)' },
      }, expanded ? '收起' : '展开'),
    ]),

    // Body (collapsible)
    expanded && React.createElement('div', { key: 'body', style: { padding: 8 } }, [
      // Tab switcher
      React.createElement('div', {
        key: 'tabs',
        style: { display: 'flex', gap: 4, marginBottom: 8 },
      }, [
        React.createElement('button', {
          key: 'pre',
          className: 'btn btn-sm',
          onClick: () => setActiveTab('pre'),
          style: {
            background: activeTab === 'pre' ? 'var(--primary)' : 'var(--surface)',
            color: activeTab === 'pre' ? '#fff' : 'var(--text)',
            border: '1px solid ' + (activeTab === 'pre' ? 'var(--primary)' : 'var(--border)'),
            padding: '3px 10px',
            borderRadius: 4,
            fontSize: 11,
            cursor: 'pointer',
          },
        }, '前置脚本 (preRequest)'),
        React.createElement('button', {
          key: 'post',
          className: 'btn btn-sm',
          onClick: () => setActiveTab('post'),
          style: {
            background: activeTab === 'post' ? 'var(--primary)' : 'var(--surface)',
            color: activeTab === 'post' ? '#fff' : 'var(--text)',
            border: '1px solid ' + (activeTab === 'post' ? 'var(--primary)' : 'var(--border)'),
            padding: '3px 10px',
            borderRadius: 4,
            fontSize: 11,
            cursor: 'pointer',
          },
        }, '后置脚本 (postResponse)'),
      ]),

      // Variable insertion buttons
      React.createElement('div', {
        key: 'insert-bar',
        style: { display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' },
      }, insertTemplates.map(t =>
        React.createElement('button', {
          key: t.label,
          className: 'btn btn-sm',
          onClick: () => handleInsert(activeTab, t),
          title: t.desc,
          style: {
            padding: '2px 8px',
            fontSize: 10,
            fontFamily: 'monospace',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            cursor: 'pointer',
          },
        }, t.label)
      )),

      // Script template buttons
      React.createElement('div', {
        key: 'template-bar',
        style: { display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' },
      }, (activeTab === 'pre' ? scriptTemplates.preRequest : scriptTemplates.postResponse).map(t =>
        React.createElement('button', {
          key: t.name,
          className: 'btn btn-sm',
          onClick: () => handleTemplateApply(activeTab, t.code),
          title: '加载模板',
          style: {
            padding: '2px 8px',
            fontSize: 10,
            color: 'var(--primary)',
            background: 'var(--bg)',
            border: '1px dashed var(--primary)',
            borderRadius: 3,
            cursor: 'pointer',
          },
        }, '📋 ' + t.name)
      )),

      // Code editor
      React.createElement('div', {
        key: 'editor',
        style: { position: 'relative' },
      }, [
        React.createElement('div', {
          key: 'label',
          style: { fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 2 },
        }, activeTab === 'pre'
          ? '// 前置脚本 - 发送请求前执行，可修改 request、设置 ctx'
          : '// 后置脚本 - 收到响应后执行，可使用 pm.expect/pm.variables'),
        React.createElement('textarea', {
          key: 'code',
          value: activeTab === 'pre' ? (preRequest || '') : (postResponse || ''),
          onChange: e => {
            const val = e.target.value;
            if (activeTab === 'pre') {
              onPreRequestChange(val);
            } else {
              onPostResponseChange(val);
            }
          },
          placeholder: activeTab === 'pre'
            ? '// 示例: 设置请求头\nrequest.headers["X-Auth"] = ctx.token;\n\n// 设置上下文变量\nctx["userId"] = "123";'
            : '// 示例: 自定义断言\npm.expect(response.status).to.be(200);\n\n// 提取变量\npm.variables.set("resourceId", response.body.data.id);',
          style: {
            width: '100%',
            minHeight: 120,
            padding: 8,
            borderRadius: 4,
            border: '1px solid var(--border)',
            fontSize: 12,
            fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
            background: '#1e1e1e',
            color: '#d4d4d4',
            resize: 'vertical',
            lineHeight: 1.5,
            tabSize: 2,
          },
          spellCheck: false,
        }),
      ]),

      // Quick reference
      React.createElement('div', {
        key: 'ref',
        style: {
          marginTop: 6,
          padding: '6px 8px',
          background: 'var(--bg)',
          borderRadius: 4,
          fontSize: 10,
          color: 'var(--text-tertiary)',
          lineHeight: 1.6,
        },
      }, [
        React.createElement('div', { key: 't', style: { fontWeight: 600, marginBottom: 2 } }, '可用变量:'),
        'request   - 当前请求对象 (method, url, headers, body)',
        'response  - 响应对象 (仅后置脚本: status, body, headers)',
        'ctx       - 上下文变量，跨接口共享',
        'data      - 数据池当前行数据',
        'env       - 环境配置',
        'sys       - 系统函数 (uuid, timestamp, randStr 等)',
        'pm        - (仅后置脚本) pm.expect(), pm.variables.set/get/clear',
      ]),
    ]),
  ]);
};
