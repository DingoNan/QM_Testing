# QM_Testing — API 自动化测试设计方案

## 一、项目定位

> 浏览器录制 HTTP 请求 → 多 Agent 流水线处理 → 生成可执行的 API 测试用例 → 导入测试平台

从 Tampermonkey 的 UI 录制回放能力延伸，聚焦 **API 级自动化测试**，实现从浏览器操作录制到测试用例生成的全链路自动化。

## 二、架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                   浏览器端 (Tampermonkey)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  API Recorder · user.js                                 │   │
│  │  - XHR/Fetch 拦截                                       │   │
│  │  - 多场景管理                                            │   │
│  │  - 环境标记 (URL/Domain/Auth)                            │   │
│  │  - 导出 JSON (场景 + 请求链)                              │   │
│  └──────────────┬───────────────────────────────────────────┘   │
└─────────────────┼───────────────────────────────────────────────┘
                  │ 录制 JSON (场景数组)
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                Electron 桌面端 (QM-Testing)                      │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Orchestrator (管道编排器)                                │   │
│  │  负责 Agent 调度、状态机、进度跟踪、异常恢复              │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                               │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │  Agent-1: 数据清洗 (Cleaner)                              │   │
│  │  - 噪音过滤 (埋点/静态资源)                               │   │
│  │  - URL 归一化 + 去重                                     │   │
│  │  - 按时间排序重编号                                       │   │
│  │  - 环境信息自动提取 (域名/端口/Auth方式)                   │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                               │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │  Agent-2: 跨接口关联 (Linker)                             │   │
│  │  - 响应值索引构建                                         │   │
│  │  - 自动替换 token/ID/sheetNo 引用                        │   │
│  │  - 鉴权字段强制关联                                       │   │
│  │  - 输出依赖图 (deps.json)                                │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                               │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │  Agent-3: 环境识别 (Env Analyzer)                        │   │
│  │  - 从录制数据推断测试环境                                 │   │
│  │  - 自动提取: baseURL, AuthHeader, Cookie模式              │   │
│  │  - 支持用户补充环境配置 (UI 表单)                         │   │
│  │  - 环境模板管理 (DEV/TEST/PRE/PROD)                       │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                               │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │  Agent-4: 用例拼装 (Assembler)                           │   │
│  │  - 构建标准 CaseVo 格式                                   │   │
│  │  - 自动加默认断言 (code==0)                               │   │
│  │  - Header 整理 (只保留关键请求头)                         │   │
│  │  - 接口命名 (从 Swagger 或路径推断)                       │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                               │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │  Agent-5: 智能审查 (Reviewer)                             │   │
│  │  - 规则审查 (硬编码/数组下标/辅助接口)                    │   │
│  │  - AI 兜底判断 (集成 LLM API)                            │   │
│  │  - 交互式修改建议 (用户确认)                              │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                               │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │  Agent-6: 试跑验证 (Regression Runner)                   │   │
│  │  - 本地真发请求验证                                       │   │
│  │  - 平台函数替换 (Tel/UUID/Time/Sign)                     │   │
│  │  - 依赖链断裂检测                                        │   │
│  │  - 多轮回归测试                                           │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                               │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │  Agent-7: 平台导入/导出 (Exporter)                       │   │
│  │  - 导出标准格式 (JSON/CSV/XLSX)                           │   │
│  │  - 导入到 MeterSphere / 自建平台                          │   │
│  │  - 生成测试报告                                          │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 三、项目目录结构

