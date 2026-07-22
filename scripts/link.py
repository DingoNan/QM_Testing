#!/usr/bin/env python3
"""
QM_Testing - Link 跨接口关联模块 (CLI 版)
构建响应值索引, 自动替换后续请求中的引用值, 生成依赖图

用法:
  python link.py <cleaned.json> [--out <linked.json>]
"""

import json
import sys
import os
import re
import argparse
from collections import defaultdict
from urllib.parse import urlparse


# 认证相关字段名 (大小写不敏感)
AUTH_HEADER_FIELDS = ['authorization', 'x-xsrf-token', 'x-csrf-token', 'x-token', 'token', 'csrf-token', 'x-auth-token', 'access-token', 'accesstoken', 'cookie']
AUTH_BODY_FIELDS = ['token', 'accessToken', 'access_token', 'access-token', 'accesstoken',
                    'refreshToken', 'refresh_token', 'x-auth-token', 'x_auth_token',
                    'sessionId', 'session_id', 'sessionid', 'sid', 'jwt', 'csrf-token']


def build_response_index(records):
    """
    构建响应值索引: value -> [(seq, path)]
    从所有记录的 responseBody 中递归提取字段值
    """
    index = defaultdict(list)

    for r in records:
        seq = r.get('seq', 0)
        resp_body = r.get('responseBody')
        if resp_body:
            obj = resp_body
            if isinstance(obj, str):
                try:
                    obj = json.loads(obj)
                except (json.JSONDecodeError, TypeError):
                    continue
            if isinstance(obj, (dict, list)):
                _index_object(obj, '', seq, index)

    return dict(index)


def _index_object(obj, prefix, seq, index):
    """递归索引对象中的所有值"""
    if isinstance(obj, dict):
        for k, v in obj.items():
            current_path = f"{prefix}.{k}" if prefix else k
            if isinstance(v, (str, int, float, bool)) and not isinstance(v, bool):
                val_str = str(v)
                if len(val_str) > 3 and len(val_str) < 500:
                    index[val_str].append((seq, current_path))
            elif isinstance(v, (dict, list)):
                _index_object(v, current_path, seq, index)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            current_path = f"{prefix}[{i}]"
            if isinstance(item, (dict, list)):
                _index_object(item, current_path, seq, index)
            elif isinstance(item, (str, int, float)) and not isinstance(item, bool):
                val_str = str(item)
                if len(val_str) > 3 and len(val_str) < 500:
                    index[val_str].append((seq, current_path))


def find_value_refs(data, index, current_seq):
    """在请求数据中查找需要替换的值引用"""
    refs = []

    def _walk(obj, path=""):
        if isinstance(obj, dict):
            for k, v in obj.items():
                current_path = f"{path}.{k}" if path else k
                _walk(v, current_path)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                _walk(item, f"{path}[{i}]")
        elif isinstance(obj, str) and len(obj) > 3 and len(obj) < 500:
            if obj in index:
                candidates = [(s, p) for s, p in index[obj] if s < current_seq]
                if candidates:
                    # 取最近的前序 seq
                    best = max(candidates, key=lambda x: x[0])
                    refs.append({
                        'path': path,
                        'value': obj,
                        'source': {'seq': best[0], 'path': best[1]},
                        'refExpression': f"${{seq{best[0]}.{best[1]}}}",
                    })

    _walk(data)
    return refs


def replace_in_data(data, index, current_seq):
    """在数据中执行引用替换, 返回替换后的副本"""
    if isinstance(data, str) and len(data) > 3 and len(data) < 500:
        if data in index:
            candidates = [(s, p) for s, p in index[data] if s < current_seq]
            if candidates:
                best = max(candidates, key=lambda x: x[0])
                return f"${{seq{best[0]}.{best[1]}}}"
        return data
    elif isinstance(data, dict):
        return {k: replace_in_data(v, index, current_seq) for k, v in data.items()}
    elif isinstance(data, list):
        return [replace_in_data(item, index, current_seq) for item in data]
    return data


def replace_in_url_path(url, index, current_seq):
    """替换 URL 路径中的数字 ID"""
    try:
        parsed = urlparse(url)
        path = parsed.path

        def _replace_match(m):
            val = m.group(1)
            if val in index:
                candidates = [(s, p) for s, p in index[val] if s < current_seq]
                if candidates:
                    best = max(candidates, key=lambda x: x[0])
                    return '/' + f"${{seq{best[0]}.{best[1]}}}"
            return '/' + val

        new_path = re.sub(r'/(\d+)', _replace_match, path)
        return parsed._replace(path=new_path).geturl() if new_path != path else url
    except Exception:
        return url


def find_auth_sources(records):
    """查找认证字段的来源接口 (第一个包含 auth 字段的响应)"""
    sources = []
    for r in records:
        seq = r.get('seq', 0)
        resp_body = r.get('responseBody')
        if not resp_body:
            continue
        obj = resp_body
        if isinstance(obj, str):
            try:
                obj = json.loads(obj)
            except (json.JSONDecodeError, TypeError):
                continue
        if isinstance(obj, dict):
            for field in AUTH_BODY_FIELDS:
                if field in obj and isinstance(obj[field], str) and len(obj[field]) > 8:
                    sources.append({
                        'field': field,
                        'seq': seq,
                        'path': field,
                        'value': obj[field],
                    })
    return sources


