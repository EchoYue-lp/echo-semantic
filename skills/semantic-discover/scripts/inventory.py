#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["PyYAML>=6.0,<7"]
# ///
"""生成项目语义资产清单和可审阅的归并候选。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

sys.dont_write_bytecode = True
PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "scripts"))
from preflight_contract import source_bytes
from scan_contract import publish_report, report_digest, validate_scan_report

SOURCE_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".dart",
    ".ex",
    ".exs",
    ".go",
    ".java",
    ".js",
    ".jsx",
    ".kt",
    ".kts",
    ".mjs",
    ".php",
    ".py",
    ".rb",
    ".rs",
    ".scala",
    ".sh",
    ".swift",
    ".ts",
    ".tsx",
    ".vue",
    ".zig",
}
DOCUMENT_SUFFIXES = {".adoc", ".md", ".rst", ".txt"}
TEST_SEGMENTS = {"test", "tests", "spec", "specs"}
SYMBOL_PATTERNS = {
    ".go": re.compile(
        r"^\s*(?:func\s+(?:\([^)]*\)\s*)?|type\s+|var\s+|const\s+)([A-Z][A-Za-z0-9_]*)"
    ),
    ".java": re.compile(
        r"^\s*public\s+(?:final\s+|abstract\s+)?(?:class|interface|enum|record)\s+([A-Za-z][A-Za-z0-9_]*)"
    ),
    ".js": re.compile(
        r"^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)"
    ),
    ".mjs": re.compile(
        r"^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)"
    ),
    ".py": re.compile(r"^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z][A-Za-z0-9_]*)"),
    ".rs": re.compile(
        r"^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|static|mod)\s+([A-Za-z][A-Za-z0-9_]*)"
    ),
    ".ts": re.compile(
        r"^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)"
    ),
    ".tsx": re.compile(
        r"^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)"
    ),
}
STATE_PATTERN = re.compile(
    r"\b(?:class|struct|enum|trait|type|interface|record)\s+"
    r"[A-Za-z0-9_]*(?:State|Store|Repository|Registry|Authority|Journal)\b"
)
ENTRY_PATTERN = re.compile(
    r"\b(?:register|route|router|handler|controller|command|endpoint|listener|subscribe)\b",
    re.IGNORECASE,
)
PROTOCOL_PATTERN = re.compile(
    r"\b(?:schema|protocol|serialize|deserialize|openapi|graphql|protobuf|json)\b",
    re.IGNORECASE,
)
DYNAMIC_PATTERNS = (
    re.compile(r"\b(?:getattr|setattr|hasattr|delattr|eval|exec)\s*\("),
    re.compile(r"\b(?:importlib|__import__|entry_points|ServiceLoader|dlopen)\b"),
    re.compile(
        r"\b(?:load_dynamic|register_plugin|plugin_registry|event_bus)\b", re.IGNORECASE
    ),
    re.compile(
        r"\b(?:config|settings|manifest)\b.*\b(?:route|handler|register|plugin)\b",
        re.IGNORECASE,
    ),
)


def has_dynamic_markers(text: str) -> bool:
    return any(pattern.search(text) for pattern in DYNAMIC_PATTERNS)


def run_git(root: Path, *args: str, binary: bool = False) -> bytes | str:
    result = subprocess.run(
        ["git", "-C", str(root), "-c", "core.quotePath=false", *args],
        check=False,
        capture_output=True,
        text=not binary,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode() if binary else result.stderr.strip())
    return result.stdout


def git_paths(root: Path) -> list[str]:
    output = run_git(
        root,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        binary=True,
    )
    raw = output if isinstance(output, bytes) else output.encode()
    return sorted(
        path
        for path in raw.decode("utf-8").split("\0")
        if path
        and path.casefold() != ".echo-semantic"
        and not path.casefold().startswith(".echo-semantic/")
    )


def current_revision(root: Path) -> str:
    revision = str(run_git(root, "rev-parse", "HEAD")).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise RuntimeError("当前仓库没有有效 HEAD")
    return revision


def asset_id(asset_type: str, relative: str, name: str = "") -> str:
    value = f"{asset_type}:{relative}:{name}".encode()
    return "asset." + hashlib.sha256(value).hexdigest()[:20]


def normalize_content(text: str) -> str:
    without_comments = re.sub(r"//.*|#.*|/\*[\s\S]*?\*/", " ", text)
    return " ".join(without_comments.lower().split())


def is_test_path(relative: str) -> bool:
    parts = set(PurePosixPath(relative).parts)
    name = PurePosixPath(relative).name.lower()
    return bool(parts & TEST_SEGMENTS) or name.startswith("test_") or ".test." in name


def base_asset(
    asset_type: str,
    relative: str,
    revision: str,
    title: str,
    code_refs: list[str],
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "id": asset_id(asset_type, relative, title),
        "kind": "asset",
        "title": title,
        "asset_type": asset_type,
        "status": "active",
        "risk": "medium"
        if asset_type in {"entrypoint", "state_authority", "protocol"}
        else "low",
        "observed_at": revision
        if revision.startswith("task:")
        else f"source:{revision}",
        "boundary_refs": [],
        "code_refs": code_refs,
        "consumer_refs": [],
        "behavior_refs": [],
        "rule_refs": [],
        "evidence_refs": [],
        "finding_refs": [],
        "candidate_refs": [],
    }


def extract_assets(
    root: Path, relative: str, revision: str, content: bytes | None = None
) -> list[dict[str, Any]]:
    path = root / relative
    if content is None and (not path.is_file() or path.is_symlink()):
        return []
    try:
        text = (
            content.decode("utf-8")
            if content is not None
            else path.read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError):
        return [base_asset("file", relative, revision, relative, [relative])]

    suffix = path.suffix.lower()
    assets: list[dict[str, Any]] = []
    if is_test_path(relative):
        asset_type = "test_consumer"
    elif suffix in DOCUMENT_SUFFIXES:
        asset_type = "document"
    elif suffix in SOURCE_SUFFIXES:
        asset_type = "file"
    else:
        asset_type = "file"
    file_asset = base_asset(asset_type, relative, revision, relative, [relative])
    normalized = normalize_content(text)
    if has_dynamic_markers(text):
        file_asset["status"] = "needs_review"
        file_asset["risk"] = "high"
    if asset_type == "file" and len(normalized) >= 20:
        file_asset["content_fingerprint"] = hashlib.sha256(
            normalized.encode()
        ).hexdigest()[:20]
    assets.append(file_asset)

    pattern = SYMBOL_PATTERNS.get(suffix)
    if pattern:
        for match in re.finditer(pattern.pattern, text, re.MULTILINE):
            name = match.group(1)
            line = text.count("\n", 0, match.start()) + 1
            assets.append(
                base_asset(
                    "symbol",
                    relative,
                    revision,
                    name,
                    [f"{relative}#{name}"],
                )
                | {"line": line, "signature": normalize_content(match.group(0))},
            )
    for line_number, line in enumerate(text.splitlines(), start=1):
        if ENTRY_PATTERN.search(line):
            assets.append(
                base_asset(
                    "entrypoint",
                    relative,
                    revision,
                    f"{relative}:line-{line_number}",
                    [relative],
                )
            )
        if STATE_PATTERN.search(line):
            assets.append(
                base_asset(
                    "state_authority",
                    relative,
                    revision,
                    f"{relative}:line-{line_number}",
                    [relative],
                )
            )
        if PROTOCOL_PATTERN.search(line) and suffix in SOURCE_SUFFIXES:
            assets.append(
                base_asset(
                    "protocol",
                    relative,
                    revision,
                    f"{relative}:line-{line_number}",
                    [relative],
                )
            )
    return assets


def candidate_groups(assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for asset in assets:
        if asset["asset_type"] == "symbol":
            key = "symbol:" + str(asset.get("title", "")).casefold()
        elif asset.get("content_fingerprint"):
            key = "content:" + str(asset["content_fingerprint"])
        else:
            continue
        if key:
            groups.setdefault(key, []).append(asset)
    candidates: list[dict[str, Any]] = []
    for name, members in sorted(groups.items()):
        if len(members) < 2:
            continue
        ids = [member["id"] for member in members]
        candidate_id = (
            "candidate." + hashlib.sha256("|".join(ids).encode()).hexdigest()[:20]
        )
        candidates.append(
            {
                "id": candidate_id,
                "kind": "content-or-symbol-collision",
                "label": name,
                "asset_refs": ids,
                "decision": "needs_review",
                "reason": "内容或公开符号存在静态相似信号，尚未证明业务语义等价",
            }
        )
        for member in members:
            member["status"] = "candidate"
            member["candidate_refs"] = [item for item in ids if item != member["id"]]
    return candidates


def capture(
    root: Path, selected_paths: list[str] | None = None, *, retain_contents: bool = True
) -> dict[str, Any]:
    """绑定一次只读内容；不访问符号链接、已识别密钥或超限文件。"""
    head = current_revision(root)
    index = run_git(root, "ls-files", "--stage", "-z", binary=True)
    all_paths = git_paths(root)
    paths = (
        all_paths
        if not selected_paths
        else [
            p
            for p in all_paths
            if any(
                p == prefix.rstrip("/") or p.startswith(prefix.rstrip("/") + "/")
                for prefix in selected_paths
            )
        ]
    )
    contents: dict[str, bytes] = {}
    manifest = {}
    excluded = []
    total = 0
    for relative in paths:
        path = root / relative
        try:
            info = path.lstat()
        except FileNotFoundError:
            manifest[relative] = {"kind": "missing"}
            excluded.append({"path": relative, "reason": "工作树路径已删除"})
            continue
        name = path.name.lower()
        reason = None
        if path.is_symlink():
            reason = "符号链接不读取目标"
        elif (
            name == ".env"
            or name.startswith(".env.")
            or name
            in {
                "credentials",
                "credentials.json",
                "secrets.json",
                "id_rsa",
                "id_ed25519",
            }
            or path.suffix.lower() in {".pem", ".key", ".p12", ".pfx"}
        ):
            reason = "密钥或敏感配置路径不读取内容"
        elif not stat.S_ISREG(info.st_mode):
            reason = "目录或子模块需要独立治理"
        elif info.st_size > 8 * 1024 * 1024:
            reason = "单文件超过有界读取限制"
        if reason:
            manifest[relative] = {
                "kind": "excluded",
                "mode": info.st_mode,
                "size": info.st_size,
                "mtime_ns": info.st_mtime_ns,
                "ctime_ns": info.st_ctime_ns,
            }
            excluded.append({"path": relative, "reason": reason})
            continue
        content = source_bytes(root, relative)
        total += len(content)
        if total > 128 * 1024 * 1024:
            raise ValueError("扫描内容超过 128 MiB；请拆分范围，不保存完整成功报告")
        if retain_contents:
            contents[relative] = content
        manifest[relative] = {
            "kind": "file",
            "mode": info.st_mode,
            "content_digest": hashlib.sha256(content).hexdigest(),
        }
    if (
        head != current_revision(root)
        or index != run_git(root, "ls-files", "--stage", "-z", binary=True)
        or all_paths != git_paths(root)
    ):
        raise ValueError("扫描期间 HEAD、索引或路径集合变化")
    digest = report_digest(manifest)
    return {
        "head": head,
        "index_digest": hashlib.sha256(
            index if isinstance(index, bytes) else index.encode()
        ).hexdigest(),
        "paths": paths,
        "manifest": manifest,
        "contents": contents,
        "excluded": excluded,
        "digest": digest,
    }


def report_document(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "id": f"discovery.scan.{report_digest(report)}",
        "kind": "discovery",
        "source_snapshot": report["source_snapshot"],
        "scope": "repository",
        "inspected_paths": report["paths"],
        "candidate_refs": [c["id"] for c in report["candidates"]],
        "unresolved": report["unresolved"],
        "scan_report": report,
    }


def encode_report(data: dict[str, Any]) -> str:
    return (
        "---\n"
        + yaml.safe_dump(data, allow_unicode=True, sort_keys=False).rstrip()
        + "\n---\n\n# 全项目扫描候选报告\n\n## 扫描范围\n\n静态盘点，仅证明列出的文件与快照。\n\n## 候选事实\n\n嵌入 scan_report 的资产和重复候选等待人工核对，不确立唯一 owner。\n\n## 归并结果\n\n未执行业务修改或正式基线更新。\n\n## 未决项\n\n动态入口、不支持的解析、排除路径与行为等价检查保持未完成。\n"
    )


def parse_report(text: str) -> dict[str, Any]:
    match = re.match(r"^---\s*\n([\s\S]*?)\n---\s*\n", text)
    if match is None:
        raise ValueError("报告缺少 frontmatter")
    try:
        data = yaml.safe_load(match.group(1))
    except (yaml.YAMLError, RecursionError) as error:
        raise ValueError("扫描报告 frontmatter 无法解析") from error
    errors = validate_scan_report(data)
    if errors:
        raise ValueError("；".join(errors))
    return data


def check_report(root: Path, data: dict[str, Any], *, current: bool = False) -> None:
    errors = validate_scan_report(data)
    if errors:
        raise ValueError("；".join(errors))
    report = data["scan_report"]
    if report["repository_root"] != str(root.resolve()):
        raise ValueError("扫描报告属于其他仓库")
    if current and scan(root, False) != report:
        raise ValueError("扫描报告与当前源码或算法不一致，请重新扫描后再确认")


def save_report(root: Path, report: dict[str, Any]) -> str:
    data = report_document(report)
    destination = root / ".echo-semantic/discovery" / (data["id"] + ".md")
    result = subprocess.run(
        [
            "node",
            str(PLUGIN_ROOT / "scripts/record-scan.mjs"),
            "--root",
            str(root),
            "--python",
            sys.executable,
        ],
        input=encode_report(data),
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    if result.returncode:
        raise ValueError(result.stderr.strip() or "扫描报告保存失败")
    return str(destination)


def scan(
    root: Path, write: bool, selected_paths: list[str] | None = None
) -> dict[str, Any]:
    root = root.resolve()
    if (
        Path(str(run_git(root, "rev-parse", "--show-toplevel")).strip()).resolve()
        != root
    ):
        raise ValueError("扫描必须使用 Git 仓库根")
    if write and selected_paths:
        raise ValueError("局部盘点只输出报告，不覆盖全项目 Discovery 或正式资产")
    snapshot = capture(root, selected_paths)
    scope = "task" if selected_paths else "repository"
    observed = f"task:{snapshot['digest']}" if selected_paths else snapshot["digest"]
    assets = []
    contents = {}
    unresolved = []
    for relative, content in snapshot["contents"].items():
        try:
            text = content.decode("utf-8")
        except UnicodeError:
            unresolved.append(relative + "：二进制内容未做语义解析")
            continue
        contents[relative] = text
        assets.extend(extract_assets(root, relative, observed, content))
        if has_dynamic_markers(text):
            unresolved.append(relative)
        if (root / relative).suffix.lower() in SOURCE_SUFFIXES and (
            root / relative
        ).suffix.lower() not in SYMBOL_PATTERNS:
            unresolved.append(relative + "：无公开符号解析器，需人工调查")
    assets = list({asset["id"]: asset for asset in assets}.values())
    for asset in assets:
        if asset["asset_type"] == "symbol":
            name = str(asset["title"])
            source_path = str(asset["code_refs"][0]).split("#", 1)[0]
            asset["consumer_refs"] = [
                relative
                for relative, text in contents.items()
                if relative != source_path
                and re.search(rf"\b{re.escape(name)}\b", text)
            ]
    candidates = candidate_groups(assets)
    after = capture(root, selected_paths, retain_contents=False)
    if any(
        snapshot[key] != after[key]
        for key in ("head", "index_digest", "paths", "manifest")
    ):
        raise ValueError("扫描期间源码变化，不能生成一致报告")
    report = {
        "schema_version": 2,
        "repository_root": str(root),
        "scope": scope,
        "analysis": "static",
        "result": "completed",
        "paths": snapshot["paths"],
        "source_snapshot": {
            "base_revision": snapshot["head"],
            "content_digest": snapshot["digest"],
        },
        "index_digest": snapshot["index_digest"],
        "file_manifest": snapshot["manifest"],
        "assets": assets,
        "candidates": candidates,
        "unresolved": unresolved,
        "excluded": snapshot["excluded"],
        "limitations": [
            "静态相似与文本消费者只提供线索，不能证明生产可达或行为等价",
            "不读取密钥、排除路径或超限内容；覆盖缺口保留人工核对",
            "未执行语义审计或工程测试，不证明全项目闭合",
        ],
        "globalClosure": "not_checked",
        "behavior_model_closure": "open",
    }
    if write:
        report["report_path"] = save_report(root, report)
        report["written"] = True
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="生成语义资产清单和归并候选")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--path", action="append", default=[], help="只盘点指定仓库相对路径"
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="只保存独立 Discovery 报告，不覆盖正式语义对象",
    )
    parser.add_argument(
        "--check-report", type=Path, help="独立校验已保存扫描报告，不要求 Baseline"
    )
    parser.add_argument(
        "--confirm-report", type=Path, help="用户确认后核对报告与当前源码"
    )
    parser.add_argument(
        "--confirmation", help="用户明确答复的脱敏依据；不是机器授权证明"
    )
    parser.add_argument(
        "--validate-report-stdin", action="store_true", help=argparse.SUPPRESS
    )
    parser.add_argument("--publish-report", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        root = args.root.resolve()
        if args.check_report or args.confirm_report or args.validate_report_stdin:
            if (
                args.write
                or args.path
                or sum(
                    bool(item)
                    for item in (
                        args.check_report,
                        args.confirm_report,
                        args.validate_report_stdin,
                    )
                )
                != 1
            ):
                raise ValueError("报告检查不能混用扫描参数")
            if args.confirm_report and not (
                args.confirmation and args.confirmation.strip()
            ):
                raise ValueError("确认核对需要用户明确答复依据")
            text = (
                sys.stdin.read(16 * 1024 * 1024 + 1)
                if args.validate_report_stdin
                else source_bytes(
                    root,
                    (args.check_report or args.confirm_report)
                    .absolute()
                    .relative_to(root)
                    .as_posix(),
                    max_bytes=16 * 1024 * 1024,
                ).decode()
            )
            if len(text.encode()) > 16 * 1024 * 1024:
                raise ValueError("扫描报告超过大小限制")
            data = parse_report(text)
            check_report(
                root,
                data,
                current=bool(args.confirm_report or args.validate_report_stdin),
            )
            if args.publish_report:
                if not args.validate_report_stdin:
                    raise ValueError("发布必须与锁内标准输入校验一起使用")
                lock = (
                    root
                    / str(
                        run_git(
                            root,
                            "rev-parse",
                            "--git-path",
                            "echo-semantic-project-state.lock",
                        )
                    ).strip()
                )
                descriptor = os.open(
                    lock,
                    os.O_RDONLY
                    | getattr(os, "O_NOFOLLOW", 0)
                    | getattr(os, "O_NONBLOCK", 0),
                )
                try:
                    info = os.fstat(descriptor)
                    if not stat.S_ISREG(info.st_mode) or info.st_size > 512:
                        raise ValueError("报告发布缺少有效仓库锁")
                    token = os.read(descriptor, 513).decode()
                    if not re.fullmatch(str(os.getppid()) + r":[0-9a-f-]{36}", token):
                        raise ValueError("报告发布必须由持有仓库锁的父进程调用")
                finally:
                    os.close(descriptor)
                publish_report(root, data["id"], text)
            print(
                json.dumps(
                    {
                        "scope": "repository",
                        "report_id": data["id"],
                        "snapshot": data["source_snapshot"],
                        "structure": "passed",
                        "current": bool(
                            args.confirm_report or args.validate_report_stdin
                        ),
                        "baselineUpdated": False,
                        "reportPublished": args.publish_report,
                        "next": "用户确认后通过预检维护正式语义材料，并执行全项目验证",
                    },
                    ensure_ascii=False,
                )
            )
        else:
            if args.publish_report:
                raise ValueError("发布只能在锁内报告校验时使用")
            if args.confirmation:
                raise ValueError("confirmation 只能用于确认已保存报告")
            print(
                json.dumps(
                    scan(root, args.write, args.path or None),
                    ensure_ascii=False,
                    indent=2,
                )
            )
        return 0
    except (OSError, RuntimeError, UnicodeError, ValueError) as error:
        print(f"语义资产盘点失败：{error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
