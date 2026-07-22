#!/usr/bin/env python3
"""
QM_Testing - Dry Run 试跑验证模块 (CLI 版)
本地真发请求验证用例, 检测依赖链断裂, 支持多轮回归

用法:
  python dry_run.py <case-save.json> [--out <report.json>] [--base-url <url>]
"""

import json
import sys
import os
import re
import argparse
import time
import urllib.request
import urllib.error
import ssl
from datetime import datetime


# 不验证 SSL 证书 (测试环境)
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE


def resolve_variables(value, context):
    """解析表达式 ${seqX.path} 为实际值"""
    if isinstance(value, str):
        def _replace(m):
            seq = int(m.group(1))
            path = m.group(2)
            if seq in context:
                return _get_nested_value(context[seq], path) or m.group(0)
            return m.group(0)
        return re.sub(r'\$\{seq(\d+)\.([^}]+)\}', _replace, value)
    elif isinstance(value, dict):
        return {k: resolve_variables(v, context) for k, v in value.items()}
    elif isinstance(value, list):
        return [resolve_variables(item, context) for item in value]
    return value


def _get_nested_value(obj, path):
    """按点号路径获取嵌套值"""
    parts = path.replace('[', '.').replace(']', '').split('.')
    current = obj
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            idx = int(part)
            current = current[idx] if idx < len(current) else None
        else:
            return None
        if current is None:
            return None
    return str(current) if not isinstance(current, (dict, list)) else json.dumps(current, ensure_ascii=False)


def send_request(method, url, headers, body, timeout=30):
    """发送单个 HTTP 请求"""
    if body and isinstance(body, dict):
        data = json.dumps(body).encode('utf-8')
    elif body and isinstance(body, str):
        data = body.encode('utf-8')
    else:
        data = None

    req = urllib.request.Request(url, data=data, method=method.upper())
    if headers:
        for k, v in headers.items():
            if k.lower() not in ('content-length', 'host'):
                req.add_header(k, v)

    if data and not any(k.lower() == 'content-type' for k in (headers or {}).keys()):
        req.add_header('Content-Type', 'application/json')

    start = time.time()
    try:
        resp = urllib.request.urlopen(req, context=ssl_ctx, timeout=timeout)
        elapsed = int((time.time() - start) * 1000)
        resp_body = resp.read().decode('utf-8')
        try:
            resp_body = json.loads(resp_body)
        except (json.JSONDecodeError, ValueError):
            pass
        return {
            'status': resp.status,
            'headers': dict(resp.headers),
            'body': resp_body,
            'elapsed': elapsed,
            'error': None,
        }
    except urllib.error.HTTPError as e:
        elapsed = int((time.time() - start) * 1000)
        try:
            err_body = json.loads(e.read().decode('utf-8'))
        except Exception:
            err_body = str(e)
        return {
            'status': e.code,
            'headers': dict(e.headers),
            'body': err_body,
            'elapsed': elapsed,
            'error': str(e),
        }
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return {
            'status': 0,
            'headers': {},
            'body': None,
            'elapsed': elapsed,
            'error': str(e),
        }


