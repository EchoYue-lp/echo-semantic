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
import re
import subprocess
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

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
        if path and path != ".echo-semantic" and not path.startswith(".echo-semantic/")
    )


def source_digest(root: Path, paths: list[str]) -> str:
    digest = hashlib.sha256()
    for relative in paths:
        path = root / relative
        if path.is_symlink():
            identity = "symlink:" + path.readlink().as_posix()
        elif path.is_file():
            identity = "file:" + hashlib.sha256(path.read_bytes()).hexdigest()
        else:
            continue
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(identity.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


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
        "observed_at": f"source:{revision}",
        "boundary_refs": [],
        "code_refs": code_refs,
        "consumer_refs": [],
        "behavior_refs": [],
        "rule_refs": [],
        "evidence_refs": [],
        "finding_refs": [],
        "candidate_refs": [],
    }


def extract_assets(root: Path, relative: str, revision: str) -> list[dict[str, Any]]:
    path = root / relative
    if not path.is_file() or path.is_symlink():
        return []
    try:
        text = path.read_text(encoding="utf-8")
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
        for match in pattern.finditer(text):
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
                "reason": "多个文件声明相同符号名，尚未证明业务语义等价",
            }
        )
        for member in members:
            member["status"] = "candidate"
            member["candidate_refs"] = [item for item in ids if item != member["id"]]
    return candidates


def write_asset(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frontmatter = yaml.safe_dump(data, allow_unicode=True, sort_keys=False).rstrip()
    headings = ["资产身份", "来源与消费者", "生命周期", "候选关系", "未知与限制"]
    body = "\n\n".join(
        f"## {heading}\n\n已由语义资产盘点记录。" for heading in headings
    )
    path.write_text(
        f"---\n{frontmatter}\n---\n\n# 语义资产\n\n{body}\n", encoding="utf-8"
    )


def write_discovery(
    root: Path,
    revision: str,
    digest: str,
    assets: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    unresolved: list[str],
) -> None:
    data = {
        "schema_version": 1,
        "id": "discovery.semantic-assets",
        "kind": "discovery",
        "source_snapshot": {"base_revision": revision, "content_digest": digest},
        "scope": "Git 可见路径、公开符号、入口、状态权威、协议字段、测试消费者和文档引用",
        "inspected_paths": sorted(
            {ref.split("#", 1)[0] for asset in assets for ref in asset["code_refs"]}
        ),
        "candidate_refs": [candidate["id"] for candidate in candidates],
        "unresolved": unresolved,
    }
    frontmatter = yaml.safe_dump(data, allow_unicode=True, sort_keys=False).rstrip()
    body = (
        "## 扫描范围\n\n已扫描 Git 可见路径。\n\n"
        "## 候选事实\n\n已记录资产身份和同名符号候选。\n\n"
        "## 归并结果\n\n候选只等待人工归并，不自动删除。\n\n"
        "## 未决项\n\n动态注册、反射和运行时配置保持未知。\n"
    )
    path = root / ".echo-semantic/discovery/discovery.semantic-assets.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"---\n{frontmatter}\n---\n\n# 语义资产发现\n\n{body}", encoding="utf-8"
    )


def scan(
    root: Path, write: bool, selected_paths: list[str] | None = None
) -> dict[str, Any]:
    all_paths = git_paths(root)
    if selected_paths:
        allowed = tuple(
            PurePosixPath(path).as_posix().rstrip("/") for path in selected_paths
        )
        paths = [
            path
            for path in all_paths
            if any(
                path == prefix or path.startswith(f"{prefix}/") for prefix in allowed
            )
        ]
    else:
        paths = all_paths
    revision = current_revision(root)
    digest = source_digest(root, all_paths)
    assets = [
        asset for relative in paths for asset in extract_assets(root, relative, digest)
    ]
    contents = {}
    for relative in paths:
        path = root / relative
        if path.is_file() and not path.is_symlink():
            contents[relative] = path.read_text(encoding="utf-8", errors="ignore")
    for asset in assets:
        if asset["asset_type"] != "symbol":
            continue
        name = str(asset["title"])
        source_path = str(asset["code_refs"][0]).split("#", 1)[0]
        asset["consumer_refs"] = [
            relative
            for relative, text in contents.items()
            if relative != source_path and re.search(rf"\b{re.escape(name)}\b", text)
        ]
    candidates = candidate_groups(assets)
    unresolved = [
        relative
        for relative in paths
        if (root / relative).suffix.lower() in SOURCE_SUFFIXES
        and has_dynamic_markers(
            (root / relative).read_text(encoding="utf-8", errors="ignore")
        )
    ]
    report = {
        "schema_version": 1,
        "source_snapshot": {"base_revision": revision, "content_digest": digest},
        "assets": assets,
        "candidates": candidates,
        "unresolved": unresolved,
    }
    if write:
        for asset in assets:
            write_asset(root / ".echo-semantic/assets" / f"{asset['id']}.md", asset)
        write_discovery(root, revision, digest, assets, candidates, unresolved)
        report["written"] = True
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="生成语义资产清单和归并候选")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--path", action="append", default=[], help="只盘点指定仓库相对路径"
    )
    parser.add_argument(
        "--write", action="store_true", help="写入 .echo-semantic 长期对象"
    )
    args = parser.parse_args()
    try:
        print(
            json.dumps(
                scan(args.root.resolve(), args.write, args.path or None),
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
