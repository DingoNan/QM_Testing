# AI 审核与优化逻辑规则

## 概述：三阶段审查→优化工作流

智能审查功能由三个阶段构成，数据**依次传递**，前一阶段的输出是后一阶段的输入：

```
Phase 1: 内置规则审查 ──→ findings[] (规则违规列表)
                │
                ▼ (传入)
Phase 2: AI 深度审查 ──→ aiReview { suggestions[] } (含具体修复方案)
                │
                ▼ (传入 findings + aiSuggestions)
Phase 3: AI 优化 ──→ 优化后的用例/接口
```

**核心原则**：AI 审查负责"诊断 + 开药方"，AI 优化负责"按方抓药"。两者数据链不能断裂。

---

## 一、Phase 1：内置规则审查（始终执行）

### 1.1 内置规则

系统内置 **6 条审查规则**，每条规则独立启停：

| 规则 ID | 名称 | 严重级别 | 默认启用 | 描述 |
|---------|------|----------|----------|------|
| `STATUS_ASSERT` | 状态码断言 | error | 是 | 检查每个接口是否包含 HTTP 状态码断言 |
| `MIN_ASSERT` | 最少断言数 | warning | 是 | 每个接口至少包含 N 个断言 |
| `BODY_EXISTS` | 请求体检查 | warning | 是 | POST/PUT/PATCH 方法应包含请求体 |
| `HARDCODED_ID` | 硬编码 ID 检查 | warning | 是 | URL 中是否包含未参数化的数字 ID |
| `CONTENT_TYPE` | Content-Type 检查 | info | 否 | 检查请求是否包含 Content-Type 头 |
| `URL_EMPTY` | 空 URL 检查 | error | 是 | 检查接口 URL 是否为空 |

### 1.2 输出格式

```json
{
  "findings": [
    {
      "ruleId": "STATUS_ASSERT",
      "ruleName": "状态码断言",
      "severity": "error",
      "apiIndex": 0,
      "apiName": "登录接口",
      "apiUrl": "/api/login",
      "pass": false,
      "message": "缺少 HTTP 状态码断言（如 responseBody.code = 200）"
    }
  ],
  "stats": {
    "totalApis": 5,
    "failedCount": 3,
    "errors": 1,
    "warnings": 2
  }
}
```

---

## 二、Phase 2：AI 深度审查（可选，需用户启用）

### 2.1 输入数据

AI 审查接收两类输入：

1. **用例信息**：名称、域名、环境、接口列表（方法、URL、名称、断言数、请求体有无）
2. **内置规则审查结果**（`findings[]`）—— **关键**：让 AI 知道哪些规则违规了

### 2.2 审查职责

AI 审查在查看内置规则 findings 后，需要做三件事：

1. **评估整体质量**（`overall_quality`）
2. **分析问题根因**—— 对内置规则发现的问题进行深度分析
3. **给出具体修复方案**（`solution`）—— 不仅是"有问题"，还要给出"应该怎样修"

### 2.3 输出格式

```json
{
  "overall_quality": "fair",
  "summary": "用例整体质量中等，存在断言覆盖不足等问题",
  "suggestions": [
    {
      "apiIndex": 0,
      "issue": "缺少 HTTP 状态码断言",
      "suggestion": "建议添加状态码 200 的断言",
      "solution": "\"assertVos\": [{ \"expression\": \"responseBody.code\", \"validateType\": 3, \"expectValue\": \"200\" }]"
    },
    {
      "apiIndex": 0,
      "issue": "POST 请求缺少请求体",
      "suggestion": "检查请求体是否确实需要，如有必要则补充参数",
      "solution": "\"requestBody\": \"{\\\"username\\\": \\\"${变量}\\\"}\""
    }
  ]
}
```

**字段说明**：
- `issue`：问题描述
- `suggestion`：建议的文字说明
- `solution`：**具体的 JSON 代码片段/配置**，可供后续优化阶段直接参考

### 2.4 Prompt 结构

```
你是一名 API 测试专家，审查以下测试用例并给出改进建议。

## 用例信息
名称: xxx
域名: xxx
环境: xxx

## 接口列表
[1] POST /api/login
  名称: 登录接口
  断言数: 0
  有请求体: 是

## 内置规则审查发现的问题（供参考）
- [#1] 状态码断言: 缺少 HTTP 状态码断言
- [#1] 最少断言数: 断言数量不足（0/1）

## 审查要求
请以 JSON 格式输出审查结果，包含以下字段：
1. overall_quality: "good"/"fair"/"poor"
2. summary: 总体评价（中文，50字以内）
3. suggestions: 改进建议数组，每项包含：
   - apiIndex: 数字
   - issue: 问题描述
   - suggestion: 改进建议（文字说明）
   - solution: 具体的修复方案（JSON 代码片段或配置说明）

注意：针对内置规则发现的问题，必须给出具体的 solution 字段，
      说明如何修改断言、请求体、请求头等。
只输出 JSON，不要其他文字。
```

---

