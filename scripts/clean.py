#!/usr/bin/env python3
"""
QM_Testing - Clean 清洗模块 (CLI 版)
从录制 JSON 中过滤噪音、URL 归一化、去重、按时间排序、提取环境信息

用法:
  python clean.py <input.json> [--out <output.json>]
"""

import json
import sys
import os
import re
import argparse
from collections import Counter
from urllib.parse import urlparse, urljoin


# 噪音 URL 模式
NOISE_PATTERNS = [
    r'datacollect', r'collect', r'analytics', r'monitor', r'sentry',
    r'\.(css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)(\b|\?)',
    r'heartbeat', r'ping', r'alive', r'healthz', r'__webpack',
    r'hmr', r'hot-update', r'sockjs', r'livereload',
    r'favicon', r'manifest\.json', r'service-worker',
]

# 需要保留的请求头白名单
HEADER_WHITELIST = {
    'content-type', 'accept', 'authorization',
    'x-requested-with', 'x-xsrf-token', 'x-csrf-token', 'x-token', 'x-auth-token',
    'token', 'access-token', 'accesstoken', 'csrf-token',
    'cookie', 'set-cookie',
}


def is_noise(url):
    """判断是否为噪音请求"""
    for p in NOISE_PATTERNS:
        if re.search(p, url, re.IGNORECASE):
            return True
    return False


def normalize_url(path):
    """URL 归一化: 将数字 ID 替换为 {id}"""
    if not path:
        return path, {}
    params = {}
    # 替换路径中的数字段
    normalized = re.sub(r'/(\d+)([/?]|$)', lambda m: params.update({m.group(1): '{id}'}) or '/{id}' + m.group(2), path)
    return normalized, params


def extract_env_info(records):
    """从录制数据中提取环境信息"""
    domains = Counter()
    auth_types = set()
    token_paths = []

    for r in records:
        url = r.get('url', '')
        try:
            parsed = urlparse(url)
            domains[f"{parsed.scheme}://{parsed.netloc}"] += 1
        except Exception:
            continue

        req_headers = r.get('requestHeaders', {}) or {}
        req_headers_lower = {k.lower(): v for k, v in req_headers.items()}

        if 'authorization' in req_headers_lower:
            auth = req_headers_lower['authorization']
            if auth.lower().startswith('basic '):
                auth_types.add('basic')
            else:
                auth_types.add('token')
        if any(k in req_headers_lower for k in ('x-xsrf-token', 'x-csrf-token', 'x-token', 'token')):
            auth_types.add('token')
        if 'cookie' in req_headers_lower:
            cookie = req_headers_lower['cookie']
            if any(k in cookie.lower() for k in ('session', 'token', 'sid')):
                auth_types.add('cookie')

        # 检测响应中的 token 字段
        resp_body = r.get('responseBody')
        if resp_body and isinstance(resp_body, str):
            try:
                resp_obj = json.loads(resp_body) if isinstance(resp_body, str) else resp_body
                token_paths.extend(find_token_paths(resp_obj, ''))
            except (json.JSONDecodeError, TypeError):
                pass
        elif resp_body and isinstance(resp_body, dict):
            token_paths.extend(find_token_paths(resp_body, ''))

    top_domains = domains.most_common()
    auth_type = 'none'
    if 'token' in auth_types:
        auth_type = 'token'
    elif 'cookie' in auth_types:
        auth_type = 'cookie'
    elif 'basic' in auth_types:
        auth_type = 'basic'

    return {
        'baseURL': top_domains[0][0] if top_domains else '',
        'authType': auth_type,
        'domains': [{'domain': d, 'count': c} for d, c in top_domains],
        'authConfig': {
            'tokenPath': token_paths[0] if token_paths else '',
            'loginEndpoint': '',
            'globalHeaders': {},
        },
    }


