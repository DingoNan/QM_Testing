/**
 * utils.js - Agent 共享工具方法
 */

/**
 * 将全局请求头合并到目标请求头中，不覆盖已有值
 * @param {Object} targetHeaders - 目标请求头
 * @param {Object} globalHeaders - 全局请求头
 * @returns {Object} 合并后的请求头
 */
function mergeGlobalHeaders(targetHeaders, globalHeaders) {
  if (!globalHeaders || Object.keys(globalHeaders).length === 0) {
    return targetHeaders || {};
  }
  const headers = { ...(targetHeaders || {}) };
  const existingLower = {};
  for (const k of Object.keys(headers)) {
    existingLower[k.toLowerCase()] = true;
  }
  for (const [hk, hv] of Object.entries(globalHeaders)) {
    if (!existingLower[hk.toLowerCase()]) {
      headers[hk] = hv;
    }
  }
  return headers;
}

module.exports = { mergeGlobalHeaders };