## 三、Phase 3：AI 优化

### 3.1 输入数据

AI 优化同时接收两类输入：

1. **内置规则 findings**（来自 Phase 1）—— 知道哪些规则违规
2. **AI 审查 suggestions**（来自 Phase 2）—— 知道 AI 给出的具体修复方案

**优化原则**：AI 优化应当按照 AI 审查的 suggestions 来实施修复，而不是自己重新分析问题。

### 3.2 优化维度

| 维度 | 说明 |
|------|------|
| **全量优化** | 对用例所有接口进行优化，输出完整用例 JSON |
| **单条优化** | 对指定单个接口进行优化，输出单个接口 JSON |

### 3.3 Prompt 结构（单条优化示例）

```
你是一名 API 测试专家，请优化以下测试用例中的单个接口。

## 用例信息
名称: xxx
域名: xxx

## 接口信息
序号: #1
...

## 内置规则审查发现的问题
- [error] 状态码断言: 缺少 HTTP 状态码断言

## AI 深度审查建议（供参考，优先遵循）
- [#1] 缺少 HTTP 状态码断言
  建议: 建议添加状态码 200 的断言
  修复方案: { "assertVos": [{ "expression": "responseBody.code", "validateType": 3, "expectValue": "200" }] }

## 优化要求
请**优先按照 AI 深度审查给出的修复方案**进行优化。
如果 AI 审查未给出具体方案，再结合内置规则发现的问题自行修复。

**最重要的原则：只添加缺失的断言，不要修改已有的断言！**

1. 只添加缺失的状态码断言（如 responseBody.code = 200）
2. **已有的断言必须保持原样输出**，不要改变其 expression、validateType 或 expectValue
3. 断言中的 `(空)` 表示该断言未设置期望值，这是合理状态，不要试图"修复"
4. 断言中的 `(非空检查)` / `(存在检查)` 表示仅检查字段是否存在，不需要期望值
5. 补充必要的请求头
6. **⚠️ 防过度修复**：保留原始空值/空字符串
7. 只输出优化后的单个接口 JSON，不要输出完整用例
```

### 3.4 完整调用链

```
用户操作                             数据流动
─────────────────────────────────────────────────────────────────────
点击"执行审查"(勾选 AI)    
  → handleRunReview()               ruleConfigs + useAI
  → IPC review:run 
  → ReviewerAgent.execute()         caseVo + ruleConfigs + useAI
      ├── Phase 1: 内置规则检查      → findings[]
      ├── Phase 2: AI 审查           → findings + aiProvider → aiReview
      └── 返回审查报告                { findings, aiReview, stats }
             │
             ▼
点击"AI 优化" / "单条AI"    
  → handleAiOptimize /              findings + aiReview.suggestions
    handleAiOptimizeSingle
  → IPC review:optimize /           caseVo + findings + aiSuggestions
    review:optimizeSingle
  → _aiOptimize / _aiOptimizeSingle  findings + aiSuggestions → 优化
  → 返回优化后的用例/接口
```

### 3.5 流式输出

AI 调用支持流式输出（SSE）：

- **Ollama**：HTTP POST `/api/generate`，`stream: true`，逐行解析 JSON
- **OpenAI 兼容**：HTTP POST `/chat/completions`，`stream: true`，SSE 格式解析
- **回调转发**：IPC handler 通过 `mainWindow.webContents.send('review:aiChunk', chunk)` 转发到渲染进程
- **前端展示**：渲染进程监听 `review:aiChunk` 事件，实时追加到 AI 交互日志面板

---

## 四、防过度修复策略

AI 优化的核心约束：

1. **空请求体保护**：POST 接口的 `requestBody` 为空可能是合理设计，不强制添加
2. **空字符串保留**：保留原始数据中的空值/空字符串字段
3. **按方抓药**：优先按 AI 审查的修复方案执行，不自行"过度发挥"
4. **不确定则保留**：不确定是否应修改的字段，保持原样

### 4.1 断言保护原则（重要）

AI 优化最容易被"过度发挥"的地方就是断言字段。优化时必须遵守：

1. **只添加缺失的断言，不要修改已有的断言**
2. 已有的断言必须保持 `expression`、`validateType`、`expectValue` 完全不变
3. 断言中 `(空)` 表示该断言未设置期望值，是合理状态，AI 不应试图"修复"
4. 断言中 `(非空检查)` / `(存在检查)` 表示仅检查字段是否存在，不需要期望值
5. 唯一允许的修改是**添加缺失的状态码断言**（如 `responseBody.code = 200`）

---

## 五、JSON 解析健壮性

### 5.1 _extractJSON 方法

AI 返回的文本可能包含多余内容（如 markdown 代码块、解释文字、多个 JSON 对象等）。
`_extractJSON()` 方法使用三级降级策略安全提取 JSON：

```
Level 1: 直接 JSON.parse(text.trim())                 ← 纯 JSON 响应
Level 2: 提取 markdown 代码块 → JSON.parse             ← ```json ... ``` 格式
Level 3: 括号平衡法找到第一个完整 JSON 对象            ← 多余文本 + JSON 混合
```

