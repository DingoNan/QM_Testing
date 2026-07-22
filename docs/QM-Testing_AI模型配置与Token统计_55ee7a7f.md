# AI模型配置管理与Token统计实现计划

## 设计原则
- **Provider 抽象**：统一接口支持 Ollama / OpenAI 兼容 / DeepSeek 等
- **优先级策略**：本地 Ollama 优先，云端兜底（参考既有记忆）
- **数据持久化**：JSON 文件存储，无需数据库依赖
- **解耦设计**：AI 配置模块独立，后续 Reviewer Agent 可以按需引入

## 一、后端核心模块

### 1. desktop/core/ai-config.js (新建 ~200行)
- 配置文件路径：`desktop/data/ai-providers.json`
- Provider 结构：
  ```js
  { id, name, type: 'ollama'|'openai', baseUrl, apiKey, defaultModel, priority, isActive, createdAt }
  ```
- 方法：getAll, getById, save (create/update), delete, testConnection, listModels
- 默认预置：本地 Ollama (localhost:11434)

### 2. desktop/core/ai-client.js (新建 ~250行)
- 参考 Auto_Testing-v1.0/src/ollama/client.js 改造
- 多 Provider 统一调用接口：
  ```js
  class AIClient {
    constructor(config)
    async generate(prompt, options)   // 按优先级选择 Provider
    async generateStream(prompt, onChunk, options)
    async ping(providerId)            // 连通性测试
    async listRemoteModels(providerId) // 列出远程模型
  }
  ```
- Ollama 调用 /api/generate，OpenAI 兼容调用 /v1/chat/completions
- 请求中注入 token 计数回调

### 3. desktop/core/token-tracker.js (新建 ~150行)
- 存储文件：`desktop/data/token-usage.json`
- 记录每次请求：provider, model, promptTokens, completionTokens, totalTokens, timestamp
- 统计聚合：今日/本周/本月/总计，按 Provider 和模型分组
- 可选的参考计价（基于常见模型定价表）

## 二、IPC 通信层

### 4. desktop/main/ipc-handlers.js (修改)
新增 IPC channels：
- `ai:getProviders` → 获取所有 Provider 配置
- `ai:saveProvider` → 创建/更新 Provider
- `ai:deleteProvider` → 删除 Provider
- `ai:testConnection` → 测试连通性
- `ai:getModels` → 列出远程可用模型
- `ai:getTokenStats` → 获取 Token 统计数据
- `ai:clearTokenStats` → 清空统计

### 5. desktop/main/preload.js (修改)
通过 contextBridge 暴露 API：
- `getAiProviders()`, `saveAiProvider()`, `deleteAiProvider()`
- `testAiConnection()`, `getAiModels()`
- `getTokenStats()`, `clearTokenStats()`

## 三、前端页面

### 6. desktop/renderer/pages/SettingsPage.js (新建 ~400行)
AI 模型设置页面，包含三个区域：

**A) Provider 管理列表**
- 卡片式展示所有已配置 Provider
- 显示状态指示器（可用/不可用）
- 优先级排序拖拽（或上下按钮）
- 添加/编辑/删除操作

**B) Provider 配置表单（弹窗/抽屉）**
- 名称、类型下拉（Ollama / OpenAI兼容）
- Base URL 输入
- API Key 输入（密码模式，本地文件存储不加密，后续可加）
- 默认模型输入
- 连通性测试按钮（ping 测试）
- 列出远程可用模型按钮

**C) Token 统计面板**
- 总览卡片：总 Token 数、总请求数、今日用量
- 按 Provider 分组统计柱状图
- 按模型分组的明细表格
- 重置统计按钮

### 7. desktop/renderer/app.js (修改)
- 侧边栏添加 `{ key: 'settings', label: '设置', icon: '⚙️' }`
- renderPage 添加 `case 'settings'`
- navItems 放在 'logs' 之前（倒数第二个）

### 8. desktop/renderer/index.html (修改)
- 添加 SettingsPage.js 的 script 引用

## 四、仪表盘集成

### 9. desktop/renderer/pages/DashboardPage.js (修改)
- 在现有指标卡片下方增加一行 AI 状态卡片
- 显示：已配置 Provider 数量、默认 AI 模型名称、今日 Token 消耗
- 点击跳转设置页

## 五、验证计划

1. `node --check` 检查所有新建/修改的后端 JS 文件语法
2. 手动验证 IPC 调用链：renderer → preload → ipcMain → ai-config
3. 验证 AI Provider CRUD 数据持久化
4. 验证 Token 统计记录的写入和聚合
5. 验证设置页面 UI 渲染和交互
6. 验证仪表盘 AI 状态卡片数据加载