```
Studies/QM_Testing/
├── recorder/                           # Tampermonkey 录制脚本
│   ├── api-recorder.user.js           # 核心录制脚本 (XHR/Fetch 拦截)
│   └── README.md                      # 安装说明
│
├── desktop/                            # Electron 桌面端
│   ├── main/                          # Electron 主进程
│   │   ├── main.js                    # 应用入口
│   │   ├── ipc-handlers.js            # IPC 通信
│   │   ├── menu.js                    # 菜单配置
│   │   └── updater.js                 # 自动更新
│   │
│   ├── renderer/                      # Electron 渲染进程 (React)
│   │   ├── index.html
│   │   ├── index.tsx
│   │   │
│   │   ├── components/                # 公共组件
│   │   │   ├── PipelineProgress.tsx   # 管道进度条
│   │   │   ├── StepDetail.tsx         # 步骤详情面板
│   │   │   ├── DiffPreview.tsx        # 差异预览
│   │   │   └── EnvForm.tsx            # 环境配置表单
│   │   │
│   │   ├── pages/                     # 页面
│   │   │   ├── ImportPage.tsx         # 导入录制JSON
│   │   │   ├── PipelinePage.tsx       # 管道处理流程
│   │   │   ├── ReviewPage.tsx         # 审核修改
│   │   │   ├── RegressionPage.tsx     # 试跑验证
│   │   │   ├── ExportPage.tsx         # 导出/导入平台
│   │   │   └── HistoryPage.tsx        # 历史记录
│   │   │
│   │   ├── stores/                    # 状态管理
│   │   │   ├── pipelineStore.ts      # 管道状态
│   │   │   ├── agentStore.ts         # Agent 状态
│   │   │   └── projectStore.ts       # 项目/环境配置
│   │   │
│   │   └── styles/                    # 样式
│   │       └── global.css
│   │
│   ├── agents/                        # Agent 核心模块
│   │   ├── orchestrator.js           # 编排器 (调度器)
│   │   ├── base-agent.js             # Agent 基类
│   │   ├── cleaner.js                # Agent-1: 清洗
│   │   ├── linker.js                 # Agent-2: 关联
│   │   ├── env-analyzer.js           # Agent-3: 环境识别
│   │   ├── assembler.js              # Agent-4: 拼装
│   │   ├── reviewer.js               # Agent-5: 审查 (规则 + AI)
│   │   ├── regression-runner.js      # Agent-6: 试跑
│   │   └── exporter.js               # Agent-7: 导出
│   │
│   ├── models/                        # 数据模型
│   │   ├── Recording.js              # 录制数据模型
│   │   ├── Environment.js            # 环境配置模型
│   │   ├── CaseVo.js                 # 用例模型 (对齐平台)
│   │   └── AgentMessage.js           # Agent 间通信模型
│   │
│   ├── pipelines/                     # 管道定义
│   │   ├── default-pipeline.js       # 默认处理管道
│   │   └── custom-pipeline.js        # 自定义管道
│   │
│   ├── platform-connectors/           # 平台连接器
│   │   ├── base-connector.js         # 基类
│   │   ├── metersphere.js            # MeterSphere
│   │   └── custom.js                 # 自定义平台
│   │
│   ├── package.json
│   └── electron-builder.yml           # 打包配置
│
├── scripts/                            # CLI 辅助脚本
│   ├── clean.py                       # 清洗 (Python 版，可独立使用)
│   ├── link.py                        # 关联
│   ├── build.py                       # 拼装
│   ├── dry_run.py                     # 试跑
│   └── import.py                      # 导入
│
├── docs/                               # 文档
│   └── ARCHITECTURE.md
│
└── package.json                        # 根 package.json
```

## 四、核心组件设计

### 4.1 Tampermonkey 录制脚本 (`api-recorder.user.js`)

基于 PW-Recorder_api 的 `interceptor.user.js` 增强：

**新增特性：**
- **环境标记**：录制时记录当前访问的域名、端口、上下文路径
- **场景分组**：支持在录制过程中标记"这是一个新场景/新步骤"
- **请求链可视化**：面板展示请求的上下游关系（根据时间 + URL 模式推测）
- **导出增强**：
  ```json
  {
    "scenarioName": "新增订单",
    "environment": {
      "baseURL": "https://api.example.com",
      "authType": "token",        // token / cookie / basic
      "tokenSource": "login"       // 来自哪个场景/接口
    },
    "records": [
      {
        "seq": 1,
        "time": "...",
        "method": "POST",
        "url": "https://api.example.com/login",
        "status": 200,
        "requestHeaders": {...},
        "requestBody": {...},
        "responseBody": {...}
      }
    ]
  }
  ```

### 4.2 Multi-Agent 系统