括号平衡法通过计数 `{` / `}` 并跳过字符串内的括号，
确保即使 AI 返回了多个 JSON-like 结构也能正确提取第一个完整对象。

### 5.2 错误处理

| 错误类型 | 日志 | 返回值 |
|---------|------|--------|
| AI 返回空内容 | `warn` | `{ optimizedApi: null }` |
| JSON 解析失败 | `warn` + 原始内容前 200 字符 | `{ optimizedApi: null }` |
| JSON 内容不符合预期 | 在调用方处理 | 取决于调用方 |

---

## 六、日志记录规范

所有 AI 调用必须记录后端日志，便于问题排查：

| 日志点 | 级别 | 内容 |
|--------|------|------|
| AI 审查开始 | info | "AI 审查开始, 用例: xxx, 接口数: N" |
| AI 审查完成 | info | "AI 审查完成, 质量评级: good/fair/poor" |
| AI 审查失败 | error | "AI 审查失败: 错误信息" |
| AI 优化开始 | info | "AI 优化开始, 模式: 全量/单条(#N)" |
| AI 优化完成 | info | "AI 优化完成, 成功/失败" |
| AI 优化失败 | error | "AI 优化失败: 错误信息" |
| AI Provider 未配置 | warn | "AI Provider 未配置, 跳过 AI 操作" |
| AI 返回结果解析失败 | error | "AI 返回结果 JSON 解析失败: 原始内容" |

---

## 六、架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                        前端 (ReviewPage.js)                       │
│                                                                   │
│  handleRunReview()                                                │
│    ├── 内置规则检查 ───→ findings[]                                │
│    └── AI 审查 (useAI=true) ──→ aiReview.suggestions[]            │
│                                                                   │
│  handleAiOptimize() / handleAiOptimizeSingle()                    │
│    └── 传入 findings + aiSuggestions                              │
│         → IPC review:optimize / review:optimizeSingle             │
└─────────────────────────┬────────────────────────────────────────┘
                          │
┌─────────────────────────┼────────────────────────────────────────┐
│                主进程 (ipc-handlers.js)                           │
│                         │                                         │
│  log.info("AI 优化开始")                                          │
│  ReviewerAgent._aiOptimize(caseVo, findings, aiSuggestions, cb)   │
│  log.info("AI 优化完成")                                          │
└─────────────────────────┬────────────────────────────────────────┘
                          │
┌─────────────────────────┼────────────────────────────────────────┐
│              ReviewerAgent (reviewer.js)                          │
│                         │                                         │
│  execute()                                                        │
│    ├── Phase 1: BUILTIN_RULES 逐规则检查 → findings[]             │
│    ├── Phase 2: _aiReview(caseVo, findings)                       │
│    │     Prompt 包含: 用例信息 + 内置规则 findings                │
│    │     输出: { overall_quality, suggestions[] }                 │
│    │     每项 suggestion 含: issue, suggestion, solution          │
│    └── 返回 { findings, aiReview, stats }                        │
│                                                                   │
│  _extractJSON(text)                                                 │
│    ├── 三级降级解析 JSON                                            │
│    └── 返回解析后的 JS 对象或 null                                  │
│                                                                   │
│  _aiOptimize(caseVo, findings, aiSuggestions)                     │
│    ├── Prompt 包含: 用例信息 + findings + aiSuggestions          │
│    └── 输出: 优化后的完整用例 JSON                                │
│                                                                   │
│  _aiOptimizeSingle(caseVo, apiIndex, findings, aiSuggestions)     │
│    ├── Prompt 包含: 接口信息 + apiFindings + apiAiSuggestions    │
│    └── 输出: 优化后的单个接口 JSON                                │
└─────────────────────────┬────────────────────────────────────────┘
                          │
┌─────────────────────────┼────────────────────────────────────────┐
│                  AIClient (ai-client.js)                          │
│                         │                                         │
│  generate(prompt) ───→ 非流式请求                                 │
│  generateStream(prompt, onChunk) ───→ SSE 流式请求                │
│    ├── Ollama: /api/generate                                      │
│    └── OpenAI 兼容: /chat/completions                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 七、数据完整性校验

| 检查点 | 验证内容 |
|--------|----------|
| Phase 1 → Phase 2 | `findings[]` 是否已传给 `_aiReview` |
| Phase 2 → Phase 3 | `aiReview.suggestions` 是否已传给 `_aiOptimize`/`_aiOptimizeSingle` |
| 优化结果应用 | 单条优化后 `apiVos[apiIndex]` 是否正确替换 |
| 防过度修复 | 优化前后无关字段是否保持不变 |
| JSON 解析健壮性 | AI 返回文本使用 `_extractJSON()` 可靠提取 |
| 断言保护 | 优化前后已有断言的 expression/validateType/expectValue 保持不变 |
| 日志完整性 | 每次 AI 调用是否有开始/完成/失败的日志记录 |