def find_token_paths(obj, prefix):
    """递归查找可能的 token 字段路径"""
    paths = []
    token_keys = {'token', 'access_token', 'accessToken', 'refresh_token', 'refreshToken',
                  'sessionId', 'session_id', 'sid', 'jwt', 'id_token'}
    if isinstance(obj, dict):
        for k, v in obj.items():
            current_path = f"{prefix}.{k}" if prefix else k
            if k in token_keys and isinstance(v, str) and len(v) > 8:
                paths.append(current_path)
            paths.extend(find_token_paths(v, current_path))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            paths.extend(find_token_paths(item, f"{prefix}[{i}]"))
    return paths


def clean_records(records):
    """主清洗逻辑: 过滤 → 归一化去重 → 排序 → 重编号"""
    if not records:
        return [], {}

    # 1. 噪音过滤
    filtered = [r for r in records if not is_noise(r.get('url', ''))]
    noise_count = len(records) - len(filtered)

    # 2. URL 归一化 + 去重
    seen = set()
    deduped = []
    norm_params = {}
    for r in filtered:
        url = r.get('url', '')
        method = r.get('method', 'GET')
        path = urlparse(url).path
        norm_path, params = normalize_url(path)
        norm_params[url] = params
        dedup_key = (method, norm_path)

        # 保留第一个出现的记录
        if dedup_key not in seen:
            seen.add(dedup_key)
            r['_normalizedPath'] = norm_path
            deduped.append(r)
        # 如果已存在但 body 不同也保留
        else:
            existing = next((x for x in deduped if x.get('_normalizedPath') == norm_path and x.get('method') == method), None)
            if existing and json.dumps(r.get('requestBody', {}), sort_keys=True) != json.dumps(existing.get('requestBody', {}), sort_keys=True):
                r['_normalizedPath'] = norm_path
                r['_duplicatedMethod'] = True
                deduped.append(r)

    dedup_count = len(filtered) - len([r for r in deduped if not r.get('_duplicatedMethod')])

    # 3. 按时间排序
    def sort_key(r):
        t = r.get('timestamp') or 0
        if not t:
            try:
                from datetime import datetime
                t = datetime.fromisoformat(r.get('time', '2020-01-01')).timestamp()
            except Exception:
                t = 0
        return t

    deduped.sort(key=sort_key)

    # 4. 重编号
    for i, r in enumerate(deduped, 1):
        r['seq'] = i
        # 清除内部字段
        r['_normalizedPath'] = r.get('_normalizedPath', urlparse(r.get('url', '')).path)
        r.pop('_duplicatedMethod', None)

    # 5. 提取环境信息
    env_info = extract_env_info(deduped)

    return deduped, env_info, {'noise_filtered': noise_count, 'dedup_count': dedup_count}


def main():
    parser = argparse.ArgumentParser(description='QM_Testing - 数据清洗')
    parser.add_argument('input', help='录制 JSON 文件路径')
    parser.add_argument('--out', '-o', default='', help='输出文件路径')
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"错误: 文件不存在 {args.input}", file=sys.stderr)
        sys.exit(1)

    with open(args.input, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    # 支持多场景格式
    if isinstance(raw, list):
        records = raw
    elif isinstance(raw, dict):
        records = raw.get('records') or raw.get('scenarios', [])
        if records and isinstance(records[0], dict) and 'records' in records[0]:
            # 多场景格式
            all_records = []
            for s in records:
                all_records.extend(s.get('records', []))
            records = all_records
    else:
        records = []

    if not records:
        print("错误: 未找到录制数据", file=sys.stderr)
        sys.exit(1)

    print(f"输入记录数: {len(records)}")
    cleaned_records, env_info, stats = clean_records(records)
    print(f"噪音过滤: {stats['noise_filtered']} | 去重: {stats['dedup_count']} | 输出: {len(cleaned_records)}")

    out_path = args.out or os.path.join(os.path.dirname(args.input) or '.', 'cleaned.json')
    output = {
        'records': cleaned_records,
        'stats': {'total': len(cleaned_records), 'noise_filtered': stats['noise_filtered'], 'dedup_count': stats['dedup_count']},
        '_envInfo': env_info,
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"已输出: {out_path}")
    if env_info['baseURL']:
        print(f"检测域名: {env_info['baseURL']}")
        print(f"认证方式: {env_info['authType']}")


if __name__ == '__main__':
    main()
