#!/usr/bin/env python3
"""
QM_Testing - Import 平台导入模块 (CLI 版)
将 CaseVo 导入到 MeterSphere 或兼容平台

用法:
  python import.py <case-save.json> --url <platform-url> --token <api-token>
                   [--project-id <id>] [--env <0|1|2|3>]
"""

import json
import sys
import os
import argparse
import urllib.request
import urllib.error
import ssl


ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE


def import_to_metersphere(case_vo, base_url, token):
    """导入到 MeterSphere 平台"""
    url = f"{base_url.rstrip('/')}/caseImport/saveOne"

    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }
    if token:
        headers['Authorization'] = token

    data = json.dumps(case_vo, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')

    try:
        resp = urllib.request.urlopen(req, context=ssl_ctx, timeout=60)
        result = json.loads(resp.read().decode('utf-8'))
        return {'success': True, 'data': result, 'status': resp.status}
    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read().decode('utf-8'))
        except Exception:
            err_body = str(e)
        return {'success': False, 'error': err_body, 'status': e.code}
    except Exception as e:
        return {'success': False, 'error': str(e), 'status': 0}


def list_projects(base_url, token):
    """获取平台项目列表"""
    url = f"{base_url.rstrip('/')}/project/listAll"
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = token

    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, context=ssl_ctx, timeout=30)
        return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'error': str(e)}


def main():
    parser = argparse.ArgumentParser(description='QM_Testing - 导入测试平台')
    parser.add_argument('input', help='用例 JSON 文件路径')
    parser.add_argument('--url', required=True, help='平台地址, 如 https://ms.example.com')
    parser.add_argument('--token', required=True, help='认证 Token')
    parser.add_argument('--project-id', type=int, default=0, help='项目 ID (可选)')
    parser.add_argument('--list-projects', action='store_true', help='先获取项目列表')
    parser.add_argument('--env', type=int, default=1, choices=[0, 1, 2, 3],
                       help='环境 (0=DEV, 1=TEST, 2=PRE, 3=PROD)')
    args = parser.parse_args()

    if args.list_projects:
        print(f"获取项目列表: {args.url}")
        projects = list_projects(args.url, args.token)
        if isinstance(projects, list):
            print(f"找到 {len(projects)} 个项目:")
            for p in projects:
                print(f"  ID: {p.get('id')} | {p.get('name')}")
        else:
            print(f"项目列表: {json.dumps(projects, ensure_ascii=False, indent=2)}")
        return

    if not os.path.exists(args.input):
        print(f"错误: 文件不存在 {args.input}", file=sys.stderr)
        sys.exit(1)

    with open(args.input, 'r', encoding='utf-8') as f:
        case_vo = json.load(f)

    # 覆盖 projectId 和 environment
    if args.project_id > 0:
        case_vo['projectId'] = args.project_id
    case_vo['environment'] = args.env

    print(f"用例名称: {case_vo.get('name', '')}")
    print(f"接口数: {case_vo.get('apiCount', 0)}")
    print(f"目标平台: {args.url}")
    print(f"项目 ID: {case_vo.get('projectId', '?')}")
    print(f"环境: {['DEV', 'TEST', 'PRE', 'PROD'][args.env]}")

    print("\n正在导入...")
    result = import_to_metersphere(case_vo, args.url, args.token)

    if result['success']:
        print(f"✓ 导入成功! (status={result['status']})")
        print(f"  响应: {json.dumps(result['data'], ensure_ascii=False, indent=2)}")
    else:
        print(f"✗ 导入失败 (status={result['status']})")
        print(f"  错误: {json.dumps(result['error'], ensure_ascii=False, indent=2)}")
        sys.exit(1)


if __name__ == '__main__':
    main()