**Agent 通信协议：**
```typescript
interface AgentMessage {
  agentId: string;           // 唯一标识
  type: 'request' | 'response' | 'error' | 'progress';
  payload: any;              // 处理数据
  timestamp: number;
  metadata: {
    inputFile: string;       // 输入文件路径
    outputFile: string;      // 输出文件路径
    progress: number;        // 0-100
    status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_user';
  };
}
```

**编排器 (Orchestrator) 职责：**
1. 解析管道定义，按顺序调度 Agent
2. 管理 Agent 间上下文传递（产物流转）
3. 遇到 error 决定是否回滚或继续
4. 处理需用户交互的 Agent（如 Reviewer 等待确认）
5. 维护全局状态，支持断点续传

### 4.3 环境自动识别 + 用户补充 (Agent-3: Env Analyzer)

这是区别于 PW-Recorder_api 的关键差异化设计：

**自动提取逻辑：**
1. 扫描所有请求 URL → 聚合 unique domains → 提取 baseURL
2. 检查请求头是否有 `Authorization` / `token` / `Cookie` → 识别认证方式
3. 检查响应中的 `token` / `sessionId` / `sid` → 识别登录接口
4. 按频率统计 → 推断环境归属 (DEV/TEST/PRE/PROD)

**用户补充界面：**
- 支持编辑/新增环境配置
- 环境字段：名称、baseURL、Auth 类型、Auth 值模板、全局 Header、超时、代理
- 环境模板管理：DEV/TEST/PRE/PROD 一键切换

### 4.4 数据模型设计

**Scenario (录制场景):**
```typescript
interface Scenario {
  id: string;
  name: string;
  environment: EnvironmentInfo;
  records: APIRequest[];
  metadata: {
    createdAt: string;
    sourceUrl: string;
    tags: string[];
  };
}
```

**EnvironmentInfo:**
```typescript
interface EnvironmentInfo {
  baseURL: string;
  authType: 'token' | 'cookie' | 'basic' | 'none';
  authConfig?: {
    tokenPath?: string;         // 如 "data.token"
    loginEndpoint?: string;     // 登录接口 path
    globalHeaders?: Record<string, string>;
  };
  variables?: Record<string, string>;  // 全局变量
}
```

**CaseVo (对齐测试平台):**
```typescript
interface CaseVo {
  name: string;
  type: number;
  projectId: number;
  environment: number;
  domainName: string;
  apiCount: number;
  apiVos: ApiCaseVo[];
}
```

## 五、管道处理流程与文件流转

```
recording.json                   (油猴导出)
    │
    ▼  AGENT-1: Cleaner
cleaned.json                     (噪音过滤 + 去重 + 重编号)
    │
    ▼  AGENT-2: Linker
linked.json  +  deps.json        (变量替换 + 依赖图)
    │
    ▼  AGENT-3: Env Analyzer
linked.json  +  env-config.json  (环境配置 + 全局变量)
    │                               ↑ 用户可在此介入补充
    ▼  AGENT-4: Assembler
case-save.json                   (CaseVo 格式)
    │
    ▼  AGENT-5: Reviewer  (规则审查 → AI 兜底 → 用户确认)
candidates.json → apply.json    (修改建议 → 应用修改)
    │                               ↑ 用户确认修改
    ▼  AGENT-6: Regression Runner
regression-report.json           (试跑结果: OK/FAIL/REF_ERROR)
    │
    ▼  AGENT-7: Exporter
最终 case-save.json  →  导入测试平台  (MeterSphere / 自建)
```

## 六、技术栈选型

| 层次 | 技术 | 说明 |
|------|------|------|
| 录制层 | Tampermonkey (JavaScript) | 浏览器 API 拦截，基于 `interceptor.user.js` |
| 桌面端框架 | Electron 28+ | 跨平台桌面应用 |
| 前端 UI | React 18 + TypeScript | Ant Design 组件库，支持暗色主题 |
| 状态管理 | Zustand | 轻量级状态管理 |
| Agent 引擎 | Node.js Worker Threads | 每个 Agent 独立线程运行 |
| AI 集成 | OpenAI API / 本地 LLM | 审查 Agent 的 AI 兜底能力 |
| 本地存储 | SQLite (via better-sqlite3) | 项目/历史记录/配置持久化 |
| 文件存储 | JSON + JSONL | 管道中间产物 |
| 打包 | electron-builder | Windows/ macOS / Linux |