def force_replace_auth_headers(records, auth_sources):
    """强制替换后续请求中的认证头"""
    if not auth_sources:
        return records

    # 以第一个 token 来源为准
    primary = auth_sources[0]
    auth_index = {primary['value']: (primary['seq'], primary['path'])}

    for r in records:
        if r.get('seq', 0) <= primary['seq']:
            continue
        req_headers = r.get('requestHeaders', {}) or {}
        for field in AUTH_HEADER_FIELDS:
            for hdr_key in list(req_headers.keys()):
                if hdr_key.lower() == field:
                    val = req_headers[hdr_key]
                    if val and val in auth_index:
                        src = auth_index[val]
                        req_headers[hdr_key] = f"${{seq{src[0]}.{src[1]}}}"
                    elif val and len(val) > 8 and any(
                        token_val in val for token_val in auth_index
                    ):
                        req_headers[hdr_key] = f"${{seq{primary['seq']}.{primary['path']}}}"
        r['requestHeaders'] = req_headers

    return records


def link_records(records):
    """主关联逻辑"""
    if not records:
        return [], [], {}

    index = build_response_index(records)
    auth_sources = find_auth_sources(records)

    # 强制替换认证头
    records = force_replace_auth_headers(records, auth_sources)

    deps = []  # 依赖边
    linked = []

    for r in records:
        seq = r.get('seq', 0)
        url = r.get('url', '')

        # URL 路径替换
        new_url = replace_in_url_path(url, index, seq)

        # 请求头替换
        req_headers = r.get('requestHeaders', {}) or {}
        new_headers = replace_in_data(req_headers, index, seq) if req_headers else {}

        # 请求体替换
        req_body = r.get('requestBody')
        new_body = replace_in_data(req_body, index, seq) if req_body else req_body

        # 记录依赖
        _track_deps(deps, seq, url, new_url, req_headers, new_headers, req_body, new_body)

        linked.append({
            **r,
            'url': new_url,
            'requestHeaders': new_headers,
            'requestBody': new_body,
        })

    # 构建依赖图
    dep_graph = build_dep_graph(deps, len(records))

    return linked, deps, dep_graph


def _track_deps(deps, seq, orig_url, new_url, orig_headers, new_headers, orig_body, new_body):
    """跟踪依赖关系"""
    import re as _re
    ref_pattern = _re.compile(r'\$\{seq(\d+)\.([^}]+)\}')

    def _find_refs_in(val, context_path):
        if isinstance(val, str):
            for m in ref_pattern.finditer(val):
                target_seq = int(m.group(1))
                target_path = m.group(2)
                deps.append({
                    'from': {'seq': target_seq, 'path': target_path},
                    'to': {'seq': seq, 'path': context_path},
                })
        elif isinstance(val, dict):
            for k, v in val.items():
                _find_refs_in(v, f"{context_path}.{k}" if context_path else k)
        elif isinstance(val, list):
            for i, item in enumerate(val):
                _find_refs_in(item, f"{context_path}[{i}]")

    if orig_url != new_url:
        _find_refs_in(new_url, 'url')
    _find_refs_in(new_headers, 'requestHeaders')
    _find_refs_in(new_body, 'requestBody')


def build_dep_graph(deps, total_records):
    """构建依赖图结构"""
    providers = defaultdict(list)
    dependents = defaultdict(list)
    all_seqs = set(range(1, total_records + 1))

    for dep in deps:
        src_seq = dep['from']['seq']
        tgt_seq = dep['to']['seq']
        providers[tgt_seq].append(src_seq)
        dependents[src_seq].append(tgt_seq)

    dependent_seqs = set(d['to']['seq'] for d in deps)
    isolated = sorted(all_seqs - dependent_seqs)

    return {
        'edges': deps,
        'providers': dict(providers),
        'dependents': dict(dependents),
        'isolated': isolated,
        'totalNodes': total_records,
    }


def main():
    parser = argparse.ArgumentParser(description='QM_Testing - 跨接口关联')
    parser.add_argument('input', help='清洗后的 JSON 文件路径')
    parser.add_argument('--out', '-o', default='', help='输出文件路径')
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
    linked_records, deps, dep_graph = link_records(records)
    print(f"关联后记录数: {len(linked_records)}")
    print(f"依赖边: {len(deps)} | 独立节点: {len(dep_graph['isolated'])}")

    out_dir = os.path.dirname(args.out) or os.path.dirname(args.input) or '.'
    linked_path = args.out or os.path.join(out_dir, 'linked.json')
    deps_path = os.path.join(out_dir, 'deps.json')
    graph_path = os.path.join(out_dir, 'deps-graph.json')

    output = {'records': linked_records, 'stats': {'total': len(linked_records), 'deps': len(deps)}}
    with open(linked_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    with open(deps_path, 'w', encoding='utf-8') as f:
        json.dump(deps, f, ensure_ascii=False, indent=2)
    with open(graph_path, 'w', encoding='utf-8') as f:
        json.dump(dep_graph, f, ensure_ascii=False, indent=2)

    print(f"已输出关联数据: {linked_path}")
    print(f"已输出依赖边: {deps_path}")
    print(f"已输出依赖图: {graph_path}")


if __name__ == '__main__':
    main()
