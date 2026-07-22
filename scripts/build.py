#!/usr/bin/env python3
"""
QM_Testing - Build 用例拼装模块 (CLI 版)
将关联后的记录拼装为 CaseVo 标准格式, 添加默认断言

用法:
  python build.py <linked.json> [--out <case-save.json>] [--project-id <id>] [--env <0|1|2|3>]
"""

import json
import sys
import os
import re
import argparse
from urllib.parse import urlparse
from datetime import datetime


# 需要保留的请求头白名单
HEADER_WHITELIST = {
    'content-type', 'accept', 'authorization', 'x-xsrf-token',
    'x-csrf-token', 'x-token', 'x-auth-token', 'token', 'access-token', 'accesstoken',
    'csrf-token', 'cookie', 'x-requested-with', 'set-cookie',
}

# 环境类型
ENV_MAP = {0: 'DEV', 1: 'TEST', 2: 'PRE', 3: 'PROD'}


def infer_api_name(method, url):
    """从 URL 路径推断接口名称"""
    try:
        parsed = urlparse(url)
        path = parsed.path.rstrip('/')
        segments = [s for s in path.split('/') if s and not s.startswith('${') and not s.startswith('{')]

        if not segments:
            return method.upper()

        # 取最后 1-2 个有意义的片段
        meaningful = [s for s in segments if not re.match(r'^\d+$', s)]
        if len(meaningful) >= 2:
            name = ' '.join(meaningful[-2:]).replace('-', ' ').replace('_', ' ').title()
        elif meaningful:
            name = meaningful[-1].replace('-', ' ').replace('_', ' ').title()
        else:
            name = segments[-1]

        return f"{method.upper()} {name}"
    except Exception:
        return method.upper()


def build_case_vo(records, project_id=1, environment=1):
    """构建 CaseVo 标准格式"""
    if not records:
        return None

    # 收集域名
    domains = set()
    for r in records:
        try:
            parsed = urlparse(r.get('url', ''))
            if parsed.netloc:
                domains.add(f"{parsed.scheme}://{parsed.netloc}")
            elif parsed.path and r.get('env_host'):
                domains.add(r['env_host'])
        except Exception:
            pass

    domain_name = list(domains)[0] if domains else ''
    first_record = records[0]

    api_vos = []
    for r in records:
        url = r.get('url', '')
        path = urlparse(url).path if url else '/'

        # 整理请求头
        req_headers = r.get('requestHeaders', {}) or {}
        filtered_headers = {k: v for k, v in req_headers.items()
                           if k.lower() in HEADER_WHITELIST}

        # 请求体
        req_body = r.get('requestBody')

        # 默认断言: code == 0
        assert_vos = [
            {'expression': 'code === 0', 'expect': 'true', 'param': 'code'},
            {'expression': 'status === 200', 'expect': 'true', 'param': ''},
        ]

        # 检查响应是否有 data 非空
        resp_body = r.get('responseBody')
        if resp_body:
            obj = resp_body
            if isinstance(obj, str):
                try:
                    obj = json.loads(obj)
                except (json.JSONDecodeError, TypeError):
                    obj = None
            if isinstance(obj, dict):
                if 'data' in obj and obj['data'] is not None:
                    assert_vos.append({'expression': 'data !== null', 'expect': 'true', 'param': 'data'})

        api_vo = {
            'caseId': 0,
            'orderNum': r.get('seq', 0),
            'apiName': infer_api_name(r.get('method', 'GET'), url),
            'apiMethod': r.get('method', 'GET').upper(),
            'apiUrl': path,
            'domainName': domain_name,
            'requestHeaders': json.dumps(filtered_headers, ensure_ascii=False),
            'requestBody': req_body if isinstance(req_body, str) else json.dumps(req_body, ensure_ascii=False) if req_body else '',
            'contentType': r.get('contentType', 'application/json'),
            'timeout': 30000,
            'assertVos': assert_vos,
            'extractVos': [],
        }
        api_vos.append(api_vo)

    # 用例名称
    name = infer_api_name(records[0].get('method', ''), records[0].get('url', ''))
    if len(api_vos) > 1:
        name = f"{name} 等 {len(api_vos)} 个接口"

    case_vo = {
        'name': name,
        'type': 1,
        'projectId': project_id,
        'environment': environment,
        'domainName': domain_name,
        'apiCount': len(api_vos),
        'apiVos': api_vos,
    }

    return case_vo


def main():
    parser = argparse.ArgumentParser(description='QM_Testing - 用例拼装')
    parser.add_argument('input', help='关联后的 JSON 文件路径')
    parser.add_argument('--out', '-o', default='', help='输出文件路径')
    parser.add_argument('--project-id', type=int, default=1, help='项目 ID')
    parser.add_argument('--env', type=int, default=1, choices=[0, 1, 2, 3], help='环境 (0=DEV, 1=TEST, 2=PRE, 3=PROD)')
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"错误: 文件不存在 {args.input}", file=sys.stderr)
        sys.exit(1)

    with open(args.input, 'r', encoding='utf-8') as f:
        data = json.load(f)

    records = data.get('records', data) if isinstance(data, dict) else data
    if not records:
        print("错误: 未找到记录数据", file=sys.stderr)
        sys.exit(1)

    print(f"输入记录数: {len(records)}")

    case_vo = build_case_vo(records, project_id=args.project_id, environment=args.env)
    if not case_vo:
        print("错误: 生成的用例为空", file=sys.stderr)
        sys.exit(1)

    print(f"用例名称: {case_vo['name']}")
    print(f"接口数: {case_vo['apiCount']}")
    print(f"环境: {ENV_MAP.get(args.env, 'TEST')}")

    out_path = args.out or os.path.join(os.path.dirname(args.input) or '.', 'case-save.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(case_vo, f, ensure_ascii=False, indent=2)

    print(f"已输出: {out_path}")


if __name__ == '__main__':
    main()
