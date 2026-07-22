/**
 * linker.js - Agent-2: 跨接口字段关联
 * 功能：响应值索引构建、自动替换 token/ID 引用、鉴权字段强制关联
 */

const { BaseAgent } = require('./base-agent');
const { mergeGlobalHeaders } = require('./utils');
const { ChainRule } = require('../models/ChainRule');
const path = require('path');

const logger = require('../core/logger');
const log = logger.create('Linker');

class LinkerAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      id: 'linker',
      name: '跨接口关联',
      description: '自动识别接口间的字段依赖并替换',
      ...opts,
    });
    this._authHeaderNames = new Set([
      'token', 'authorization', 'x-csrf-token', 'x-xsrf-token',
      'x-token', 'x-auth-token', 'access-token', 'accesstoken',
      'cookie', 'csrf-token',
    ]);
  }

  async execute(input) {
    this._updateProgress(0, '开始跨接口关联...');
    log.info('开始跨接口关联');

    const records = input.data || [];
    const envConfig = input.envConfig || {};
    if (!records || records.length === 0) {
      log.warn('输入数据为空');
      throw new Error('输入数据为空');
    }

    this._updateProgress(10, `共 ${records.length} 个接口待关联`);
    log.info(`共 ${records.length} 个接口待关联`);

    // 应用全局请求头（环境配置）
    const globalHeaders = envConfig.globalHeaders || {};
    if (Object.keys(globalHeaders).length > 0) {
      for (const r of records) {
        r.requestHeaders = mergeGlobalHeaders(r.requestHeaders, globalHeaders);
      }
      this._updateProgress(12, `注入 ${Object.keys(globalHeaders).length} 个全局请求头`);
    }

    // Step 1: 建响应值索引
    const index = this._buildResponseIndex(records);
    this._updateProgress(30, `响应值索引: ${Object.keys(index).length} 条候选`);

    // Step 2: 逐个接口替换
    const allDeps = [];
    const linked = [];

    for (const r of records) {
      const newRec = { ...r };
      const seq = r.seq;

      // 替换 URL path 中的 ID
      const urlResult = this._replaceInUrlPath(r.url, index, seq, r.domain || '');
      newRec.url = urlResult.url;
      allDeps.push(...urlResult.deps);

      // 替换 requestBody
      if (r.requestBody && typeof r.requestBody === 'object') {
        const bodyResult = this._walkAndReplace(r.requestBody, index, seq);
        newRec.requestBody = bodyResult.data;
        allDeps.push(...bodyResult.deps);
      }

      // 替换 requestHeaders (仅 token/authorization 等鉴权字段)
      const headerResult = this._replaceHeaders(r.requestHeaders || {}, index, seq);
      newRec.requestHeaders = headerResult.headers;
      allDeps.push(...headerResult.deps);

      linked.push(newRec);
    }

    this._updateProgress(60, `自动替换完成，共 ${allDeps.length} 处依赖`);

    // Step 3: 鉴权字段强制替换
    const authSources = this._findAuthSources(records);
    if (Object.keys(authSources).length > 0) {
      const authDeps = this._forceReplaceAuthHeaders(linked, authSources);
      allDeps.push(...authDeps);
      this._updateProgress(65, `强制替换鉴权 header: ${authDeps.length} 处`);
    }

    // Step 3.5: 应用手动关联规则
    const manualDeps = input.manualDeps || [];
    if (manualDeps.length > 0) {
      this._updateProgress(68, `应用 ${manualDeps.length} 条手动关联规则`);
      const manualResults = this._applyManualDeps(linked, manualDeps);
      allDeps.push(...manualResults.deps);
      this._updateProgress(70, `手动关联完成，新增 ${manualResults.deps.length} 处依赖`);
    }

    // Step 3.6: 应用串联规则 (ChainRule)
    const chainRules = input.chainRules || [];
    if (chainRules.length > 0) {
      this._updateProgress(72, `应用 ${chainRules.length} 条串联规则`);
      for (const ruleConfig of chainRules) {
        const rule = ruleConfig instanceof ChainRule ? ruleConfig : new ChainRule(ruleConfig);
        if (rule.enabled) {
          allDeps.push({
            from_seq: rule.sourceApiSeq,
            from_path: rule.sourcePath,
            to_seq: rule.targetApiSeq,
            to_location: rule.targetLocation,
            match_type: 'chain_rule',
            rule_name: rule.name,
          });
        }
      }
      this._updateProgress(75, `串联规则完成，新增 ${chainRules.length} 条规则`);
    }

    // Step 4: 构建依赖图
    const depsGraph = this._buildDepsGraph(allDeps, linked);

    this._updateProgress(80, '依赖图构建完成');

    // 写入文件
    const linkedPath = this._writeJSON(
      path.join(this.outDir, 'linked.json'), linked
    );
    const depsPath = this._writeJSON(
      path.join(this.outDir, 'deps.json'), allDeps
    );
    const graphPath = this._writeJSON(
      path.join(this.outDir, 'deps-graph.json'), depsGraph
    );

    // 统计
    const stats = {
      totalRecords: linked.length,
      totalDeps: allDeps.length,
      bySeq: {},
    };
    for (const d of allDeps) {
      const key = `seq_${d.from_seq}`;
      stats.bySeq[key] = (stats.bySeq[key] || 0) + 1;
    }

    this._updateProgress(100, '跨接口关联完成');
    log.info(`跨接口关联完成: ${linked.length} 个接口, ${allDeps.length} 处依赖`);

    return {
      records: linked,
      deps: allDeps,
      depsGraph: depsGraph,
      stats,
      outputFiles: {
        linked: linkedPath,
        deps: depsPath,
        graph: graphPath,
      },
    };
  }

  _buildResponseIndex(records) {
    /**
     * 增强的响应值索引策略:
     * 1. 精确值索引: value -> [{seq, path}] (多候选, 按 seq 降序)
     * 2. 子串索引: 为长字符串构建子串匹配
     * 3. 类型感知: 区分 "200"(string) 和 200(number)
     * 4. token 字段优先索引
     */
    const exactIndex = {};  // "type::key" -> [{seq, path}]
    const subStrIndex = {}; // 子串 -> [{seq, path}]

    for (const r of records) {
      // ---- 索引响应体 ----
      const resp = this._parseBody(r.responseBody);
      if (resp) {
        for (const [path, value] of this._walkJson(resp, 'responseBody')) {
          if (!this._isMeaningfulValue(value)) continue;

          const type = typeof value;
          const key = `${type}::${String(value)}`;

          if (!exactIndex[key]) exactIndex[key] = [];
          exactIndex[key].push({ seq: r.seq, path, value });

          const strVal = String(value);
          if (strVal.length > 20 && strVal.length < 200) {
            const suffix = strVal.slice(-16);
            if (!subStrIndex[suffix]) subStrIndex[suffix] = [];
            subStrIndex[suffix].push({ seq: r.seq, path, value: strVal });
          }

          const fieldName = path.split('.').pop().toLowerCase();
          if (['token', 'authorization', 'access_token', 'sessionid', 'sid',
              'x_auth_token', 'x-auth-token', 'refresh_token', 'jwt',
              'accesstoken', 'csrf-token', 'accessToken', 'refreshToken',
              'sessionId', 'session_id'].includes(fieldName)) {
            const authKey = `__auth__::${strVal}`;
            if (!exactIndex[authKey]) exactIndex[authKey] = [];
            exactIndex[authKey].push({ seq: r.seq, path, value: strVal });
          }
        }
      }

      // ---- 索引响应头（Set-Cookie / Authorization 等）----
      const resHeaders = r.responseHeaders || {};
      for (const [hdrName, hdrValue] of Object.entries(resHeaders)) {
        const hdrNameLower = hdrName.toLowerCase();
        const strVal = typeof hdrValue === 'string' ? hdrValue : String(hdrValue || '');
        if (!strVal || strVal.length < 3) continue;

        // 索引 Set-Cookie 的每个 cookie 键值对
        if (hdrNameLower === 'set-cookie') {
          // 可能有多条 Set-Cookie，以数组或分号分隔
          const cookieStrs = Array.isArray(hdrValue) ? hdrValue : [strVal];
          for (const cookieStr of cookieStrs) {
            // 提取第一个 cookie name=value
            const parts = String(cookieStr).split(';')[0].trim();
            const eqIdx = parts.indexOf('=');
            if (eqIdx > 0) {
              const cookieName = parts.slice(0, eqIdx).trim();
              const cookieVal = parts.slice(eqIdx + 1).trim();
              // 索引整个 cookie 值
              const cookieKey = `string::${cookieVal}`;
              if (!exactIndex[cookieKey]) exactIndex[cookieKey] = [];
              exactIndex[cookieKey].push({ seq: r.seq, path: `responseHeaders.Set-Cookie.${cookieName}`, value: cookieVal });
              // 也以 auth key 索引
              const authKey = `__auth__::${cookieVal}`;
              if (!exactIndex[authKey]) exactIndex[authKey] = [];
              exactIndex[authKey].push({ seq: r.seq, path: `responseHeaders.Set-Cookie.${cookieName}`, value: cookieVal });
            }
          }
        } else if (['authorization', 'token', 'x-auth-token', 'x-token', 'x-csrf-token', 'x-xsrf-token'].includes(hdrNameLower)) {
          // 索引认证响应头的值
          const authKey = `__auth__::${strVal}`;
          if (!exactIndex[authKey]) exactIndex[authKey] = [];
          exactIndex[authKey].push({ seq: r.seq, path: `responseHeaders.${hdrName}`, value: strVal });
        }

        // 对所有有意义的非空值也建普通索引
        if (strVal.length >= 8 && strVal.length < 500 && !/^\d+$/.test(strVal)) {
          const valKey = `string::${strVal}`;
          if (!exactIndex[valKey]) exactIndex[valKey] = [];
          exactIndex[valKey].push({ seq: r.seq, path: `responseHeaders.${hdrName}`, value: strVal });
        }
      }
    }

    // 每个候选列表按 seq 降序排列 (最近的 seq 优先)
    for (const key of Object.keys(exactIndex)) {
      exactIndex[key].sort((a, b) => b.seq - a.seq);
    }
    for (const key of Object.keys(subStrIndex)) {
      subStrIndex[key].sort((a, b) => b.seq - a.seq);
    }

    return { exact: exactIndex, subStr: subStrIndex };
  }

  _isMeaningfulValue(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return false;
    if (typeof value === 'string') {
      if (value.length < 3) return false;
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
      if (['true', 'false', 'null', 'success', 'fail', 'ok', 'error'].includes(value.toLowerCase())) return false;
      return true;
    }
    if (typeof value === 'number') {
      if ([0, 1, 2, 100, 200, 201, 400, 401, 403, 404, 500].includes(value)) return false;
      if (value < 100) return false;
      return true;
    }
    return false;
  }

  *_walkJson(obj, path) {
    if (typeof obj !== 'object' || obj === null) {
      yield [path, obj];
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        yield* this._walkJson(obj[i], `${path}[${i}]`);
      }
    } else {
      for (const [k, v] of Object.entries(obj)) {
        const newPath = path ? `${path}.${k}` : k;
        yield* this._walkJson(v, newPath);
      }
    }
  }

  _parseBody(body) {
    if (!body) return null;
    if (typeof body === 'object') return body;
    try { return JSON.parse(body); } catch { return null; }
  }

  /**
   * 从索引中查找值的最佳匹配候选
   * @param {Object} index - 响应值索引 { exact, subStr }
   * @param {*} value - 要查找的值
   * @param {number} currentSeq - 当前请求序号
   * @returns {{seq: number, path: string}|null}
   */
  _lookupValue(index, value, currentSeq) {
    if (!index || !index.exact) return null;
    const strVal = String(value);
    const type = typeof value;

    // 1. 精确匹配 (类型感知)
    const exactKey = `${type}::${strVal}`;
    const exactCandidates = index.exact[exactKey];
    if (exactCandidates) {
      // 已按 seq 降序排列，取第一个小于 currentSeq 的
      const best = exactCandidates.find(c => c.seq < currentSeq);
      if (best) return best;
    }

    // 2. 尝试 auth 索引
    const authKey = `__auth__::${strVal}`;
    const authCandidates = index.exact[authKey];
    if (authCandidates) {
      const best = authCandidates.find(c => c.seq < currentSeq);
      if (best) return best;
    }

    // 3. 尝试无类型精确匹配 (兼容旧数据)
    const fallbackKey = `string::${strVal}`;
    if (fallbackKey !== exactKey) {
      const fallbackCandidates = index.exact[fallbackKey];
      if (fallbackCandidates) {
        const best = fallbackCandidates.find(c => c.seq < currentSeq);
        if (best) return best;
      }
    }

    // 4. 子串匹配 (长字符串的后 16 位)
    if (strVal.length >= 16 && index.subStr) {
      const suffix = strVal.slice(-16);
      const subCandidates = index.subStr[suffix];
      if (subCandidates) {
        const best = subCandidates.find(c => c.seq < currentSeq);
        if (best) return best;
      }
    }

    return null;
  }

  _replaceInUrlPath(url, index, currentSeq, domain) {
    const deps = [];
    try {
      const u = new URL(url);
      let newPath = u.pathname;
      newPath = newPath.replace(/\/(\d{3,})(?=\/|$)/g, (match, num) => {
        const src = this._lookupValue(index, parseInt(num, 10), currentSeq);
        if (src) {
          deps.push({
            from_seq: src.seq,
            from_path: src.path,
            to_seq: currentSeq,
            to_location: 'url',
            original_value: num,
            match_type: 'url_id',
          });
          return '/' + '${seq.' + src.seq + '.' + src.path + '}';
        }
        return match;
      });
      return {
        url: u.origin + newPath + (u.search || ''),
        deps,
      };
    } catch {
      return { url, deps };
    }
  }

  _walkAndReplace(data, index, currentSeq, pathPrefix) {
    if (!pathPrefix) pathPrefix = 'requestBody';
    if (typeof data !== 'object' || data === null) {
      // 叶子值
      if (this._isMeaningfulValue(data)) {
        const src = this._lookupValue(index, data, currentSeq);
        if (src) {
          const expr = '${seq.' + src.seq + '.' + src.path + '}';
          return {
            data: expr,
            deps: [{
              from_seq: src.seq,
              from_path: src.path,
              to_seq: currentSeq,
              to_location: pathPrefix,
              original_value: String(data),
              match_type: 'value',
            }],
          };
        }
      }
      return { data, deps: [] };
    }

    if (Array.isArray(data)) {
      const newArr = [];
      const allDeps = [];
      for (let i = 0; i < data.length; i++) {
        const result = this._walkAndReplace(data[i], index, currentSeq, pathPrefix + '[' + i + ']');
        newArr.push(result.data);
        allDeps.push(...result.deps);
      }
      return { data: newArr, deps: allDeps };
    }

    const newObj = {};
    const allDeps = [];
    for (const [k, v] of Object.entries(data)) {
      const result = this._walkAndReplace(v, index, currentSeq, pathPrefix + '.' + k);
      newObj[k] = result.data;
      allDeps.push(...result.deps);
    }
    return { data: newObj, deps: allDeps };
  }

 _replaceHeaders(headers, index, currentSeq) {
    const newHeaders = { ...headers };
    const deps = [];
    for (const [k, v] of Object.entries(headers)) {
      if (!this._authHeaderNames.has(k.toLowerCase())) continue;
      if (typeof v === 'string') {
        // 尝试完整值匹配
        let src = this._lookupValue(index, v, currentSeq);
        // 如果完整值未匹配，尝试去掉 "Bearer " 前缀后匹配
        if (!src && v.startsWith('Bearer ')) {
          const token = v.slice(7);
          src = this._lookupValue(index, token, currentSeq);
        }
        // 对于 Cookie header，尝试逐个 cookie 值匹配
        if (!src && k.toLowerCase() === 'cookie') {
          const pairs = v.split(';');
          for (const pair of pairs) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx > 0) {
              const cookieVal = pair.slice(eqIdx + 1).trim();
              src = this._lookupValue(index, cookieVal, currentSeq);
              if (src) break;
            }
          }
        }
        if (src) {
          // 保留 auth header 值的前缀（如 "Bearer "），替换时只替换值本身
          let prefix = '';
          if (v.startsWith('Bearer ')) {
            prefix = 'Bearer ';
          }
          newHeaders[k] = prefix + '${seq.' + src.seq + '.' + src.path + '}';
          deps.push({
            from_seq: src.seq,
            from_path: src.path,
            to_seq: currentSeq,
            to_location: 'requestHeaders.' + k,
            original_value: v.slice(0, 80),
            match_type: 'header_value',
          });
        }
      }
    }
    return { headers: newHeaders, deps };
  }

  _findAuthSources(records) {
    const sources = {};
    const authNames = new Set(['token', 'authorization', 'x-csrf-token', 'x-xsrf-token', 'x-token', 'x-auth-token', 'access-token', 'accesstoken', 'csrf-token']);
    for (const r of records) {
      // 从响应体中查找
      const resp = this._parseBody(r.responseBody);
      if (resp) {
        for (const [path, value] of this._walkJson(resp, 'responseBody')) {
          if (typeof value !== 'string' || !value) continue;
          const lastSeg = path.split('.').pop().split('[')[0].toLowerCase();
          if (authNames.has(lastSeg) && !(lastSeg in sources)) {
            sources[lastSeg] = { seq: r.seq, path };
          }
        }
      }

      // 从响应头中查找（Set-Cookie 映射到 cookie）
      const resHeaders = r.responseHeaders || {};
      for (const [hdrName, hdrValue] of Object.entries(resHeaders)) {
        const hdrLower = hdrName.toLowerCase();
        if (hdrLower === 'set-cookie') {
          const cookieStrs = Array.isArray(hdrValue) ? hdrValue : [String(hdrValue || '')];
          for (const cookieStr of cookieStrs) {
            const parts = String(cookieStr).split(';')[0].trim();
            const eqIdx = parts.indexOf('=');
            if (eqIdx > 0) {
              const cookieName = parts.slice(0, eqIdx).trim().toLowerCase();
              // 映射 Set-Cookie 中的 cookie 名到 auth source
              if (authNames.has(cookieName) && !('cookie' in sources)) {
                sources['cookie'] = { seq: r.seq, path: `responseHeaders.Set-Cookie.${cookieName}` };
              }
            }
          }
        } else if (authNames.has(hdrLower) && !(hdrLower in sources)) {
          sources[hdrLower] = { seq: r.seq, path: `responseHeaders.${hdrName}` };
        }
      }
    }
    return sources;
  }

  _forceReplaceAuthHeaders(records, sources) {
    const deps = [];
    for (const r of records) {
      const headers = r.requestHeaders || {};
      for (const k of Object.keys(headers)) {
        const kLower = k.toLowerCase();
        if (!(kLower in sources)) continue;
        const src = sources[kLower];
        if (src.seq >= r.seq) continue;
        const oldVal = headers[k];
        // 保留 auth header 值的前缀（如 "Bearer "），替换时只替换值本身
        let fPrefix = '';
        if (String(oldVal).startsWith('Bearer ')) {
          fPrefix = 'Bearer ';
        }
        headers[k] = fPrefix + `\${seq.${src.seq}.${src.path}}`;
        if (oldVal !== headers[k]) {
          deps.push({
            from_seq: src.seq,
            from_path: src.path,
            to_seq: r.seq,
            to_location: `requestHeaders.${k}`,
            original_value: String(oldVal).slice(0, 80),
            match_type: 'force_auth',
          });
        }
      }
    }
    return deps;
  }

  /**
   * 应用手动关联规则
   * @param {Object[]} records - 已关联的记录
   * @param {Object[]} manualDeps - 手动关联规则
   * @returns {{deps: Object[]}}
   */
  _applyManualDeps(records, manualDeps) {
    const deps = [];
    for (const md of manualDeps) {
      const target = records.find(r => r.seq === md.toSeq);
      if (!target) {
        log.warn(`手动关联: 目标接口 seq=${md.toSeq} 不存在`);
        continue;
      }

      const expr = `\${seq.${md.fromSeq}.${md.fromPath}}`;
      const loc = md.toLocation || '';

      // 解析位置并赋值
      if (loc.startsWith('requestHeaders.')) {
        const headerName = loc.slice('requestHeaders.'.length);
        if (!target.requestHeaders) target.requestHeaders = {};
        const oldVal = target.requestHeaders[headerName];
        target.requestHeaders[headerName] = expr;
        deps.push({
          from_seq: md.fromSeq,
          from_path: md.fromPath,
          to_seq: md.toSeq,
          to_location: loc,
          original_value: String(oldVal || '').slice(0, 80),
          match_type: 'manual',
        });
      } else if (loc.startsWith('requestBody.')) {
        const bodyPath = loc.slice('requestBody.'.length);
        if (!target.requestBody || typeof target.requestBody !== 'object') {
          target.requestBody = {};
        }
        this._setNestedValue(target.requestBody, bodyPath, expr);
        deps.push({
          from_seq: md.fromSeq,
          from_path: md.fromPath,
          to_seq: md.toSeq,
          to_location: loc,
          original_value: '',
          match_type: 'manual',
        });
      } else if (loc === 'url') {
        target.url = expr;
        deps.push({
          from_seq: md.fromSeq,
          from_path: md.fromPath,
          to_seq: md.toSeq,
          to_location: 'url',
          original_value: target.url || '',
          match_type: 'manual',
        });
      }
    }
    return { deps };
  }

  /**
   * 在嵌套对象中按路径设置值
   */
  _setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    const lastKey = parts[parts.length - 1];
    current[lastKey] = value;
  }

  _buildDepsGraph(allDeps, records) {
    // 按接口分组，找出每个接口被依赖的次数
    const providedBy = {}; // seq -> {提供者 seq, 路径列表}
    const dependsOn = {};  // seq -> 依赖的 seq 列表

    for (const d of allDeps) {
      const from = d.from_seq;
      const to = d.to_seq;

      if (!providedBy[from]) providedBy[from] = { seq: from, provided: [] };
      providedBy[from].provided.push({
        to_seq: to,
        from_path: d.from_path,
        to_location: d.to_location,
      });

      if (!dependsOn[to]) dependsOn[to] = { seq: to, depends: [] };
      dependsOn[to].depends.push({
        from_seq: from,
        from_path: d.from_path,
        to_location: d.to_location,
      });
    }

    // 孤立接口（无上下游关联）
    const allSeqs = new Set(records.map((r) => r.seq));
    const hasDeps = new Set([...allDeps.map((d) => d.from_seq), ...allDeps.map((d) => d.to_seq)]);
    const isolated = [...allSeqs].filter((s) => !hasDeps.has(s)).sort((a, b) => a - b);

    return {
      nodes: records.map((r) => ({ seq: r.seq, method: r.method, path: r.path })),
      edges: allDeps.map((d) => ({
        from: d.from_seq,
        to: d.to_seq,
        fromPath: d.from_path,
        toLocation: d.to_location,
        matchType: d.match_type,
      })),
      providers: Object.values(providedBy),
      dependents: Object.values(dependsOn),
      isolatedSeqs: isolated,
    };
  }
}

module.exports = { LinkerAgent };