def run_case(case_vo, base_url_override=None):
    """试跑单个用例"""
    results = []
    context = {}  # seq -> response 缓存
    passed = 0
    failed = 0
    chain_breaks = []

    for api in case_vo.get('apiVos', []):
        seq = api.get('orderNum', 0)
        method = api.get('apiMethod', 'GET')
        path = api.get('apiUrl', '/')
        domain = api.get('domainName', '')
        headers_raw = api.get('requestHeaders', '{}')
        body_raw = api.get('requestBody', '')

        # 解析 headers
        headers = {}
        if headers_raw:
            try:
                headers = json.loads(headers_raw) if isinstance(headers_raw, str) else headers_raw
            except (json.JSONDecodeError, TypeError):
                headers = {}

        # 解析 body
        body = None
        if body_raw:
            try:
                body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
            except (json.JSONDecodeError, TypeError):
                body = body_raw

        # 解析变量
        headers = resolve_variables(headers, context)
        body = resolve_variables(body, context)
        path = resolve_variables(path, context)

        # 检查依赖链断裂
        def _check_refs(val):
            if isinstance(val, str) and '${seq' in val:
                chain_breaks.append({'seq': seq, 'field': val, 'reason': '未解析的引用'})
                return False
            elif isinstance(val, dict):
                return all(_check_refs(v) for v in val.values())
            elif isinstance(val, list):
                return all(_check_refs(item) for item in val)
            return True

        has_break = not _check_refs(body) or not _check_refs(headers) or not _check_refs(path)

        # 构建完整 URL
        base_url = base_url_override or domain
        full_url = base_url.rstrip('/') + '/' + path.lstrip('/')
        if not base_url:
            full_url = path  # 可能是完整 URL

        # 发送请求
        resp = send_request(method, full_url, headers, body)

        # 断言检查
        assertions = api.get('assertVos', [])
        assert_results = []
        for assertion in assertions:
            expr = assertion.get('expression', '')
            expect = assertion.get('expect', 'true')
            actual = 'unknown'
            ok = True

            if 'code === 0' in expr or 'code === 200' in expr:
                body_obj = resp['body']
                if isinstance(body_obj, dict):
                    actual_code = body_obj.get('code', body_obj.get('status'))
                    actual = str(actual_code)
                    ok = actual_code in (0, 200)
                else:
                    actual = resp['status']
                    ok = resp['status'] == 200
            elif 'status === 200' in expr:
                actual = str(resp['status'])
                ok = resp['status'] == 200
            elif 'data !== null' in expr or 'data' in expr:
                body_obj = resp['body']
                actual = 'not null' if isinstance(body_obj, dict) and body_obj.get('data') is not None else 'null'
                ok = isinstance(body_obj, dict) and body_obj.get('data') is not None

            assert_results.append({
                'expression': expr,
                'expect': expect,
                'actual': actual,
                'ok': ok,
            })

        all_assert_ok = all(a['ok'] for a in assert_results)
        ok = resp['error'] is None and all_assert_ok

        result = {
            'seq': seq,
            'name': api.get('apiName', ''),
            'method': method,
            'url': full_url,
            'status': resp['status'],
            'error': resp['error'],
            'elapsed': resp['elapsed'],
            'assertions': assert_results,
            'ok': ok,
            'dependencyBreak': has_break,
        }

        results.append(result)

        # 缓存响应供后续引用
        if resp['body'] is not None:
            context[seq] = resp['body']

        if ok:
            passed += 1
        else:
            failed += 1

    return {
        'caseName': case_vo.get('name', ''),
        'total': len(results),
        'passed': passed,
        'failed': failed,
        'dependencyBreaks': len(chain_breaks),
        'details': results,
        'chainBreaks': chain_breaks,
        'timestamp': datetime.now().isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description='QM_Testing - 试跑验证')
    parser.add_argument('input', help='用例 JSON 文件路径 (case-save.json)')
    parser.add_argument('--out', '-o', default='', help='输出报告路径')
    parser.add_argument('--base-url', help='覆盖 base URL')
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"错误: 文件不存在 {args.input}", file=sys.stderr)
        sys.exit(1)

    with open(args.input, 'r', encoding='utf-8') as f:
        case_vo = json.load(f)

    print(f"用例名称: {case_vo.get('name', '')}")
    print(f"接口数: {case_vo.get('apiCount', 0)}")
    print(f"开始试跑...")

    report = run_case(case_vo, base_url_override=args.base_url)

    print(f"\n结果: 通过 {report['passed']}/{report['total']}, "
          f"失败 {report['failed']}, "
          f"依赖链断裂 {report['dependencyBreaks']}")

    for d in report['details']:
        status = '✓' if d['ok'] else '✗'
        error_info = f" | {d['error']}" if d['error'] else ''
        print(f"  {status} [{d['method']}] {d['url']} → {d['status']} ({d['elapsed']}ms){error_info}")

    out_path = args.out or os.path.join(os.path.dirname(args.input) or '.', 'regression-report.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n已输出报告: {out_path}")
    sys.exit(0 if report['failed'] == 0 else 1)


if __name__ == '__main__':
    main()
