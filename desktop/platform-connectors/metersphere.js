/**
 * metersphere.js - MeterSphere 平台连接器
 */

const { BaseConnector } = require('./base-connector');
const https = require('https');
const http = require('http');

class MeterSphereConnector extends BaseConnector {
  constructor(opts = {}) {
    super({ name: 'MeterSphere', ...opts });
  }

  async importCase(caseVo, auth) {
    const url = `${this.baseURL}/caseImport/saveOne`;
    const body = JSON.stringify(caseVo);

    const response = await this._request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth.token || '',
      },
      body,
    });

    return {
      success: response.code === 0 || response.success === true,
      caseId: response.data?.id || response.data || '',
      message: response.msg || response.message || '',
      response,
    };
  }

  async listProjects(auth) {
    const url = `${this.baseURL}/project/listAll`;
    const response = await this._request(url, {
      method: 'GET',
      headers: { 'Authorization': auth.token || '' },
    });

    return (response.data || response || []).map((p) => ({
      id: p.id,
      name: p.name,
    }));
  }

  async _request(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const options = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: opts.headers || {},
        timeout: 30000,
      };

      const req = mod.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data, code: res.statusCode });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });

      if (opts.body) req.write(opts.body);
      req.end();
    });
  }
}

module.exports = { MeterSphereConnector };