## 七、Electron 与 Tampermonkey 的交互方式

```
┌──────────────────┐         ┌──────────────────┐
│  Tampermonkey    │         │  Electron 桌面端  │
│  (浏览器)         │         │                  │
│                  │  导出JSON │  导入录制文件     │
│  录制 API 请求   ├─────────►  管道处理         │
│  管理多场景      │  文件    │  Agent 调度       │
│  导出录制文件    │         │  试跑验证         │
│                  │         │  平台导入         │
└──────────────────┘         └──────────────────┘
```

**交互方式：文件交换**（保持松耦合）
- 油猴导出 JSON → 桌面端导入
- 桌面端支持"监听目录"模式：油猴导出到指定目录，桌面自动检测并触发管道

## 八、阶段实施计划

### Phase 1 (MVP) — 核心管道搭建
- [x] 油猴录制脚本开发 (基于 interceptor.user.js 增强)
- [ ] Electron 主进程 + 渲染进程框架
- [ ] Agent 基类 + 编排器
- [ ] Agent-1: Cleaner (清洗去重)
- [ ] Agent-2: Linker (跨接口关联)
- [ ] Agent-4: Assembler (拼装 CaseVo)
- [ ] 基础 UI (导入 + 管道进度 + 导出)

### Phase 2 — AI 与环境增强
- [ ] Agent-3: Env Analyzer (环境自动识别)
- [ ] Agent-5: Reviewer (规则审查 + AI 兜底)
- [ ] 环境配置 UI (编辑/补充/模板管理)
- [ ] 审核交互页面 (差异对比 + 确认修改)

### Phase 3 — 验证与平台对接
- [ ] Agent-6: Regression Runner (试跑验证)
- [ ] Agent-7: Exporter (导入 MeterSphere / 自建平台)
- [ ] 历史记录管理 (SQLite)
- [ ] 试跑结果可视化

### Phase 4 — 高级功能
- [ ] 自定义管道 (用户可编排 Agent 顺序)
- [ ] 请求链可视化 (时序图 + 依赖图)
- [ ] 批量录制处理
- [ ] 监听目录自动触发
- [ ] 自动更新

## 九、与已有项目的差异点

| 维度 | PW-Recorder_api | QM_Testing |
|------|-----------------|------------|
| 录制粒度 | 纯 HTTP 请求拦截 | HTTP 请求 + 环境信息 + 用户操作时间线 |
| 处理方式 | CLI 脚本 + Qoder Skill | Electron 桌面端 GUI + Multi-Agent |
| 环境识别 | 手动传参 --domain | 自动推断 + 用户 UI 补充 |
| 审查能力 | 规则审查 + AI 对话 | 规则审查 + AI 兜底 + GUI 差异对比 |
| 平台对接 | 硬编码导入端点 | 插件式连接器 (MeterSphere / 自定义) |
| 用户体验 | 命令行 | 可视化管道 + 交互式审核 |
| Multi-Agent | 无 | 7 个专门 Agent + 编排器 |
| 持久化 | 无 (临时文件) | SQLite 项目/历史管理 |
| 回归测试 | 单次试跑 | 多轮回归 + 对比报告 |

## 十、关键设计决策

1. **Agent 间松耦合**：每个 Agent 读写标准 JSON 文件，不直接调用对方 API，支持断点续传
2. **文件即接口**：中间产物统一存为 `out/` 目录 JSON，Electron 可通过文件变更监听触发 UI 更新
3. **AI 审查可替换**：Reviewer Agent 的 AI 兜底通过抽象接口 `AIService` 实现，可接入 OpenAI / 本地模型 / 人工
4. **环境模板化**：环境配置 (DEV/TEST/PRE/PROD) 做为一等公民，支持导入/导出/分享
