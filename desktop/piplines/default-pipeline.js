/**
 * default-pipeline.js - 默认处理管道
 * 只包含 4 个处理阶段：Cleaner → Env Analyzer → Linker → Assembler
 * 后续阶段（审查/回归/导出）为独立页面
 */
module.exports = {
  name: 'default',
  description: '标准 API 测试用例处理管道（4阶段，支持数据驱动）',
  stages: [
    {
      name: '数据清洗',
      agent: 'cleaner',
      agentId: 'cleaner',
      description: '过滤噪音、去重、重编号，提取基础环境信息',
      required: true,
      inputFrom: null,
      inputFile: null,
      outputFile: 'cleaned.json',
    },
    {
      name: '环境识别',
      agent: 'env-analyzer',
      agentId: 'env-analyzer',
      description: '自动推断测试环境，提取 baseURL、认证方式、token 路径',
      required: false,
      inputFrom: 'cleaner_output',
      inputFile: 'cleaned.json',
      outputFile: 'env-config.json',
      needsUserInput: true,
    },
    {
      name: '跨接口关联',
      agent: 'linker',
      agentId: 'linker',
      description: '利用环境信息和响应值索引，自动替换 token/ID 引用；支持手动关联与串联规则',
      required: true,
      inputFrom: 'env-analyzer_output',
      inputFile: 'cleaned.json',
      outputFile: 'linked.json',
    },
    {
      name: '用例拼装',
      agent: 'assembler',
      agentId: 'assembler',
      description: '构建 CaseVo 标准格式，添加默认断言；支持数据驱动展开模式',
      required: true,
      inputFrom: 'linker_output',
      inputFile: 'linked.json',
      outputFile: 'case-save.json',
      config: {
        dataBinding: {},        // 数据绑定配置（数据池字段→接口参数映射）
        iterationMode: 'none',  // 'none' | 'expand' | 'loop'
        deployment: {},         // 数据分片配置
      },
    },
  ],
};
