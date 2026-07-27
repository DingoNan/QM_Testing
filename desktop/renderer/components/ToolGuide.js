// ToolGuide.js - 工具使用说明组件
const ToolGuide = ({ onClose }) => {
  const style = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20, backdropFilter: 'blur(4px)',
    },
    modal: {
      background: 'var(--card-bg)', borderRadius: 14, boxShadow: 'var(--shadow-xl)',
      width: 700, maxWidth: '90vw', maxHeight: '85vh',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      animation: 'modalIn 200ms var(--ease)',
    },
    header: {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '20px 24px 16px', borderBottom: '1px solid var(--border-light)',
    },
    title: { fontSize: 18, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 },
    body: { padding: '20px 24px', overflow: 'auto', flex: 1, fontSize: 14, lineHeight: 1.7 },
    closeBtn: {
      width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
      background: 'var(--card-bg)', cursor: 'pointer', fontSize: 16,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-secondary)', transition: 'all 0.15s',
    },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 },
    sectionDesc: { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.7 },
    list: { paddingLeft: 20, margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 2 },
    step: {
      display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 8,
      background: 'var(--bg-alt)', marginBottom: 6, alignItems: 'flex-start',
    },
    stepNum: {
      width: 24, height: 24, borderRadius: '50%', background: 'var(--primary)',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1,
    },
    stepContent: { flex: 1 },
    stepTitle: { fontWeight: 600, fontSize: 13, color: 'var(--text)' },
    stepDesc: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 },
    card: {
      background: 'var(--surface)', borderRadius: 8, padding: 14, marginBottom: 10,
      border: '1px solid var(--border)',
    },
    code: {
      fontFamily: "'SF Mono','Fira Code',monospace", fontSize: 12,
      padding: '2px 6px', background: 'var(--bg-alt)', borderRadius: 4,
      color: 'var(--primary)', border: '1px solid var(--border)',
    },
    tip: {
      background: 'var(--primary-light)', borderRadius: 8, padding: '10px 14px',
      fontSize: 13, color: 'var(--primary-dark)', marginTop: 8,
      borderLeft: '3px solid var(--primary)',
    },
    ruleIcon: { width: 20, display: 'inline-block', textAlign: 'center', marginRight: 6 },
  };

  return React.createElement('div', {
    className: 'guide-overlay',
    style: style.overlay,
    onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', { style: style.modal, onClick: e => e.stopPropagation() }, [
      // Header
      React.createElement('div', { key: 'h', style: style.header }, [
        React.createElement('div', { key: 't', style: style.title }, '📖 使用说明'),
        React.createElement('button', {
          key: 'c', style: style.closeBtn,
          onClick: onClose, onMouseOver: e => e.target.style.background = 'var(--bg-alt)',
          onMouseOut: e => e.target.style.background = 'var(--card-bg)',
        }, '✕'),
      ]),

      // Body
      React.createElement('div', { key: 'b', style: style.body }, [

        // === 工具简介 ===
        React.createElement('div', { key: 'intro', style: style.section }, [
          React.createElement('div', { key: 't', style: style.sectionTitle }, '🎯 工具简介'),
          React.createElement('p', { key: 'p1', style: style.sectionDesc },
            'QM-Testing 是一款多Agent流水线驱动的自动化API测试工具，从浏览器录制到测试报告生成，实现全流程智能化、自动化。'),
          React.createElement('ul', { key: 'ul', style: style.list }, [
            React.createElement('li', { key: 'a' }, '🤖 多Agent协作 — 自动解析请求、分类、增强、组装、审查智能断言'),
            React.createElement('li', { key: 'b' }, '📊 全流程可视化 — Pipeline实时展示各Agent处理状态与结果'),
            React.createElement('li', { key: 'c' }, '🔗 智能接口关联 — 自动识别接口间数据依赖，一键配置参数传递'),
            React.createElement('li', { key: 'd' }, '📦 数据驱动测试 — 数据池、变量、环境配置，灵活实现参数化'),
            React.createElement('li', { key: 'e' }, '🚀 回归验证 — 批量执行测试，自动对比差异，一键生成报告'),
          ]),
        ]),

        // === 使用流程 ===
        React.createElement('div', { key: 'flow', style: style.section }, [
          React.createElement('div', { key: 't', style: style.sectionTitle }, '📋 使用流程'),
          [
            { num: 1, title: '导入录制', desc: '通过浏览器插件 / HAR文件 / 代理录制 导入API请求记录' },
            { num: 2, title: '管道处理', desc: '多Agent自动解析请求结构、生成智能断言、识别接口依赖关系' },
            { num: 3, title: '智能审查', desc: '查看生成的接口列表，确认参数、断言、校验规则的准确性' },
            { num: 4, title: '接口关联', desc: '配置接口间响应值传递，设置变量引用表达式 (${seq.N.path})' },
            { num: 5, title: '绑定测试数据', desc: '创建或导入数据池，配置字段映射，实现数据驱动测试' },
            { num: 6, title: '回归验证', desc: '配置运行参数，批量执行测试用例，实时查看执行进度' },
            { num: 7, title: '查看报告', desc: '分析测试结果，对比历史报告，查看接口差异详情' },
          ].map(s =>
            React.createElement('div', { key: s.num, style: style.step }, [
              React.createElement('div', { style: style.stepNum }, s.num),
              React.createElement('div', { style: style.stepContent }, [
                React.createElement('div', { style: style.stepTitle }, s.title),
                React.createElement('div', { style: style.stepDesc }, s.desc),
              ]),
            ])
          ),
        ]),

        // === 参数化说明 ===
        React.createElement('div', { key: 'param', style: style.section }, [
          React.createElement('div', { key: 't', style: style.sectionTitle }, '🔧 参数化使用说明'),
          React.createElement('p', { key: 'p', style: style.sectionDesc },
            'QM-Testing 支持多种变量引用方式，可在请求 URL、Header、Body 及断言中灵活使用。所有变量引用均采用 '),
          React.createElement('p', { key: 'p2', style: { ...style.sectionDesc, fontWeight: 600, fontSize: 14 } },
            '通用语法: ${变量表达式}  —  支持嵌套路径，如 ${seq.1.data.token}'),

          React.createElement('div', { key: 'c1', style: style.card }, [
            React.createElement('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, '🔗 接口响应变量（接口关联）'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 } },
              '引用前面接口的响应值，自动建立上下游依赖：'),
            React.createElement('code', { style: style.code }, '${seq.序号.JSON路径}'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 } },
              '示例: ${seq.1.data.token} — 引用第1个接口响应的 data.token'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 } },
              '示例: ${seq.2_headers.Set-Cookie} — 引用第2个接口响应头中的 Set-Cookie'),
          ]),
          React.createElement('div', { key: 'c2', style: style.card }, [
            React.createElement('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, '📦 数据池变量（数据驱动）'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 } }, '引用数据池中的字段值，实现数据驱动：'),
            React.createElement('code', { style: style.code }, '${data.数据池名称.字段名}'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 } }, '示例: ${data.loginUser.username} — 从 loginUser 数据池取 username'),
          ]),
          React.createElement('div', { key: 'c3', style: style.card }, [
            React.createElement('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, '🌐 环境变量'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 } }, '引用环境配置中的变量，管理不同环境差异：'),
            React.createElement('code', { style: style.code }, '${env.变量名}'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 } }, '示例: ${env.baseURL} — 引用环境变量中的 baseURL'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 } }, '示例: ${env.globalHeaders.Authorization} — 引用全局请求头中的 Token'),
          ]),

          // 平台函数
          React.createElement('div', { style: { marginTop: 16, marginBottom: 8, fontWeight: 600, fontSize: 13, color: 'var(--text)' } }, '🧩 内置平台函数（可直接在表达式中使用）'),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            [
              { name: '${RandomUUID}', desc: '生成随机 UUID v4' },
              { name: '${RandomInt}', desc: '生成随机整数' },
              { name: '${Timestamp}', desc: '当前时间戳(ms)' },
              { name: '${DateTime}', desc: '当前时间 yyyy-MM-dd' },
              { name: '${Tel}', desc: '随机手机号' },
              { name: '${IC}', desc: '随机身份证号' },
            ].map(fn =>
              React.createElement('span', {
                key: fn.name, style: {
                  fontSize: 12, padding: '4px 10px', borderRadius: 6,
                  background: 'var(--bg-alt)', border: '1px solid var(--border)',
                  fontFamily: 'monospace', color: 'var(--primary)',
                },
                title: fn.desc,
              }, fn.name + ' — ' + fn.desc)
            )
          ),

          // 断言中的变量
          React.createElement('div', { style: { marginTop: 16 }, key: 'assert-var' },
            React.createElement('div', { style: { ...style.tip, borderLeftColor: '#8B5CF6' } }, [
              React.createElement('span', { style: { fontWeight: 600 } }, '🔬 断言表达式中的变量 — '),
              '断言同样支持变量引用，如 ', React.createElement('code', { style: style.code }, '${seq.1.data.total}'),
              ' 可动态断言接口间的数据一致性。也可以在期望值中使用 ', React.createElement('code', { style: style.code }, '${env.xxx}'),
              ' 引用环境配置。',
            ])
          ),
        ]),

        // === 测试数据使用 ===
        React.createElement('div', { key: 'data', style: style.section }, [
          React.createElement('div', { key: 't', style: style.sectionTitle }, '🗄️ 测试数据管理'),
          React.createElement('p', { key: 'p', style: style.sectionDesc },
            '在"测试数据"页面可管理数据池，支持手动创建、CSV/TXT导入、批量粘贴：'),
          React.createElement('ul', { key: 'ul', style: style.list }, [
            React.createElement('li', { key: 'a' }, '创建数据池 — 手动定义字段和行数据，适用于少量测试数据'),
            React.createElement('li', { key: 'b' }, 'CSV/TXT导入 — 从文件批量导入，首行自动识别为字段名'),
            React.createElement('li', { key: 'c' }, '批量粘贴 — 复制表格数据直接粘贴，自动解析格式'),
            React.createElement('li', { key: 'd' }, '编辑数据池 — 点击卡片展开详情，点击"编辑"修改已有数据'),
            React.createElement('li', { key: 'e' }, '变量引用 — 在接口中使用 ${data.poolName.fieldName} 引用数据'),
            React.createElement('li', { key: 'f' }, '管理控制 — 数据行超出时支持循环/仅现有/报错三种模式'),
          ]),
        ]),

        // === 使用规范与建议 ===
        React.createElement('div', { key: 'rules', style: style.section }, [
          React.createElement('div', { key: 't', style: style.sectionTitle }, '💡 使用规范与建议'),
          React.createElement('div', { key: 'r1', style: { ...style.tip, borderLeftColor: '#10B981' } }, [
            React.createElement('span', { style: { fontWeight: 600 } }, '📌 数据池命名规范 — '),
            '使用有意义的英文名称，如 loginUser、orderList，便于在变量引用中识别',
          ]),
          React.createElement('div', { key: 'r2', style: style.tip }, [
            React.createElement('span', { style: { fontWeight: 600 } }, '📌 环境配置分离 — '),
            '将不同环境的差异（域名、端口、账号）放入环境变量管理，避免硬编码',
          ]),
          React.createElement('div', { key: 'r3', style: { ...style.tip, borderLeftColor: '#10B981' } }, [
            React.createElement('span', { style: { fontWeight: 600 } }, '📌 接口关联原则 — '),
            '优先使用接口响应变量进行参数传递，减少对固定数据的依赖',
          ]),
          React.createElement('div', { key: 'r4', style: style.tip }, [
            React.createElement('span', { style: { fontWeight: 600 } }, '📌 断言覆盖建议 — '),
            '至少覆盖：状态码、关键字段存在性、业务状态码。可按需增加响应时间断言',
          ]),
          React.createElement('div', { key: 'r5', style: { ...style.tip, borderLeftColor: '#10B981' } }, [
            React.createElement('span', { style: { fontWeight: 600 } }, '📌 回归策略 — '),
            '首次运行建议逐条审查确认接口和断言；后续回归可批量执行，关注差异对比',
          ]),
          React.createElement('div', { key: 'r6', style: style.tip }, [
            React.createElement('span', { style: { fontWeight: 600 } }, '📌 数据行模式选择 — '),
            '数据行超出时：选择"循环"适用于登录用户列表等场景；选择"报错"适用于精确匹配场景',
          ]),
        ]),

      ]),
    ])
  );
};
