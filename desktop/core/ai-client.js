/**
 * ai-client.js - 统一 AI 客户端接口
 * 支持多 Provider (Ollama / OpenAI 兼容)，按优先级自动选择
 * 请求中注入 token 计数回调
 */
const http = require('http');
const https = require('https');
const logger = require('./logger');
const tokenTracker = require('./token-tracker');

const log = logger.create('AIClient');

class AIClient {
  /**
   * @param {Object} provider - Provider 配置对象
   */
  constructor(provider) {
    this.provider = provider;
    this.baseUrl = provider.baseUrl || '';
    this.apiKey = provider.apiKey || '';
    this.defaultModel = provider.defaultModel || '';
    this.timeout = 120000;
  }

  /** 解析 URL 生成连接参数 */
  _parseUrl() {
    let raw = this.baseUrl;
    if (!/^https?:\/\//i.test(raw)) {
      raw = `http://${raw}`;
    }
    const url = new URL(raw);
    return {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      protocol: url.protocol === 'https:' ? https : http,
      pathPrefix: url.pathname.replace(/\/$/, ''),
    };
  }

  /** 发送 HTTP 请求（通用） */
  _request(method, path, body, extraHeaders = {}) {
    const { hostname, port, protocol, pathPrefix } = this._parseUrl();
    return new Promise((resolve, reject) => {
      const options = {
        hostname,
        port,
        path: `${pathPrefix}${path}`,
        method,
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
      };

      const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`API 错误: ${typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error)}`));
            } else {
              resolve(parsed);
            }
          } catch {
            resolve({ response: data });
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时 (${this.timeout}ms)`));
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  /** 发送 OpenAI 兼容格式请求 */
  _openAIRequest(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return this._request(method, path, body, headers);
  }

  /** 是否为 Ollama 类型 */
  _isOllama() {
    return this.provider.type === 'ollama';
  }

  // ============ 连通性测试 ============

  /**
   * 测试 AI 服务是否可用
   * @returns {Promise<{ok: boolean, message: string, models?: string[]}>}
   */
  async ping() {
    const providerName = this.provider.name || this.baseUrl;

    if (this._isOllama()) {
      try {
        const res = await this._request('GET', '/api/tags');
        const models = Array.isArray(res.models) ? res.models.map((m) => m.name) : [];
        return {
          ok: true,
          message: models.length > 0
            ? `Ollama 服务在线，可用模型: ${models.slice(0, 5).join(', ')}${models.length > 5 ? '...' : ''}`
            : 'Ollama 服务在线，但未找到模型',
          models,
        };
      } catch (err) {
        return {
          ok: false,
          message: `Ollama 连接失败 — ${err.code === 'ECONNREFUSED' ? '请确认 Ollama 服务已启动' : err.message}`,
          models: [],
        };
      }
    }

    // OpenAI 兼容: 列模型或发轻量请求
    try {
      const body = {
        model: this.defaultModel || 'deepseek-chat',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      };
      await this._openAIRequest('POST', '/chat/completions', body);
      return { ok: true, message: `${providerName} 服务可用`, models: [] };
    } catch (err) {
      // 尝试列模型
      try {
        const res = await this._openAIRequest('GET', '/models');
        const models = Array.isArray(res.data) ? res.data.map((m) => m.id || m.name) : [];
        return { ok: true, message: `${providerName} 服务可用`, models };
      } catch {
        return {
          ok: false,
          message: `${providerName} 连接失败 — ${err.message}`,
          models: [],
        };
      }
    }
  }

  /**
   * 列出远程可用模型
   * @returns {Promise<string[]>}
   */
  async listRemoteModels() {
    if (this._isOllama()) {
      const res = await this._request('GET', '/api/tags');
      return Array.isArray(res.models) ? res.models.map((m) => m.name) : [];
    }
    try {
      const res = await this._openAIRequest('GET', '/models');
      return Array.isArray(res.data) ? res.data.map((m) => m.id || m.name) : [];
    } catch {
      return [];
    }
  }

  // ============ 文本生成 ============

  /**
   * 非流式文本生成
   * @param {string} prompt - 提示词
   * @param {Object} options - { model, system, temperature, maxTokens }
   * @returns {Promise<{response: string, usage?: Object}>}
   */
  async generate(prompt, options = {}) {
    const model = options.model || this.defaultModel;

    if (this._isOllama()) {
      const body = {
        model,
        prompt,
        system: options.system || '',
        temperature: options.temperature ?? 0.2,
        stream: false,
        options: { num_predict: options.maxTokens || 4096 },
      };
      const result = await this._request('POST', '/api/generate', body);
      const responseText = result.response || '';

      // 记录 Token 使用 (Ollama 返回中有 token 统计)
      if (result.prompt_eval_count || result.eval_count) {
        tokenTracker.recordUsage({
          providerId: this.provider.id,
          providerName: this.provider.name,
          model,
          promptTokens: result.prompt_eval_count || 0,
          completionTokens: result.eval_count || 0,
          totalTokens: (result.prompt_eval_count || 0) + (result.eval_count || 0),
        });
      }

      return { response: responseText, usage: result };
    }

    // OpenAI 兼容
    const messages = [];
    if (options.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: prompt });

    const body = {
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens || 4096,
      stream: false,
    };

    const result = await this._openAIRequest('POST', '/chat/completions', body);
    const responseText = result.choices && result.choices[0]
      ? result.choices[0].message.content
      : '';

    // 记录 Token 使用
    if (result.usage) {
      tokenTracker.recordUsage({
        providerId: this.provider.id,
        providerName: this.provider.name,
        model,
        promptTokens: result.usage.prompt_tokens || 0,
        completionTokens: result.usage.completion_tokens || 0,
        totalTokens: result.usage.total_tokens || 0,
      });
    }

    return { response: responseText, usage: result.usage };
  }

  /**
   * 流式文本生成
   * @param {string} prompt - 提示词
   * @param {Function} onChunk - 每个数据块回调 (text) => void
   * @param {Object} options - { model, system, temperature, maxTokens }
   * @returns {Promise<{response: string, usage?: Object}>}
   */
  async generateStream(prompt, onChunk, options = {}) {
    const model = options.model || this.defaultModel;

    if (this._isOllama()) {
      return this._ollamaStream(prompt, onChunk, options);
    }

    return this._openAIStream(prompt, onChunk, options);
  }

  /** Ollama 流式生成 */
  _ollamaStream(prompt, onChunk, options = {}) {
    const model = options.model || this.defaultModel;
    const { hostname, port, protocol, pathPrefix } = this._parseUrl();
    const body = JSON.stringify({
      model,
      prompt,
      system: options.system || '',
      temperature: options.temperature ?? 0.2,
      stream: true,
      options: { num_predict: options.maxTokens || 4096 },
    });

    return new Promise((resolve, reject) => {
      let fullResponse = '';
      let promptTokens = 0;
      let completionTokens = 0;

      const req = protocol.request(
        { hostname, port, path: `${pathPrefix}/api/generate`, method: 'POST',
          headers: { 'Content-Type': 'application/json' }, timeout: this.timeout },
        (res) => {
          res.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.response) {
                  fullResponse += parsed.response;
                  if (onChunk) onChunk(parsed.response);
                }
                if (parsed.done) {
                  promptTokens = parsed.prompt_eval_count || 0;
                  completionTokens = parsed.eval_count || 0;
                }
              } catch { /* skip invalid JSON lines */ }
            }
          });
          res.on('end', () => {
            // 记录 Token 使用
            tokenTracker.recordUsage({
              providerId: this.provider.id,
              providerName: this.provider.name,
              model,
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
            });
            resolve({ response: fullResponse });
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      req.write(body);
      req.end();
    });
  }

  /** OpenAI 兼容流式生成 */
  _openAIStream(prompt, onChunk, options = {}) {
    const model = options.model || this.defaultModel;
    const { hostname, port, protocol, pathPrefix } = this._parseUrl();

    const messages = [];
    if (options.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: prompt });

    const body = JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens || 4096,
      stream: true,
    });

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    return new Promise((resolve, reject) => {
      let fullResponse = '';
      let buffer = '';
      let usage = null;

      const req = protocol.request(
        { hostname, port, path: `${pathPrefix}/chat/completions`, method: 'POST',
          headers, timeout: this.timeout },
        (res) => {
          res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === 'data: [DONE]') continue;
              if (!trimmed.startsWith('data: ')) continue;
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  fullResponse += content;
                  if (onChunk) onChunk(content);
                }
                if (parsed.usage) usage = parsed.usage;
              } catch { /* skip */ }
            }
          });
          res.on('end', () => {
            if (usage) {
              tokenTracker.recordUsage({
                providerId: this.provider.id,
                providerName: this.provider.name,
                model,
                promptTokens: usage.prompt_tokens || 0,
                completionTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || 0,
              });
            }
            resolve({ response: fullResponse, usage });
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      req.write(body);
      req.end();
    });
  }
}

module.exports = { AIClient };
