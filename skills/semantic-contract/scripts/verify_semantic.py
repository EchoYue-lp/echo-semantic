#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["PyYAML>=6.0,<7"]
# ///
"""确定性校验语义材料、源码引用和代码变更依据。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

sys.dont_write_bytecode = True
PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "scripts"))
from governance_contract import AuthorityError, validate_design_authority
from preflight_contract import validate_preflight

SCHEMA_VERSION = 1
PLUGIN_ID = "echo-semantic"
SEMANTIC_DIRECTORY = ".echo-semantic"
RUNTIME_STATE_FILES = {
    "status.md",
    "status.json",
    "preflight.json",
    "route.json",
    "continuation.json",
}
KIND_BY_DIRECTORY = {
    "maps": "capability_map",
    "behaviors": "behavior",
    "rules": "rule",
    "evidence": "evidence",
    "findings": "finding",
    "audits": "audit",
    "discovery": "discovery",
    "assets": "asset",
}
REQUIRED_DIRECTORIES = tuple(KIND_BY_DIRECTORY)
RISK_VALUES = {"low", "medium", "high"}
LENS_VALUES = {
    "trigger_input",
    "result_side_effect",
    "state_authority",
    "data_durability",
    "time_lifecycle",
    "failure_concurrency",
    "permission_external",
    "contract_evidence",
}
REGION_VALUES = {"in_scope", "supporting", "generated_or_vendor", "excluded"}
COVERAGE_VALUES = {"covered", "not_applicable", "needs_review", "excluded"}
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
GIT_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
SOURCE_REVISION_PATTERN = re.compile(r"^source:[0-9a-f]{64}$")
PUBLIC_PATTERNS = {
    ".rs": re.compile(
        r"^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?"
        r"(?:fn|struct|enum|trait|type|const|static|mod|use|extern)\b"
    ),
    ".ts": re.compile(
        r"^\s*export\s+(?:default\s+)?(?:async\s+)?"
        r"(?:function|class|interface|type|const|let|var|enum)\b"
    ),
    ".tsx": re.compile(
        r"^\s*export\s+(?:default\s+)?(?:async\s+)?"
        r"(?:function|class|interface|type|const|let|var|enum)\b"
    ),
    ".js": re.compile(
        r"^\s*export\s+(?:default\s+)?(?:async\s+)?"
        r"(?:function|class|const|let|var)\b"
    ),
    ".mjs": re.compile(
        r"^\s*export\s+(?:default\s+)?(?:async\s+)?"
        r"(?:function|class|const|let|var)\b"
    ),
    ".java": re.compile(
        r"^\s*public\s+(?:final\s+|abstract\s+)?"
        r"(?:class|interface|enum|record|[A-Za-z0-9_<>, ?\[\]]+\s+[A-Za-z0-9_]+\s*\()"
    ),
    ".py": re.compile(r"^(?:async\s+def|def|class)\s+(?!_)[A-Za-z][A-Za-z0-9_]*\b"),
    ".go": re.compile(
        r"^(?:func\s+(?:\([^)]*\)\s*)?|type\s+|var\s+|const\s+)"
        r"[A-Z][A-Za-z0-9_]*\b"
    ),
}
SOURCE_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".go",
    ".h",
    ".hpp",
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
    ".swift",
    ".ts",
    ".tsx",
}
UNKNOWN_SOURCE_SUFFIXES = {
    ".asm",
    ".clj",
    ".cljs",
    ".cr",
    ".bash",
    ".bat",
    ".cmd",
    ".dart",
    ".ex",
    ".exs",
    ".fs",
    ".fsx",
    ".groovy",
    ".hs",
    ".lhs",
    ".lua",
    ".m",
    ".mm",
    ".nim",
    ".r",
    ".sh",
    ".scala",
    ".sc",
    ".sol",
    ".sql",
    ".sv",
    ".swiftinterface",
    ".v",
    ".vhd",
    ".zig",
    ".zsh",
    ".fish",
    ".ps1",
}
STATE_AUTHORITY_PATTERN = re.compile(
    r"\b(?:class|struct|enum|trait|type|interface|record)\s+"
    r"[A-Za-z0-9_]*(?:State|Store|Repository|Registry|Authority|Journal)\b"
)
PROTOCOL_SEGMENTS = {
    "contract",
    "contracts",
    "schema",
    "schemas",
    "protocol",
    "protocols",
}
MIGRATION_SEGMENTS = {"migration", "migrations"}

REQUIRED_FIELDS = {
    "baseline": {
        "source_snapshot",
        "inventory_closure",
        "behavior_model_closure",
        "map_refs",
        "regions",
        "boundaries",
        "coverage",
    },
    "capability_map": {
        "title",
        "risk",
        "observed_at",
        "boundary_refs",
        "behavior_refs",
        "rule_refs",
        "evidence_refs",
        "finding_refs",
        "audit_refs",
        "related_map_refs",
        "scenarios",
    },
    "behavior": {
        "status",
        "expectation",
        "risk",
        "primary_focus",
        "focus",
        "boundary",
        "observed_at",
        "code_refs",
        "rule_refs",
        "evidence_refs",
        "finding_refs",
    },
    "rule": {
        "status",
        "expectation",
        "risk",
        "primary_focus",
        "focus",
        "observed_at",
        "behavior_refs",
        "code_refs",
        "evidence_refs",
        "finding_refs",
    },
    "evidence": {"observed_at", "source_refs", "supports", "limitations"},
    "finding": {
        "type",
        "status",
        "severity",
        "primary_focus",
        "focus",
        "boundary_ref",
        "behavior_refs",
        "rule_refs",
        "evidence_refs",
        "audit_refs",
        "decision_refs",
        "repair_evidence_refs",
        "verification_evidence_refs",
        "rereview_audit_refs",
        "discovered_at",
    },
    "audit": {
        "boundary_ref",
        "lens",
        "freshness",
        "revision",
        "challenges",
        "finding_refs",
    },
    "discovery": {
        "source_snapshot",
        "scope",
        "inspected_paths",
        "candidate_refs",
        "unresolved",
    },
    "asset": {
        "title",
        "asset_type",
        "status",
        "risk",
        "observed_at",
        "boundary_refs",
        "code_refs",
        "consumer_refs",
        "behavior_refs",
        "rule_refs",
        "evidence_refs",
        "finding_refs",
    },
}
REQUIRED_HEADINGS = {
    "baseline": {
        "源码快照",
        "仓库区域",
        "能力图与边界",
        "覆盖网格",
        "未知与缺口",
        "闭合结论",
    },
    "capability_map": {
        "能力范围",
        "入口与输出",
        "行为关系",
        "状态与数据流",
        "策略来源与优先级",
        "生命周期与失败路径",
        "权限与敏感信息",
        "用户侧投影",
        "场景处置清单",
        "未展开项",
    },
    "behavior": {
        "重要承诺",
        "当前行为",
        "期望行为",
        "触发、结果与副作用",
        "失败、重试与恢复",
        "证据",
        "裁决记录",
    },
    "rule": {
        "不变量或唯一权威",
        "适用行为",
        "当前实现",
        "期望行为",
        "证据",
        "裁决记录",
    },
    "evidence": {"支持的结论", "来源与范围", "已知缺口"},
    "finding": {"问题", "触发条件与影响", "证据", "处理记录"},
    "audit": {
        "审查范围",
        "已检查故障假设",
        "实际实现路径与证据",
        "问题记录",
        "残余风险",
        "未检查项",
    },
    "discovery": {"扫描范围", "候选事实", "归并结果", "未决项"},
    "asset": {"资产身份", "来源与消费者", "生命周期", "候选关系", "未知与限制"},
}
SEMANTIC_REF_TYPES = {
    "map_refs": "capability_map",
    "related_map_refs": "capability_map",
    "behavior_refs": "behavior",
    "rule_refs": "rule",
    "evidence_refs": "evidence",
    "repair_evidence_refs": "evidence",
    "verification_evidence_refs": "evidence",
    "finding_refs": "finding",
    "audit_refs": "audit",
    "rereview_audit_refs": "audit",
    "asset_refs": "asset",
    "candidate_asset_refs": "asset",
    "replacement_refs": "asset",
}


def add_error(errors: list[str], path: Path | str, message: str) -> None:
    errors.append(f"{path}: {message}")


def run_git(root: Path, *args: str, binary: bool = False) -> bytes | str:
    result = subprocess.run(
        ["git", "-C", str(root), "-c", "core.quotePath=false", *args],
        check=False,
        capture_output=True,
        text=not binary,
    )
    if result.returncode != 0:
        stderr = (
            result.stderr
            if isinstance(result.stderr, str)
            else result.stderr.decode("utf-8", errors="replace")
        )
        raise RuntimeError(stderr.strip() or "Git 命令失败")
    return result.stdout


def source_revision_valid(value: Any) -> bool:
    return isinstance(value, str) and bool(
        GIT_REVISION_PATTERN.fullmatch(value)
        or SOURCE_REVISION_PATTERN.fullmatch(value)
    )


def require_string_list(
    data: dict[str, Any], field: str, path: Path, errors: list[str]
) -> list[str]:
    value = data.get(field)
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        add_error(errors, path, f"字段 {field} 必须是字符串列表")
        return []
    return value


def parse_document_text(
    text: str, source: Path | str, errors: list[str]
) -> tuple[dict[str, Any], str] | None:
    if not text.startswith("---\n"):
        add_error(errors, source, "缺少 YAML 前置元数据")
        return None
    end = text.find("\n---\n", 4)
    if end < 0:
        add_error(errors, source, "前置元数据没有结束标记")
        return None
    try:
        data = yaml.safe_load(text[4:end])
    except (yaml.YAMLError, RecursionError) as error:
        add_error(errors, source, f"YAML 无法解析：{error}")
        return None
    if not isinstance(data, dict):
        add_error(errors, source, "前置元数据必须是对象")
        return None
    return data, text[end + 5 :]


def split_document(path: Path, errors: list[str]) -> tuple[dict[str, Any], str] | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        add_error(errors, path, f"无法读取：{error}")
        return None
    return parse_document_text(text, path, errors)


def collect_documents(
    semantic_root: Path, errors: list[str]
) -> list[tuple[Path, str, dict[str, Any], str]]:
    documents: list[tuple[Path, str, dict[str, Any], str]] = []
    if not semantic_root.is_dir():
        add_error(errors, semantic_root, "语义目录不存在")
        return documents
    allowed = {
        "README.md",
        "baseline.md",
        *REQUIRED_DIRECTORIES,
        *RUNTIME_STATE_FILES,
    }
    try:
        root_entries = list(semantic_root.iterdir())
    except OSError as error:
        add_error(errors, semantic_root, f"无法读取语义目录：{error}")
        return documents
    for entry in root_entries:
        if entry.name not in allowed:
            add_error(errors, entry, "语义目录包含合同未声明的根级条目")
        if entry.is_symlink():
            add_error(errors, entry, "语义目录不能使用符号链接")

    readme = semantic_root / "README.md"
    if not readme.is_file():
        add_error(errors, readme, "缺少 README.md")
    else:
        try:
            if not readme.read_text(encoding="utf-8").strip():
                add_error(errors, readme, "README.md 不能为空")
        except (OSError, UnicodeError) as error:
            add_error(errors, readme, f"无法读取：{error}")

    baseline = semantic_root / "baseline.md"
    if not baseline.is_file():
        add_error(errors, baseline, "缺少基线文件")
    else:
        parsed = split_document(baseline, errors)
        if parsed:
            documents.append((baseline, "baseline", parsed[0], parsed[1]))

    for directory, kind in KIND_BY_DIRECTORY.items():
        object_root = semantic_root / directory
        if not object_root.is_dir():
            add_error(errors, object_root, "缺少目录")
            continue
        try:
            entries = sorted(object_root.iterdir())
        except OSError as error:
            add_error(errors, object_root, f"无法读取目录：{error}")
            continue
        for path in entries:
            if path.name == ".gitkeep" and path.is_file():
                try:
                    if path.read_bytes().strip():
                        add_error(errors, path, ".gitkeep 必须为空")
                except OSError as error:
                    add_error(errors, path, f"无法读取：{error}")
                continue
            if path.is_symlink() or path.is_dir() or path.suffix != ".md":
                add_error(errors, path, "对象目录只能包含普通 Markdown 文件")
                continue
            parsed = split_document(path, errors)
            if parsed:
                documents.append((path, kind, parsed[0], parsed[1]))
    return documents


CONTINUITY_DISPOSITIONS = {"replaced", "retired", "resolved_conflict"}
CONTINUITY_REPLACEMENT_KINDS = {
    "behavior",
    "rule",
    "capability_scenario",
    "asset",
}
CONTINUITY_FRESHNESS_FIELDS = {
    "observed_at",
    "discovered_at",
    "revision",
    "before_revision",
    "after_revision",
    "source_snapshot",
    "line",
}
CONTINUITY_LOCATION_FIELDS = {
    "code_refs",
    "consumer_refs",
    "inspected_paths",
    "source_refs",
}
CONTINUITY_SET_FIELDS = {
    "focus",
    "behavior_refs",
    "rule_refs",
    "evidence_refs",
    "finding_refs",
    "audit_refs",
    "decision_refs",
    "repair_evidence_refs",
    "verification_evidence_refs",
    "rereview_audit_refs",
    "asset_refs",
    "candidate_asset_refs",
    "replacement_refs",
    "boundary_refs",
    "related_map_refs",
    "supports",
}


def resolve_commit(root: Path, value: str) -> str:
    revision = str(
        run_git(
            root,
            "rev-parse",
            "--verify",
            "--end-of-options",
            f"{value}^{{commit}}",
        )
    ).strip()
    if not GIT_REVISION_PATTERN.fullmatch(revision):
        raise RuntimeError(f"无法解析 Git revision：{value}")
    return revision


def git_tree_entries(root: Path, revision: str) -> dict[str, tuple[str, str, str]]:
    output = run_git(root, "ls-tree", "-rz", revision, binary=True)
    raw = output if isinstance(output, bytes) else output.encode("utf-8")
    entries: dict[str, tuple[str, str, str]] = {}
    for item in raw.split(b"\0"):
        if not item:
            continue
        metadata, separator, raw_path = item.partition(b"\t")
        if not separator:
            raise RuntimeError(f"Git tree 条目格式无效：{revision}")
        parts = metadata.decode("ascii").split(" ")
        if len(parts) != 3:
            raise RuntimeError(f"Git tree 元数据无效：{revision}")
        path = raw_path.decode("utf-8", errors="strict")
        entries[path] = (parts[0], parts[1], parts[2])
    return entries


def git_blob(
    root: Path, object_id: str, cache: dict[str, bytes] | None = None
) -> bytes:
    if cache is not None and object_id in cache:
        return cache[object_id]
    output = run_git(root, "cat-file", "blob", object_id, binary=True)
    content = output if isinstance(output, bytes) else output.encode("utf-8")
    if cache is not None:
        cache[object_id] = content
    return content


def consume_git_blob_batch(
    root: Path,
    object_ids: Iterable[str],
    consume: Callable[[str, bytes], None],
) -> None:
    requested = sorted(set(object_ids))
    if not requested:
        return
    process = subprocess.Popen(
        ["git", "-C", str(root), "-c", "core.quotePath=false", "cat-file", "--batch"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if process.stdin is None or process.stdout is None or process.stderr is None:
        process.kill()
        raise RuntimeError("无法启动 Git blob 批量读取")
    try:
        for object_id in requested:
            process.stdin.write(object_id.encode("ascii") + b"\n")
            process.stdin.flush()
            header = process.stdout.readline().decode("ascii", errors="strict").strip()
            parts = header.split()
            if len(parts) != 3 or parts[0] != object_id or parts[1] != "blob":
                raise RuntimeError(f"Git blob 批量读取响应无效：{object_id}")
            size = int(parts[2])
            content = process.stdout.read(size)
            separator = process.stdout.read(1)
            if len(content) != size or separator != b"\n":
                raise RuntimeError(f"Git blob 批量读取长度无效：{object_id}")
            consume(object_id, content)
        process.stdin.close()
        stderr = process.stderr.read().decode("utf-8", errors="replace").strip()
        return_code = process.wait()
        if return_code != 0:
            raise RuntimeError(stderr or "Git blob 批量读取失败")
    except Exception:
        process.kill()
        process.wait()
        raise


def git_blobs(
    root: Path,
    object_ids: Iterable[str],
    cache: dict[str, bytes],
    digest_cache: dict[str, str] | None = None,
) -> None:
    missing = set(object_ids) - set(cache)

    def store(object_id: str, content: bytes) -> None:
        cache[object_id] = content
        if digest_cache is not None:
            digest_cache[object_id] = hashlib.sha256(content).hexdigest()

    consume_git_blob_batch(root, missing, store)


def git_blob_digests(
    root: Path, object_ids: Iterable[str], cache: dict[str, str]
) -> None:
    missing = set(object_ids) - set(cache)
    consume_git_blob_batch(
        root,
        missing,
        lambda object_id, content: cache.__setitem__(
            object_id, hashlib.sha256(content).hexdigest()
        ),
    )


def source_digest_at_revision(
    root: Path,
    revision: str,
    entries: dict[str, tuple[str, str, str]] | None = None,
    blob_cache: dict[str, bytes] | None = None,
    blob_digest_cache: dict[str, str] | None = None,
) -> str:
    tree = entries if entries is not None else git_tree_entries(root, revision)
    content_cache = blob_cache if blob_cache is not None else {}
    digest_cache = blob_digest_cache if blob_digest_cache is not None else {}
    regular_object_ids = {
        object_id
        for relative, (mode, object_type, object_id) in tree.items()
        if object_type == "blob"
        and mode != "120000"
        and relative != SEMANTIC_DIRECTORY
        and not relative.startswith(f"{SEMANTIC_DIRECTORY}/")
    }
    symlink_object_ids = {
        object_id
        for relative, (mode, object_type, object_id) in tree.items()
        if object_type == "blob"
        and mode == "120000"
        and relative != SEMANTIC_DIRECTORY
        and not relative.startswith(f"{SEMANTIC_DIRECTORY}/")
    }
    git_blob_digests(root, regular_object_ids, digest_cache)
    git_blobs(
        root,
        symlink_object_ids,
        content_cache,
        digest_cache,
    )
    digest = hashlib.sha256()
    for relative, (mode, object_type, object_id) in sorted(tree.items()):
        if relative == SEMANTIC_DIRECTORY or relative.startswith(
            f"{SEMANTIC_DIRECTORY}/"
        ):
            continue
        if object_type != "blob":
            continue
        if mode == "120000":
            content = git_blob(root, object_id, content_cache)
            identity = "symlink:" + content.decode("utf-8", errors="strict")
        else:
            identity = "file:" + digest_cache[object_id]
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(identity.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def collect_documents_at_revision(
    root: Path,
    revision: str,
    errors: list[str],
    blob_cache: dict[str, bytes] | None = None,
    blob_digest_cache: dict[str, str] | None = None,
) -> tuple[
    list[tuple[Path, str, dict[str, Any], str]],
    dict[str, tuple[str, str, str]],
]:
    entries = git_tree_entries(root, revision)
    cache = blob_cache if blob_cache is not None else {}
    digest_cache = blob_digest_cache if blob_digest_cache is not None else {}
    documents: list[tuple[Path, str, dict[str, Any], str]] = []
    baseline_path = f"{SEMANTIC_DIRECTORY}/baseline.md"
    if baseline_path not in entries:
        add_error(errors, f"{revision}:{baseline_path}", "缺少基线文件")
        return documents, entries

    selected: list[tuple[str, str]] = [(baseline_path, "baseline")]
    for directory, kind in KIND_BY_DIRECTORY.items():
        prefix = f"{SEMANTIC_DIRECTORY}/{directory}/"
        selected.extend(
            (relative, kind)
            for relative in entries
            if relative.startswith(prefix) and relative.endswith(".md")
        )
    git_blobs(
        root,
        (
            entries[relative][2]
            for relative, _ in selected
            if entries[relative][1] == "blob"
        ),
        cache,
        digest_cache,
    )
    for relative, kind in sorted(selected):
        _, object_type, object_id = entries[relative]
        if object_type != "blob":
            add_error(errors, f"{revision}:{relative}", "语义对象不是普通 Git blob")
            continue
        try:
            text = git_blob(root, object_id, cache).decode("utf-8", errors="strict")
        except UnicodeError as error:
            add_error(errors, f"{revision}:{relative}", f"UTF-8 无法解析：{error}")
            continue
        parsed = parse_document_text(text, f"{revision}:{relative}", errors)
        if parsed:
            documents.append((Path(relative), kind, parsed[0], parsed[1]))

    baseline = next((item for item in documents if item[1] == "baseline"), None)
    if baseline is not None:
        snapshot = baseline[2].get("source_snapshot")
        expected = (
            snapshot.get("content_digest") if isinstance(snapshot, dict) else None
        )
        actual = source_digest_at_revision(root, revision, entries, cache, digest_cache)
        if expected != actual:
            add_error(
                errors,
                f"{revision}:{baseline_path}",
                f"历史内容摘要不一致：材料={expected} 当前={actual}",
            )
        base_revision = (
            snapshot.get("base_revision") if isinstance(snapshot, dict) else None
        )
        if not isinstance(base_revision, str) or not GIT_REVISION_PATTERN.fullmatch(
            base_revision
        ):
            add_error(
                errors,
                f"{revision}:{baseline_path}",
                "历史基线缺少有效 base_revision",
            )
        else:
            ancestry = subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "merge-base",
                    "--is-ancestor",
                    base_revision,
                    revision,
                ],
                check=False,
                capture_output=True,
            )
            if ancestry.returncode != 0:
                add_error(
                    errors,
                    f"{revision}:{baseline_path}",
                    f"历史基线 revision 不可恢复或不是祖先：{base_revision}",
                )
    return documents, entries


def normalize_continuity_value(value: Any, field: str | None = None) -> Any:
    if isinstance(value, dict):
        return {
            key: normalize_continuity_value(value[key], key)
            for key in sorted(value)
            if key not in CONTINUITY_FRESHNESS_FIELDS
            and key not in CONTINUITY_LOCATION_FIELDS
        }
    if isinstance(value, list):
        normalized = [normalize_continuity_value(item) for item in value]
        if field in CONTINUITY_SET_FIELDS:
            return sorted(
                normalized,
                key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True),
            )
        return normalized
    if isinstance(value, str):
        return " ".join(value.split())
    return value


def semantic_fingerprint(kind: str, data: dict[str, Any], body: str) -> str:
    if kind == "capability_scenario":
        data = {key: value for key, value in data.items() if key != "source_refs"}
    fingerprint_data = {
        key: value
        for key, value in data.items()
        if key not in {"schema_version", "id", "kind"}
    }
    normalized_data = normalize_continuity_value(fingerprint_data)
    normalized_body = " ".join(body.split())
    encoded = json.dumps(
        {"kind": kind, "data": normalized_data, "body": normalized_body},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def continuity_path_role(relative: str) -> str:
    path = PurePosixPath(relative)
    parts = tuple(part.lower() for part in path.parts)
    first = parts[0] if parts else ""
    name = path.name.lower()
    stem = path.stem.lower()
    original_stem = path.stem
    suffix = path.suffix.lower()
    if (
        first in {"tests", "test", "spec", "specs", "__tests__"}
        or any(
            part in {"tests", "test", "spec", "specs", "__tests__"} for part in parts
        )
        or name.startswith("test_")
        or stem.endswith(("_test", "_spec"))
        or ".test." in name
        or ".spec." in name
        or re.search(r"(?:Test|Tests|Spec)$", original_stem) is not None
    ):
        return "test_consumer"
    if set(parts) & PROTOCOL_SEGMENTS or suffix in {".proto", ".graphql", ".avsc"}:
        return "protocol"
    if set(parts) & MIGRATION_SEGMENTS:
        return "migration"
    if first in {"docs", "doc"} or suffix in {".md", ".rst", ".adoc"}:
        return "documentation"
    if first in {"hooks", "runtime", "scripts", "bin", ".github"}:
        return "governance_control"
    if suffix in SOURCE_SUFFIXES | UNKNOWN_SOURCE_SUFFIXES or any(
        part in {"src", "lib", "app", "api", "public", "server", "client"}
        for part in parts
    ):
        return "production_source"
    if suffix in {".json", ".yaml", ".yml", ".toml", ".ini", ".cfg"}:
        return "configuration"
    return "other"


def continuity_source_role(relative: str, data: dict[str, Any]) -> str:
    path_role = continuity_path_role(relative)
    asset_type = data.get("asset_type")
    if isinstance(asset_type, str) and asset_type in {
        "entrypoint",
        "state_authority",
        "protocol",
        "test_consumer",
    }:
        return f"declared:{asset_type}|path:{path_role}"
    return path_role


def extract_obligations(
    documents: list[tuple[Path, str, dict[str, Any], str]],
) -> tuple[
    dict[str, dict[str, Any]],
    dict[str, tuple[str, dict[str, Any], str, Path]],
]:
    objects: dict[str, tuple[str, dict[str, Any], str, Path]] = {}
    obligations: dict[str, dict[str, Any]] = {}
    referenced: set[str] = set()

    for path, kind, data, body in documents:
        identifier = data.get("id")
        if not isinstance(identifier, str):
            continue
        objects[identifier] = (kind, data, body, path)

    def add_obligation(
        identifier: str,
        kind: str,
        data: dict[str, Any],
        body: str,
        risk: str,
    ) -> None:
        obligations[identifier] = {
            "id": identifier,
            "kind": kind,
            "risk": risk if risk in RISK_VALUES else "high",
            "fingerprint": semantic_fingerprint(kind, data, body),
        }
        for field in (
            "evidence_refs",
            "repair_evidence_refs",
            "verification_evidence_refs",
            "asset_refs",
            "candidate_asset_refs",
            "replacement_refs",
        ):
            values = data.get(field, [])
            if isinstance(values, list):
                referenced.update(item for item in values if isinstance(item, str))

    for path, kind, data, body in documents:
        identifier = data.get("id")
        if not isinstance(identifier, str):
            continue
        if kind in {"behavior", "rule"}:
            add_obligation(identifier, kind, data, body, str(data.get("risk", "high")))
        elif kind == "capability_map":
            scenarios = data.get("scenarios", {})
            if not isinstance(scenarios, dict):
                continue
            for name, scenario in scenarios.items():
                if not isinstance(scenario, dict) or scenario.get("status") not in {
                    "mapped",
                    "needs_review",
                }:
                    continue
                scenario_id = f"{identifier}#scenario:{name}"
                add_obligation(
                    scenario_id,
                    "capability_scenario",
                    scenario,
                    "",
                    str(data.get("risk", "high")),
                )
        elif kind == "finding" and data.get("status") in {
            "open",
            "risk_accepted",
        }:
            add_obligation(
                identifier, kind, data, body, str(data.get("severity", "high"))
            )
        elif kind == "discovery":
            unresolved = data.get("unresolved", [])
            if not isinstance(unresolved, list):
                continue
            for value in unresolved:
                if not isinstance(value, str):
                    continue
                unresolved_id = f"{identifier}#unresolved:{value}"
                add_obligation(
                    unresolved_id,
                    "discovery_unknown",
                    {"value": value},
                    "",
                    "high",
                )

    pending = sorted(referenced)
    while pending:
        identifier = pending.pop(0)
        if identifier in obligations:
            continue
        target = objects.get(identifier)
        if target is None or target[0] not in {"evidence", "asset"}:
            continue
        kind, data, body, _ = target
        add_obligation(identifier, kind, data, body, "high")
        for field in ("evidence_refs", "asset_refs"):
            values = data.get(field, [])
            if isinstance(values, list):
                pending.extend(
                    item
                    for item in values
                    if isinstance(item, str) and item not in obligations
                )
    return obligations, objects


def continuity_snapshot(
    root: Path,
    revision: str,
    blob_cache: dict[str, bytes] | None = None,
    blob_digest_cache: dict[str, str] | None = None,
) -> dict[str, Any]:
    resolved = resolve_commit(root, revision)
    errors: list[str] = []
    cache = blob_cache if blob_cache is not None else {}
    digest_cache = blob_digest_cache if blob_digest_cache is not None else {}
    documents, entries = collect_documents_at_revision(
        root, resolved, errors, cache, digest_cache
    )
    obligations, objects = extract_obligations(documents)
    seen: set[str] = set()
    current_source_revision = f"source:{source_digest_at_revision(root, resolved, entries, cache, digest_cache)}"

    def referenced_values(value: Any) -> Iterable[str]:
        if isinstance(value, dict):
            for field, nested in value.items():
                if field in {"source_refs", "code_refs", "consumer_refs"}:
                    if isinstance(nested, list):
                        yield from (item for item in nested if isinstance(item, str))
                else:
                    yield from referenced_values(nested)
        elif isinstance(value, list):
            for nested in value:
                yield from referenced_values(nested)

    current_reference_ids = []
    for _, _, data, _ in documents:
        for raw in referenced_values(data):
            parsed = parse_source_ref(raw)
            if parsed is None:
                continue
            entry = entries.get(parsed[0])
            if entry is not None and entry[1] == "blob":
                current_reference_ids.append(entry[2])
    git_blobs(root, current_reference_ids, cache, digest_cache)

    def add_current_dependencies(
        owner: str, owner_data: dict[str, Any], values: Iterable[str]
    ) -> None:
        for raw in values:
            parsed = parse_source_ref(raw)
            if parsed is None:
                continue
            relative, anchor = parsed
            entry = entries.get(relative)
            if entry is None or entry[1] != "blob":
                continue
            content_digest = hashlib.sha256(git_blob(root, entry[2], cache)).hexdigest()
            dependency_id = f"{owner}#source:{content_digest}"
            dependency_fingerprint = hashlib.sha256(
                json.dumps(
                    {
                        "content_digest": content_digest,
                        "anchor": anchor,
                        "git_mode": entry[0],
                        "role": continuity_source_role(relative, owner_data),
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
            obligations[dependency_id] = {
                "id": dependency_id,
                "kind": "source_dependency",
                "risk": obligations[owner]["risk"],
                "fingerprint": dependency_fingerprint,
            }

    def require_current_references(values: Iterable[str], source: str) -> None:
        for raw in values:
            parsed = parse_source_ref(raw)
            if parsed is None:
                continue
            relative, anchor = parsed
            entry = entries.get(relative)
            if entry is None or entry[1] != "blob":
                add_error(errors, source, f"语义依赖未保留在候选结果：{raw}")
                continue
            if anchor and anchor not in git_blob(root, entry[2], cache).decode(
                "utf-8", errors="replace"
            ):
                add_error(errors, source, f"候选结果缺少语义依赖锚点：{raw}")

    def bind_current_reference_fingerprint(
        owner: str, owner_data: dict[str, Any], values: Iterable[str]
    ) -> None:
        signatures = []
        for raw in values:
            parsed = parse_source_ref(raw)
            if parsed is None:
                continue
            relative, anchor = parsed
            entry = entries.get(relative)
            if entry is None or entry[1] != "blob":
                continue
            signatures.append(
                {
                    "content_digest": hashlib.sha256(
                        git_blob(root, entry[2], cache)
                    ).hexdigest(),
                    "anchor": anchor,
                    "git_mode": entry[0],
                    "role": continuity_source_role(relative, owner_data),
                }
            )
        encoded = json.dumps(
            {
                "semantic_fingerprint": obligations[owner]["fingerprint"],
                "reference_signatures": sorted(
                    signatures,
                    key=lambda item: json.dumps(item, sort_keys=True),
                ),
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        obligations[owner]["fingerprint"] = hashlib.sha256(encoded).hexdigest()

    for path, kind, data, _ in documents:
        identifier = data.get("id")
        source = f"{resolved}:{path.as_posix()}"
        if data.get("schema_version") != SCHEMA_VERSION:
            add_error(errors, source, f"schema_version 必须是 {SCHEMA_VERSION}")
        if kind != "baseline" and path.stem != identifier:
            add_error(errors, source, "文件名必须等于对象 id")
        if data.get("kind") != kind:
            add_error(errors, source, f"kind 必须是 {kind}")
        if not isinstance(identifier, str) or not ID_PATTERN.fullmatch(identifier):
            add_error(errors, source, "对象 id 无效")
        elif identifier in seen:
            add_error(errors, source, f"对象 id 重复：{identifier}")
        else:
            seen.add(identifier)
        for field in sorted(REQUIRED_FIELDS[kind]):
            if field not in data:
                add_error(errors, source, f"缺少必填字段 {field}")
        validation_path = Path(source)
        if kind == "baseline":
            validate_baseline(data, validation_path, errors)
        elif kind == "capability_map":
            validate_map(data, validation_path, errors)
        elif kind in {"behavior", "rule"}:
            validate_behavior_rule(data, kind, validation_path, errors)
        elif kind == "asset":
            validate_asset(data, validation_path, errors)
        else:
            validate_special(data, kind, validation_path, errors)
        observed = data.get("observed_at")
        reference_entries = entries
        if isinstance(observed, str) and observed.startswith("source:"):
            if observed != current_source_revision:
                add_error(
                    errors,
                    source,
                    f"历史对象源码摘要不匹配：对象={observed} 当前={current_source_revision}",
                )
        elif isinstance(observed, str) and GIT_REVISION_PATTERN.fullmatch(observed):
            try:
                observed_revision = resolve_commit(root, observed)
                reference_entries = git_tree_entries(root, observed_revision)
            except RuntimeError as error:
                add_error(errors, source, f"历史对象 revision 不可恢复：{error}")
                reference_entries = {}
        for raw in referenced_values(data):
            parsed = parse_source_ref(raw)
            if parsed is None:
                add_error(errors, source, f"源码引用格式无效：{raw}")
                continue
            relative, anchor = parsed
            entry = reference_entries.get(relative)
            if entry is None or entry[1] != "blob":
                add_error(errors, source, f"源码引用不存在：{raw}")
                continue
            if anchor and anchor not in git_blob(root, entry[2], cache).decode(
                "utf-8", errors="replace"
            ):
                add_error(errors, source, f"源码引用锚点不存在：{raw}")
        if isinstance(identifier, str) and identifier in obligations:
            current_values = list(referenced_values(data))
            require_current_references(current_values, source)
            bind_current_reference_fingerprint(identifier, data, current_values)
            if kind == "evidence":
                add_current_dependencies(identifier, data, current_values)
        if kind == "capability_map" and isinstance(identifier, str):
            scenarios = data.get("scenarios", {})
            if isinstance(scenarios, dict):
                for name, scenario in scenarios.items():
                    owner = f"{identifier}#scenario:{name}"
                    if isinstance(scenario, dict) and owner in obligations:
                        current_values = list(referenced_values(scenario))
                        require_current_references(current_values, source)
                        bind_current_reference_fingerprint(
                            owner, scenario, current_values
                        )
    return {
        "revision": resolved,
        "documents": documents,
        "objects": objects,
        "obligations": obligations,
        "entries": entries,
        "blob_cache": cache,
        "blob_digest_cache": digest_cache,
        "errors": errors,
    }


def continuity_resolutions(
    snapshot: dict[str, Any],
    merge_base: str,
    predecessor_revisions: list[str],
    result_snapshot: str,
) -> dict[str, list[dict[str, Any]]]:
    resolutions: dict[str, list[dict[str, Any]]] = {}
    for kind, data, _, _ in snapshot["objects"].values():
        if kind != "evidence" or data.get("evidence_type") != "semantic_continuity":
            continue
        if (
            data.get("merge_base_revision") != merge_base
            or data.get("predecessor_revisions") != predecessor_revisions
            or data.get("result_snapshot") != result_snapshot
        ):
            continue
        values = data.get("resolutions", {})
        if not isinstance(values, dict):
            continue
        for obligation, resolution in values.items():
            if isinstance(obligation, str) and isinstance(resolution, dict):
                resolutions.setdefault(obligation, []).append(
                    {
                        "evidence_ref": data.get("id"),
                        "evidence": data,
                        "resolution": resolution,
                    }
                )
    return resolutions


def text_at_snapshot_path(
    root: Path, snapshot: dict[str, Any], relative: str
) -> str | None:
    normalized = safe_relative(relative)
    if normalized is None or normalized != relative:
        return None
    entry = snapshot["entries"].get(relative)
    if entry is None or entry[1] != "blob":
        return None
    try:
        return git_blob(root, entry[2], snapshot.get("blob_cache")).decode(
            "utf-8", errors="strict"
        )
    except UnicodeError:
        return None


def decision_authority_errors(
    text: str,
    kind: str,
    obligation: str,
    predecessor_revisions: list[str],
) -> list[str]:
    errors: list[str] = []
    heading_matches = list(re.finditer(r"^#{1,6}\s+(.+?)\s*$", text, re.MULTILINE))
    headings = [match.group(1).strip().lower() for match in heading_matches]
    groups = (
        (
            ("状态", "status"),
            ("背景", "context", "problem"),
            ("候选", "方案", "options", "alternatives"),
            ("决策", "decision"),
            ("影响", "consequences"),
        )
        if kind == "adr"
        else (
            ("目标", "problem", "goal"),
            ("范围", "边界", "scope", "boundary"),
            ("方案", "设计", "决策", "design", "decision"),
            ("验收", "验证", "acceptance", "verification"),
        )
    )
    if any(
        not any(any(term in heading for term in alternatives) for heading in headings)
        for alternatives in groups
    ):
        errors.append("缺少正式 design/ADR 章节")
    status_sections = []
    for index, match in enumerate(heading_matches):
        heading = match.group(1).strip().lower()
        if not any(term in heading for term in ("状态", "status")):
            continue
        end = (
            heading_matches[index + 1].start()
            if index + 1 < len(heading_matches)
            else len(text)
        )
        status_sections.append(text[match.end() : end].strip().lower())
    status_lines = [
        re.sub(r"^(?:状态|status)\s*[:：]\s*", "", line.strip(" `*_-.。"))
        for section in status_sections
        for line in section.splitlines()
        if line.strip()
    ]
    accepted_statuses = {"已批准", "已采纳", "已确认", "approved", "accepted"}
    rejected_statuses = {
        "未批准",
        "未采纳",
        "未确认",
        "拒绝",
        "草案",
        "已废弃",
        "draft",
        "rejected",
        "declined",
        "superseded",
        "not approved",
        "not accepted",
    }
    status_value = status_lines[0] if len(status_lines) == 1 else None
    if status_value in rejected_statuses:
        errors.append("批准状态被明确否定")
    elif status_value not in accepted_statuses:
        if status_lines:
            errors.append("状态章节必须只包含一个明确允许值")
        errors.append("缺少明确批准状态")
    lower = text.lower()
    if obligation not in text:
        errors.append("未引用义务身份")
    for revision in predecessor_revisions:
        if revision not in text:
            errors.append(f"未引用前置 revision：{revision}")
    for label, pattern in (
        ("产品理由", r"理由|原因|reason|because"),
        ("兼容影响", r"兼容|compat"),
        ("回滚策略", r"回滚|rollback|revert"),
    ):
        if not re.search(pattern, lower):
            errors.append(f"缺少{label}")
    return errors


def validate_resolution_for_obligation(
    root: Path,
    obligation: str,
    entry: dict[str, Any],
    merge_base: str,
    predecessors: list[dict[str, Any]],
    result: dict[str, Any],
    result_obligation: dict[str, Any] | None,
    allowed_dispositions: set[str],
) -> tuple[str | None, list[str]]:
    evidence = entry["evidence"]
    resolution = entry["resolution"]
    errors: list[str] = []
    predecessor_revisions = [item["revision"] for item in predecessors]
    if evidence.get("merge_base_revision") != merge_base:
        errors.append("merge_base_revision 不匹配")
    if evidence.get("predecessor_revisions") != predecessor_revisions:
        errors.append("predecessor_revisions 不匹配或顺序不确定")
    result_snapshot = "source:" + source_digest_at_revision(
        root,
        result["revision"],
        result["entries"],
        result.get("blob_cache"),
        result.get("blob_digest_cache"),
    )
    if evidence.get("result_snapshot") != result_snapshot:
        errors.append("result_snapshot 未绑定候选结果源码")

    fingerprints = resolution.get("predecessor_fingerprints")
    expected_fingerprints = {
        item["revision"]: (
            item["obligations"][obligation]["fingerprint"]
            if obligation in item["obligations"]
            else "absent"
        )
        for item in predecessors
    }
    if fingerprints != expected_fingerprints:
        errors.append("predecessor_fingerprints 不匹配")
    if (
        not isinstance(resolution.get("compatibility_impact"), str)
        or not resolution["compatibility_impact"].strip()
    ):
        errors.append("缺少 compatibility_impact")
    if (
        not isinstance(resolution.get("rollback_ref"), str)
        or not resolution["rollback_ref"].strip()
    ):
        errors.append("缺少 rollback_ref")

    disposition = resolution.get("disposition")
    replacement = resolution.get("replacement_ref")
    referenced_evidence = resolution.get("evidence_refs", [])
    authorities = resolution.get("decision_authorities", [])
    if disposition not in CONTINUITY_DISPOSITIONS:
        errors.append("disposition 无效")
    elif disposition not in allowed_dispositions:
        errors.append(
            "disposition 不能处理当前语义变化，允许："
            + ", ".join(sorted(allowed_dispositions))
        )
    if disposition == "replaced" and replacement == obligation:
        errors.append("replaced 不允许使用原义务作为自身替代")
    if disposition in {"replaced", "resolved_conflict"}:
        replacement_obligation = result["obligations"].get(replacement)
        if not isinstance(replacement, str) or replacement_obligation is None:
            errors.append("replacement_ref 不存在结果义务")
        elif replacement_obligation.get("kind") not in CONTINUITY_REPLACEMENT_KINDS:
            errors.append("replacement_ref 类型无效")
        if not isinstance(referenced_evidence, list) or not referenced_evidence:
            errors.append("缺少等价或迁移 Evidence")
        else:
            required_fingerprints = {
                item["obligations"][obligation]["fingerprint"]
                for item in predecessors
                if obligation in item["obligations"]
            }
            covered_fingerprints: set[str] = set()
            for reference in referenced_evidence:
                target = result["objects"].get(reference)
                if (
                    target is None
                    or target[0] != "evidence"
                    or target[1].get("evidence_type") != "behavior_equivalence"
                ):
                    errors.append(f"等价或迁移 Evidence 无效：{reference}")
                    continue
                supports = target[1].get("supports", [])
                if (
                    not isinstance(supports, list)
                    or obligation not in supports
                    or replacement not in supports
                ):
                    errors.append(f"等价 Evidence 未覆盖原义务与替代义务：{reference}")
                scenarios = target[1].get("scenario_results")
                if (
                    not isinstance(scenarios, dict)
                    or not scenarios
                    or any(
                        not isinstance(result, dict)
                        or result.get("status") != "matched"
                        for result in scenarios.values()
                    )
                ):
                    errors.append(f"等价 Evidence 存在未匹配场景：{reference}")
                before_revision = target[1].get("before_revision")
                before = next(
                    (
                        item
                        for item in predecessors
                        if item["revision"] == before_revision
                        and obligation in item["obligations"]
                    ),
                    None,
                )
                if before is None:
                    errors.append(
                        f"等价 Evidence 未绑定包含原义务的父 revision：{reference}"
                    )
                else:
                    covered_fingerprints.add(
                        before["obligations"][obligation]["fingerprint"]
                    )
                if target[1].get("after_revision") != result_snapshot:
                    errors.append(f"等价 Evidence 未绑定候选结果源码：{reference}")
            if covered_fingerprints != required_fingerprints:
                errors.append("等价 Evidence 未覆盖全部不同父版本指纹")
    if disposition in {"retired", "resolved_conflict"}:
        if not isinstance(authorities, list) or not authorities:
            errors.append("缺少人的决策权威")
        else:
            for authority in authorities:
                if not isinstance(authority, dict):
                    errors.append("decision_authority 不是对象")
                    continue
                path = authority.get("path")
                kind = authority.get("kind")
                digest = authority.get("content_digest")
                if not isinstance(path, str) or kind not in {"design", "adr"}:
                    errors.append("decision_authority 路径或类型无效")
                    continue
                parts = tuple(part.lower() for part in PurePosixPath(path).parts)
                actual_kind = (
                    "adr"
                    if "adr" in parts
                    else "design"
                    if PurePosixPath(path).name.lower() == "design.md"
                    or any(part in {"design", "designs"} for part in parts)
                    else None
                )
                text = text_at_snapshot_path(root, result, path)
                if actual_kind != kind or text is None:
                    errors.append(f"decision_authority 不存在或类型错误：{path}")
                    continue
                actual_digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
                if digest != actual_digest:
                    errors.append(f"decision_authority 摘要不匹配：{path}")
                for issue in decision_authority_errors(
                    text, kind, obligation, predecessor_revisions
                ):
                    errors.append(f"decision_authority {issue}：{path}")
    if disposition == "retired" and result_obligation is not None:
        errors.append("retired 义务仍存在结果中")
    if (
        disposition in {"replaced", "resolved_conflict"}
        and result_obligation is None
        and (
            not isinstance(replacement, str) or replacement not in result["obligations"]
        )
    ):
        errors.append("替代结果不可恢复")

    if errors:
        return None, errors
    if disposition == "retired":
        return "retired", []
    return "replaced", []


def compare_continuity(
    root: Path,
    merge_base_ref: str,
    predecessor_refs: list[str],
    result_ref: str,
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "schema_version": 1,
        "kind": "semantic_continuity_report",
        "merge_base_revision": None,
        "predecessor_revisions": [],
        "result_revision": None,
        "results": [],
        "errors": [],
        "passed": False,
    }
    try:
        if not predecessor_refs:
            raise RuntimeError("至少需要一个 continuity predecessor")
        blob_cache: dict[str, bytes] = {}
        blob_digest_cache: dict[str, str] = {}
        snapshot_cache: dict[str, dict[str, Any]] = {}

        def load_snapshot(reference: str) -> dict[str, Any]:
            resolved = resolve_commit(root, reference)
            if resolved not in snapshot_cache:
                snapshot_cache[resolved] = continuity_snapshot(
                    root, resolved, blob_cache, blob_digest_cache
                )
            return snapshot_cache[resolved]

        base = load_snapshot(merge_base_ref)
        predecessors = sorted(
            (load_snapshot(value) for value in predecessor_refs),
            key=lambda item: item["revision"],
        )
        result = load_snapshot(result_ref)
        report["merge_base_revision"] = base["revision"]
        report["predecessor_revisions"] = [item["revision"] for item in predecessors]
        report["result_revision"] = result["revision"]
        if len(set(report["predecessor_revisions"])) != len(predecessors):
            raise RuntimeError("continuity predecessor 不能重复")
        if len(predecessors) == 1:
            actual_merge_bases = [predecessors[0]["revision"]]
        else:
            actual_merge_bases = sorted(
                line.strip()
                for line in str(
                    run_git(
                        root,
                        "merge-base",
                        "--all",
                        "--octopus",
                        *report["predecessor_revisions"],
                    )
                ).splitlines()
                if line.strip()
            )
        if len(actual_merge_bases) != 1:
            report["errors"].append("无法确定唯一真实共同 merge-base")
        elif base["revision"] != actual_merge_bases[0]:
            report["errors"].append(
                "输入 merge-base 不是前置版本的真实共同基准："
                f"输入={base['revision']} 实际={actual_merge_bases[0]}"
            )
        for predecessor in predecessors:
            ancestry = subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "merge-base",
                    "--is-ancestor",
                    base["revision"],
                    predecessor["revision"],
                ],
                check=False,
                capture_output=True,
            )
            if ancestry.returncode != 0:
                report["errors"].append(
                    f"merge-base 不是 predecessor 的祖先：{predecessor['revision']}"
                )
        ancestry = subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "merge-base",
                "--is-ancestor",
                base["revision"],
                result["revision"],
            ],
            check=False,
            capture_output=True,
        )
        if ancestry.returncode != 0:
            report["errors"].append("merge-base 不是 result 的祖先")
        for snapshot in [base, *predecessors, result]:
            report["errors"].extend(snapshot["errors"])

        result_snapshot = "source:" + source_digest_at_revision(
            root,
            result["revision"],
            result["entries"],
            result.get("blob_cache"),
            result.get("blob_digest_cache"),
        )
        resolution_groups = continuity_resolutions(
            result,
            base["revision"],
            report["predecessor_revisions"],
            result_snapshot,
        )
        obligation_ids = sorted(
            {
                obligation
                for snapshot in [base, *predecessors]
                for obligation in snapshot["obligations"]
            }
        )
        for obligation in obligation_ids:
            base_obligation = base["obligations"].get(obligation)
            parent_values = [
                predecessor["obligations"].get(obligation)
                for predecessor in predecessors
            ]
            result_obligation = result["obligations"].get(obligation)
            parent_fingerprints = [
                value["fingerprint"] if value is not None else None
                for value in parent_values
            ]
            present_fingerprints = {
                value for value in parent_fingerprints if value is not None
            }
            base_fingerprint = (
                base_obligation["fingerprint"] if base_obligation is not None else None
            )
            result_fingerprint = (
                result_obligation["fingerprint"]
                if result_obligation is not None
                else None
            )
            branch_conflict = False
            removal_conflict = False
            fingerprint_conflict = False
            expected_fingerprint: str | None = None
            if base_fingerprint is None:
                if len(present_fingerprints) == 1:
                    expected_fingerprint = next(iter(present_fingerprints))
                else:
                    branch_conflict = True
                    fingerprint_conflict = True
            else:
                removed = any(value is None for value in parent_fingerprints)
                changed = {
                    value for value in present_fingerprints if value != base_fingerprint
                }
                if removed:
                    branch_conflict = True
                    removal_conflict = True
                elif len(changed) > 1:
                    branch_conflict = True
                    fingerprint_conflict = True
                elif changed:
                    expected_fingerprint = next(iter(changed))
                else:
                    expected_fingerprint = base_fingerprint

            status: str
            reasons: list[str] = []
            resolution_report: dict[str, Any] | None = None
            if not branch_conflict and result_fingerprint == expected_fingerprint:
                status = "preserved"
            else:
                candidates = resolution_groups.get(obligation, [])
                if len(candidates) == 1:
                    selected = candidates[0]
                    resolution = selected["resolution"]
                    if fingerprint_conflict:
                        allowed_dispositions = {"resolved_conflict"}
                    elif removal_conflict:
                        allowed_dispositions = (
                            {"retired"}
                            if not present_fingerprints
                            else {"retired", "resolved_conflict"}
                        )
                    elif result_obligation is None:
                        allowed_dispositions = {"replaced", "retired"}
                    else:
                        allowed_dispositions = {"replaced", "resolved_conflict"}
                    status_value, resolution_errors = (
                        validate_resolution_for_obligation(
                            root,
                            obligation,
                            selected,
                            base["revision"],
                            predecessors,
                            result,
                            result_obligation,
                            allowed_dispositions,
                        )
                    )
                    resolution_report = {
                        "evidence_ref": selected.get("evidence_ref"),
                        "disposition": resolution.get("disposition"),
                        "replacement_ref": resolution.get("replacement_ref"),
                        "evidence_refs": resolution.get("evidence_refs", []),
                        "decision_authorities": resolution.get(
                            "decision_authorities", []
                        ),
                        "compatibility_impact": resolution.get("compatibility_impact"),
                        "rollback_ref": resolution.get("rollback_ref"),
                    }
                    if status_value is not None:
                        status = status_value
                    else:
                        status = "unknown"
                        reasons.extend(resolution_errors)
                elif len(candidates) > 1:
                    status = "unknown"
                    reasons.append("同一义务存在多个 continuity resolution")
                elif branch_conflict:
                    status = "conflicted"
                    reasons.append("前置版本对同一义务存在不同处置或指纹")
                elif result_obligation is None:
                    status = "missing"
                    reasons.append("结果中缺少前置版本义务")
                else:
                    status = "conflicted"
                    reasons.append("结果义务指纹未匹配前置版本变更")
            report["results"].append(
                {
                    "obligation": obligation,
                    "kind": next(
                        (
                            value["kind"]
                            for value in [*parent_values, base_obligation]
                            if value is not None
                        ),
                        "unknown",
                    ),
                    "risk": next(
                        (
                            value["risk"]
                            for value in [*parent_values, base_obligation]
                            if value is not None
                        ),
                        "high",
                    ),
                    "status": status,
                    "base_fingerprint": base_fingerprint,
                    "predecessor_fingerprints": {
                        predecessor["revision"]: (
                            value["fingerprint"] if value is not None else "absent"
                        )
                        for predecessor, value in zip(predecessors, parent_values)
                    },
                    "result_fingerprint": result_fingerprint,
                    "resolution": resolution_report,
                    "reasons": reasons,
                }
            )
        report["passed"] = not report["errors"] and all(
            item["status"] in {"preserved", "replaced", "retired"}
            for item in report["results"]
        )
    except (OSError, RuntimeError, UnicodeError, ValueError) as error:
        report["errors"].append(str(error))
    return report


def validate_common(
    path: Path, expected_kind: str, data: dict[str, Any], body: str, errors: list[str]
) -> None:
    if data.get("schema_version") != SCHEMA_VERSION:
        add_error(errors, path, f"schema_version 必须是 {SCHEMA_VERSION}")
    object_id = data.get("id")
    if not isinstance(object_id, str) or not ID_PATTERN.fullmatch(object_id):
        add_error(errors, path, "对象 id 无效")
    if expected_kind != "baseline" and path.stem != object_id:
        add_error(errors, path, "文件名必须等于对象 id")
    if data.get("kind") != expected_kind:
        add_error(errors, path, f"kind 必须是 {expected_kind}")
    for field in sorted(REQUIRED_FIELDS[expected_kind]):
        if field not in data:
            add_error(errors, path, f"缺少必填字段 {field}")
    for heading in sorted(REQUIRED_HEADINGS[expected_kind]):
        if not re.search(rf"^##\s+{re.escape(heading)}\s*$", body, re.MULTILINE):
            add_error(errors, path, f"正文缺少二级标题：{heading}")
    if re.search(
        r"\b(?:clean|safe)\b", json.dumps(data, ensure_ascii=False), re.IGNORECASE
    ):
        add_error(errors, path, "对象不能使用绝对安全状态")


def validate_snapshot(value: Any, path: Path, errors: list[str]) -> None:
    if not isinstance(value, dict):
        add_error(errors, path, "source_snapshot 必须是对象")
        return
    if not isinstance(
        value.get("base_revision"), str
    ) or not GIT_REVISION_PATTERN.fullmatch(value.get("base_revision", "")):
        add_error(
            errors, path, "source_snapshot.base_revision 必须是 40 位 Git revision"
        )
    if not isinstance(value.get("content_digest"), str) or not re.fullmatch(
        r"[0-9a-f]{64}", value.get("content_digest", "")
    ):
        add_error(errors, path, "source_snapshot.content_digest 必须是 64 位 sha256")


def safe_relative(value: str) -> str | None:
    normalized = PurePosixPath(value.replace("\\", "/"))
    if (
        not normalized.parts
        or normalized.as_posix() in {"", "."}
        or normalized.is_absolute()
        or ".." in normalized.parts
    ):
        return None
    return normalized.as_posix().rstrip("/")


def validate_baseline(data: dict[str, Any], path: Path, errors: list[str]) -> None:
    validate_snapshot(data.get("source_snapshot"), path, errors)
    for field in ("inventory_closure", "behavior_model_closure"):
        if data.get(field) not in {"open", "closed"}:
            add_error(errors, path, f"{field} 只能是 open 或 closed")
    require_string_list(data, "map_refs", path, errors)

    regions = data.get("regions")
    if not isinstance(regions, list):
        add_error(errors, path, "regions 必须是列表")
        regions = []
    region_paths: set[str] = set()
    for region in regions:
        if not isinstance(region, dict):
            add_error(errors, path, "每个区域必须是对象")
            continue
        raw = region.get("path")
        normalized = safe_relative(raw) if isinstance(raw, str) else None
        if normalized is None or normalized != raw:
            add_error(errors, path, f"区域路径无效：{raw}")
        elif normalized in region_paths:
            add_error(errors, path, f"区域重复：{normalized}")
        else:
            region_paths.add(normalized)
        status = region.get("status")
        if status not in REGION_VALUES:
            add_error(errors, path, f"区域状态无效：{status}")
        if status == "excluded":
            for field in ("reason", "risk", "recheck_when"):
                if not region.get(field):
                    add_error(errors, path, f"排除区域缺少 {field}")
            if region.get("risk") not in RISK_VALUES:
                add_error(errors, path, "排除区域风险无效")

    boundaries = data.get("boundaries")
    if not isinstance(boundaries, list):
        add_error(errors, path, "boundaries 必须是列表")
        boundaries = []
    seen_boundaries: set[str] = set()
    for boundary in boundaries:
        if not isinstance(boundary, dict):
            add_error(errors, path, "每个边界必须是对象")
            continue
        boundary_id = boundary.get("id")
        if not isinstance(boundary_id, str) or not ID_PATTERN.fullmatch(boundary_id):
            add_error(errors, path, "边界 id 无效")
        elif boundary_id in seen_boundaries:
            add_error(errors, path, f"边界重复：{boundary_id}")
        else:
            seen_boundaries.add(boundary_id)
        if not isinstance(boundary.get("map_ref"), str):
            add_error(errors, path, f"边界 {boundary_id} 缺少 map_ref")
        if boundary.get("risk") not in RISK_VALUES:
            add_error(errors, path, f"边界 {boundary_id} 风险无效")

    coverage = data.get("coverage")
    if not isinstance(coverage, list):
        add_error(errors, path, "coverage 必须是列表")
        coverage = []
    coverage_keys: set[tuple[str, str]] = set()
    for cell in coverage:
        if not isinstance(cell, dict):
            add_error(errors, path, "每个覆盖格必须是对象")
            continue
        region = cell.get("region")
        lens = cell.get("lens")
        status = cell.get("status")
        if region not in region_paths:
            add_error(errors, path, f"覆盖格引用未知区域：{region}")
        if lens not in LENS_VALUES:
            add_error(errors, path, f"覆盖格风险视角无效：{lens}")
        if status not in COVERAGE_VALUES:
            add_error(errors, path, f"覆盖格状态无效：{status}")
        key = (str(region), str(lens))
        if key in coverage_keys:
            add_error(errors, path, f"覆盖格重复：{region}/{lens}")
        coverage_keys.add(key)
        if status == "covered" and not cell.get("refs"):
            add_error(errors, path, f"covered 覆盖格缺少 refs：{region}/{lens}")
        if status in {"not_applicable", "excluded"} and not cell.get("reason"):
            add_error(errors, path, f"{status} 覆盖格缺少 reason：{region}/{lens}")
        if status == "needs_review" and not cell.get("unknown"):
            add_error(errors, path, f"needs_review 覆盖格缺少 unknown：{region}/{lens}")
    if data.get("inventory_closure") == "closed":
        for region in regions:
            if isinstance(region, dict) and region.get("status") == "in_scope":
                for lens in LENS_VALUES:
                    key = (str(region.get("path")), lens)
                    if key not in coverage_keys:
                        add_error(errors, path, f"闭合基线缺少覆盖格：{key[0]}/{lens}")


def validate_map(data: dict[str, Any], path: Path, errors: list[str]) -> None:
    if data.get("risk") not in RISK_VALUES:
        add_error(errors, path, "risk 无效")
    if not source_revision_valid(data.get("observed_at")):
        add_error(errors, path, "observed_at 不是有效源码版本")
    for field in (
        "boundary_refs",
        "behavior_refs",
        "rule_refs",
        "evidence_refs",
        "finding_refs",
        "audit_refs",
        "related_map_refs",
    ):
        require_string_list(data, field, path, errors)
    scenarios = data.get("scenarios")
    if not isinstance(scenarios, dict):
        add_error(errors, path, "scenarios 必须是对象")
        return
    for name, scenario in scenarios.items():
        if not isinstance(scenario, dict):
            add_error(errors, path, f"场景 {name} 必须是对象")
            continue
        status = scenario.get("status")
        if status not in {"mapped", "needs_review", "excluded"}:
            add_error(errors, path, f"场景 {name} 状态无效")
        refs = scenario.get("source_refs")
        if (
            not isinstance(refs, list)
            or not refs
            or any(not isinstance(item, str) for item in refs)
        ):
            add_error(errors, path, f"场景 {name} 缺少 source_refs")
        if status == "mapped" and not any(
            scenario.get(field)
            for field in ("behavior_refs", "rule_refs", "evidence_refs", "finding_refs")
        ):
            add_error(errors, path, f"mapped 场景 {name} 没有处置引用")
        if status == "needs_review" and (
            not scenario.get("unknown") or not scenario.get("next_step")
        ):
            add_error(
                errors, path, f"needs_review 场景 {name} 缺少 unknown 或 next_step"
            )
        if status == "excluded":
            for field in ("reason", "risk", "recheck_when"):
                if not scenario.get(field):
                    add_error(errors, path, f"excluded 场景 {name} 缺少 {field}")


def validate_behavior_rule(
    data: dict[str, Any], kind: str, path: Path, errors: list[str]
) -> None:
    if data.get("status") not in {"needs_review", "verified", "stale"}:
        add_error(errors, path, "status 无效")
    if data.get("expectation") not in {"unknown", "inferred", "human_confirmed"}:
        add_error(errors, path, "expectation 无效")
    if data.get("risk") not in RISK_VALUES:
        add_error(errors, path, "risk 无效")
    if data.get("primary_focus") not in LENS_VALUES:
        add_error(errors, path, "primary_focus 无效")
    focus = require_string_list(data, "focus", path, errors)
    if any(item not in LENS_VALUES for item in focus):
        add_error(errors, path, "focus 包含未知风险视角")
    if not source_revision_valid(data.get("observed_at")):
        add_error(errors, path, "observed_at 不是有效源码版本")
    fields = ("code_refs", "rule_refs", "evidence_refs", "finding_refs")
    if kind == "rule":
        fields = ("behavior_refs", "code_refs", "evidence_refs", "finding_refs")
    for field in fields:
        require_string_list(data, field, path, errors)


def validate_asset(data: dict[str, Any], path: Path, errors: list[str]) -> None:
    if data.get("asset_type") not in {
        "file",
        "symbol",
        "entrypoint",
        "state_authority",
        "protocol",
        "test_consumer",
        "document",
    }:
        add_error(errors, path, "asset_type 无效")
    if data.get("status") not in {
        "active",
        "candidate",
        "orphan",
        "deprecated",
        "needs_review",
    }:
        add_error(errors, path, "asset status 无效")
    if data.get("risk") not in RISK_VALUES:
        add_error(errors, path, "asset risk 无效")
    if not source_revision_valid(data.get("observed_at")):
        add_error(errors, path, "asset observed_at 不是有效源码版本")
    for field in (
        "boundary_refs",
        "code_refs",
        "consumer_refs",
        "behavior_refs",
        "rule_refs",
        "evidence_refs",
        "finding_refs",
    ):
        require_string_list(data, field, path, errors)
    candidate_refs = data.get("candidate_refs", [])
    if not isinstance(candidate_refs, list) or any(
        not isinstance(item, str) or not item.strip() for item in candidate_refs
    ):
        add_error(errors, path, "asset candidate_refs 必须是字符串列表")


def validate_continuity_evidence(
    data: dict[str, Any], path: Path, errors: list[str]
) -> None:
    merge_base = data.get("merge_base_revision")
    if merge_base is not None and (
        not isinstance(merge_base, str)
        or not GIT_REVISION_PATTERN.fullmatch(merge_base)
    ):
        add_error(errors, path, "merge_base_revision 必须是 40 位 Git revision")
    predecessors = data.get("predecessor_revisions")
    valid_predecessors = (
        isinstance(predecessors, list)
        and bool(predecessors)
        and not any(
            not isinstance(item, str) or not GIT_REVISION_PATTERN.fullmatch(item)
            for item in predecessors
        )
    )
    if not valid_predecessors or len(set(predecessors)) != len(predecessors):
        add_error(errors, path, "predecessor_revisions 必须是唯一 Git revision 列表")
        predecessors = []
    if not isinstance(
        data.get("result_snapshot"), str
    ) or not SOURCE_REVISION_PATTERN.fullmatch(data.get("result_snapshot", "")):
        add_error(errors, path, "result_snapshot 必须是 source 摘要")
    resolutions = data.get("resolutions")
    if not isinstance(resolutions, dict) or not resolutions:
        add_error(errors, path, "semantic_continuity Evidence 必须包含 resolutions")
        return
    for obligation, resolution in resolutions.items():
        if not isinstance(obligation, str) or not obligation.strip():
            add_error(errors, path, "continuity resolution 义务身份无效")
        if not isinstance(resolution, dict):
            add_error(errors, path, f"continuity resolution 必须是对象：{obligation}")
            continue
        disposition = resolution.get("disposition")
        if disposition not in CONTINUITY_DISPOSITIONS:
            add_error(errors, path, f"continuity disposition 无效：{obligation}")
        fingerprints = resolution.get("predecessor_fingerprints")
        if not isinstance(fingerprints, dict) or set(fingerprints) != set(predecessors):
            add_error(errors, path, f"父版本指纹不完整：{obligation}")
        elif any(
            value != "absent"
            and (not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value))
            for value in fingerprints.values()
        ):
            add_error(errors, path, f"父版本指纹无效：{obligation}")
        for field in ("compatibility_impact", "rollback_ref"):
            if (
                not isinstance(resolution.get(field), str)
                or not resolution[field].strip()
            ):
                add_error(
                    errors, path, f"continuity resolution 缺少 {field}：{obligation}"
                )
        evidence_refs = resolution.get("evidence_refs", [])
        if not isinstance(evidence_refs, list) or any(
            not isinstance(item, str) or not item.strip() for item in evidence_refs
        ):
            add_error(errors, path, f"continuity evidence_refs 无效：{obligation}")
            evidence_refs = []
        authorities = resolution.get("decision_authorities", [])
        if not isinstance(authorities, list):
            add_error(errors, path, f"decision_authorities 必须是列表：{obligation}")
            authorities = []
        for authority in authorities:
            if (
                not isinstance(authority, dict)
                or authority.get("kind") not in {"design", "adr"}
                or not isinstance(authority.get("path"), str)
                or not isinstance(authority.get("content_digest"), str)
                or not re.fullmatch(
                    r"[0-9a-f]{64}", authority.get("content_digest", "")
                )
            ):
                add_error(errors, path, f"decision_authority 无效：{obligation}")
        if disposition in {"replaced", "resolved_conflict"}:
            if not isinstance(resolution.get("replacement_ref"), str):
                add_error(
                    errors,
                    path,
                    f"continuity resolution 缺少 replacement_ref：{obligation}",
                )
            elif (
                disposition == "replaced"
                and resolution.get("replacement_ref") == obligation
            ):
                add_error(
                    errors,
                    path,
                    f"continuity replaced 不允许自身替代：{obligation}",
                )
            if not evidence_refs:
                add_error(
                    errors,
                    path,
                    f"continuity resolution 缺少等价 Evidence：{obligation}",
                )
        if disposition in {"retired", "resolved_conflict"} and not authorities:
            add_error(
                errors, path, f"continuity resolution 缺少人的决策权威：{obligation}"
            )


def validate_special(
    data: dict[str, Any], kind: str, path: Path, errors: list[str]
) -> None:
    if kind == "evidence":
        if not source_revision_valid(data.get("observed_at")):
            add_error(errors, path, "observed_at 不是有效源码版本")
        if not require_string_list(data, "source_refs", path, errors):
            add_error(errors, path, "Evidence 必须有 source_refs")
        require_string_list(data, "supports", path, errors)
        require_string_list(data, "limitations", path, errors)
        if data.get("evidence_type") == "behavior_equivalence":
            for field in ("before_revision", "after_revision"):
                if not source_revision_valid(data.get(field)):
                    add_error(errors, path, f"{field} 不是有效源码版本")
            scenarios = data.get("scenario_results")
            if not isinstance(scenarios, dict) or not scenarios:
                add_error(errors, path, "行为等价 Evidence 必须包含 scenario_results")
            else:
                for name, result in scenarios.items():
                    if not isinstance(result, dict):
                        add_error(errors, path, f"行为场景 {name} 必须是对象")
                        continue
                    if result.get("status") not in {"matched", "failed", "unknown"}:
                        add_error(errors, path, f"行为场景 {name} status 无效")
                    if (
                        not isinstance(result.get("source_refs"), list)
                        or not result["source_refs"]
                    ):
                        add_error(errors, path, f"行为场景 {name} 缺少 source_refs")
            commands = data.get("command_results")
            if not isinstance(commands, list) or not commands:
                add_error(errors, path, "行为等价 Evidence 必须包含 command_results")
            else:
                for index, command in enumerate(commands):
                    if not isinstance(command, dict):
                        add_error(errors, path, f"等价命令 {index} 必须是对象")
                        continue
                    if (
                        not isinstance(command.get("command"), str)
                        or not command["command"].strip()
                    ):
                        add_error(errors, path, f"等价命令 {index} 缺少 command")
                    if command.get("exit_code") != 0:
                        add_error(errors, path, f"等价命令 {index} 未成功")
            coverage = data.get("coverage")
            if not isinstance(coverage, list) or not coverage:
                add_error(errors, path, "行为等价 Evidence 必须包含 coverage")
            deleted_paths = data.get("deleted_paths", [])
            if not isinstance(deleted_paths, list) or any(
                not isinstance(item, str) or not item.strip() for item in deleted_paths
            ):
                add_error(
                    errors,
                    path,
                    "行为等价 Evidence 的 deleted_paths 必须是字符串列表",
                )
        elif data.get("evidence_type") == "semantic_continuity":
            validate_continuity_evidence(data, path, errors)
        elif data.get("evidence_type") is not None:
            add_error(errors, path, "evidence_type 无效")
    elif kind == "finding":
        if data.get("type") not in {
            "implementation_bug",
            "intent_gap",
            "evidence_gap",
            "authority_conflict",
            "consolidation_candidate",
        }:
            add_error(errors, path, "Finding type 无效")
        if data.get("status") not in {
            "open",
            "resolved",
            "risk_accepted",
            "false_positive",
        }:
            add_error(errors, path, "Finding status 无效")
        if (
            data.get("severity") not in RISK_VALUES
            or data.get("primary_focus") not in LENS_VALUES
        ):
            add_error(errors, path, "Finding 风险字段无效")
        if not source_revision_valid(data.get("discovered_at")):
            add_error(errors, path, "discovered_at 无效")
        for field in (
            "focus",
            "behavior_refs",
            "rule_refs",
            "evidence_refs",
            "audit_refs",
            "decision_refs",
            "repair_evidence_refs",
            "verification_evidence_refs",
            "rereview_audit_refs",
        ):
            require_string_list(data, field, path, errors)
        if "replacement_refs" in data:
            require_string_list(data, "replacement_refs", path, errors)
        if data.get("status") == "resolved" and not all(
            data.get(field)
            for field in (
                "repair_evidence_refs",
                "verification_evidence_refs",
                "rereview_audit_refs",
            )
        ):
            add_error(errors, path, "resolved 必须有修复、验证和复审证据")
        if data.get("status") == "risk_accepted" and not data.get("decision_refs"):
            add_error(errors, path, "risk_accepted 必须有人的裁决引用")
        if data.get("type") == "consolidation_candidate":
            candidates = data.get("candidate_asset_refs")
            if not isinstance(candidates, list) or len(candidates) < 2:
                add_error(errors, path, "归并候选至少需要两个 candidate_asset_refs")
            if data.get("decision") not in {
                "keep",
                "merge",
                "migrate",
                "retire",
                "defer",
            }:
                add_error(errors, path, "归并候选 decision 无效")
            if data.get("decision") in {
                "merge",
                "migrate",
                "retire",
            } and not isinstance(data.get("canonical_asset_ref"), str):
                add_error(errors, path, "归并候选缺少 canonical_asset_ref")
    elif kind == "audit":
        if data.get("lens") not in LENS_VALUES or data.get("freshness") not in {
            "examined",
            "stale",
        }:
            add_error(errors, path, "Audit 风险视角或新鲜度无效")
        if not source_revision_valid(data.get("revision")):
            add_error(errors, path, "Audit revision 无效")
        require_string_list(data, "finding_refs", path, errors)
        challenges = data.get("challenges")
        if not isinstance(challenges, dict) or not challenges:
            add_error(errors, path, "Audit 必须包含实际故障假设")
        else:
            for name, challenge in challenges.items():
                if not isinstance(challenge, dict):
                    add_error(errors, path, f"故障假设 {name} 必须是对象")
                    continue
                if not source_revision_valid(challenge.get("revision")):
                    add_error(errors, path, f"故障假设 {name} revision 无效")
                for field in ("source_refs", "evidence_refs"):
                    value = challenge.get(field)
                    if not isinstance(value, list) or not value:
                        add_error(errors, path, f"故障假设 {name} 缺少 {field}")
    elif kind == "discovery":
        validate_snapshot(data.get("source_snapshot"), path, errors)
        if not isinstance(data.get("scope"), (str, list, dict)):
            add_error(errors, path, "scope 必须是字符串、列表或对象")
        for field in ("inspected_paths", "candidate_refs", "unresolved"):
            require_string_list(data, field, path, errors)


def validate_relations(
    documents: list[tuple[Path, str, dict[str, Any], str]], errors: list[str]
) -> dict[str, tuple[str, dict[str, Any], Path]]:
    objects: dict[str, tuple[str, dict[str, Any], Path]] = {}
    for path, kind, data, _ in documents:
        object_id = data.get("id")
        if not isinstance(object_id, str):
            continue
        if object_id in objects:
            add_error(errors, path, f"对象 id 重复：{object_id}")
        else:
            objects[object_id] = (kind, data, path)

    baseline_entry = next((item for item in documents if item[1] == "baseline"), None)
    boundary_to_map: dict[str, str] = {}
    if baseline_entry:
        baseline_path, _, baseline, _ = baseline_entry
        actual_maps = {
            key for key, value in objects.items() if value[0] == "capability_map"
        }
        declared_maps = set(
            require_string_list(baseline, "map_refs", baseline_path, errors)
        )
        if actual_maps != declared_maps:
            add_error(errors, baseline_path, "map_refs 与 maps/ 中对象集合不一致")
        for boundary in baseline.get("boundaries", []):
            if isinstance(boundary, dict) and isinstance(boundary.get("id"), str):
                boundary_to_map[boundary["id"]] = str(boundary.get("map_ref", ""))

    for path, kind, data, _ in documents:
        for field, expected in SEMANTIC_REF_TYPES.items():
            value = data.get(field)
            if not isinstance(value, list):
                continue
            for ref in value:
                target = objects.get(ref)
                if target is None:
                    add_error(errors, path, f"{field} 引用不存在对象：{ref}")
                elif target[0] != expected:
                    add_error(errors, path, f"{field} 引用类型错误：{ref}")
        if kind == "capability_map":
            for boundary in data.get("boundary_refs", []):
                if boundary_to_map.get(boundary) != data.get("id"):
                    add_error(errors, path, f"能力图引用未归属自己的边界：{boundary}")
            scenarios = data.get("scenarios", {})
            if isinstance(scenarios, dict):
                for name, scenario in scenarios.items():
                    if not isinstance(scenario, dict):
                        continue
                    for field, expected in SEMANTIC_REF_TYPES.items():
                        for ref in (
                            scenario.get(field, [])
                            if isinstance(scenario.get(field), list)
                            else []
                        ):
                            target = objects.get(ref)
                            if target is None or target[0] != expected:
                                add_error(
                                    errors,
                                    path,
                                    f"场景 {name} 的 {field} 引用无效：{ref}",
                                )
        elif kind == "behavior":
            boundary = data.get("boundary")
            map_id = boundary_to_map.get(str(boundary))
            if not map_id:
                add_error(errors, path, f"Behavior 引用未知边界：{boundary}")
            elif map_id in objects and data.get("id") not in objects[map_id][1].get(
                "behavior_refs", []
            ):
                add_error(errors, path, "Behavior 未被边界所属 Capability Map 引用")
        elif kind == "asset":
            for boundary in data.get("boundary_refs", []):
                if boundary not in boundary_to_map:
                    add_error(errors, path, f"asset 引用未知边界：{boundary}")
            for reference in data.get("candidate_refs", []):
                target = objects.get(reference)
                if target is None or target[0] != "asset":
                    add_error(
                        errors, path, f"asset candidate_refs 引用无效：{reference}"
                    )
            if data.get("status") == "candidate" and not data.get("candidate_refs"):
                add_error(errors, path, "candidate asset 必须包含 candidate_refs")
        elif kind == "finding":
            boundary = data.get("boundary_ref")
            if boundary not in boundary_to_map:
                add_error(errors, path, f"Finding 引用未知边界：{boundary}")
            canonical = data.get("canonical_asset_ref")
            if canonical is not None:
                target = objects.get(canonical)
                if target is None or target[0] != "asset":
                    add_error(
                        errors, path, f"canonical_asset_ref 引用无效：{canonical}"
                    )
        elif kind == "audit":
            boundary = data.get("boundary_ref")
            if boundary not in boundary_to_map:
                add_error(errors, path, f"Audit 引用未知边界：{boundary}")
    return objects


def validate_continuity_repository_evidence(
    root: Path,
    documents: list[tuple[Path, str, dict[str, Any], str]],
    errors: list[str],
) -> None:
    obligations, objects = extract_obligations(documents)
    current_snapshot = f"source:{source_digest(root)}"
    for path, kind, data, _ in documents:
        if kind != "evidence" or data.get("evidence_type") != "semantic_continuity":
            continue
        active_for_current_source = data.get("result_snapshot") == current_snapshot
        resolutions = data.get("resolutions", {})
        if not isinstance(resolutions, dict):
            continue
        for obligation, resolution in resolutions.items():
            if not isinstance(resolution, dict):
                continue
            disposition = resolution.get("disposition")
            replacement = resolution.get("replacement_ref")
            if active_for_current_source and disposition in {
                "replaced",
                "resolved_conflict",
            }:
                if not isinstance(replacement, str) or replacement not in obligations:
                    add_error(
                        errors,
                        path,
                        f"replacement_ref 不存在当前结果义务：{obligation}",
                    )
                elif (
                    obligations[replacement].get("kind")
                    not in CONTINUITY_REPLACEMENT_KINDS
                ):
                    add_error(
                        errors,
                        path,
                        f"replacement_ref 类型无效：{obligation} -> {replacement}",
                    )
                for reference in resolution.get("evidence_refs", []):
                    target = objects.get(reference)
                    if (
                        target is None
                        or target[0] != "evidence"
                        or target[1].get("evidence_type") != "behavior_equivalence"
                    ):
                        add_error(
                            errors,
                            path,
                            f"continuity 等价 Evidence 引用无效：{obligation} -> {reference}",
                        )
                        continue
                    scenarios = target[1].get("scenario_results")
                    if (
                        not isinstance(scenarios, dict)
                        or not scenarios
                        or any(
                            not isinstance(result, dict)
                            or result.get("status") != "matched"
                            for result in scenarios.values()
                        )
                    ):
                        add_error(
                            errors,
                            path,
                            f"continuity 等价 Evidence 存在未匹配场景：{obligation} -> {reference}",
                        )
            for authority in resolution.get("decision_authorities", []):
                if not isinstance(authority, dict):
                    continue
                authority_path = authority.get("path")
                authority_kind = authority.get("kind")
                if not isinstance(authority_path, str) or authority_kind not in {
                    "design",
                    "adr",
                }:
                    continue
                try:
                    validated = validate_design_authority(
                        root, authority_path, authority_kind
                    )
                except AuthorityError as error:
                    add_error(errors, path, f"continuity 决策权威无效：{error}")
                    continue
                if authority.get("content_digest") != validated["contentDigest"]:
                    add_error(
                        errors,
                        path,
                        f"continuity 决策权威摘要不匹配：{authority_path}",
                    )
                try:
                    authority_text = (root / authority_path).read_text(encoding="utf-8")
                except (OSError, UnicodeError):
                    authority_text = ""
                predecessors = data.get("predecessor_revisions", [])
                for issue in decision_authority_errors(
                    authority_text,
                    authority_kind,
                    obligation,
                    predecessors if isinstance(predecessors, list) else [],
                ):
                    add_error(
                        errors,
                        path,
                        f"continuity 决策权威{issue}：{authority_path}",
                    )


def parse_source_ref(value: str) -> tuple[str, str | None] | None:
    path_part, separator, anchor = value.partition("#")
    path = safe_relative(path_part)
    if path is None or (separator and not anchor):
        return None
    return path, anchor or None


def content_at_revision(root: Path, revision: str, relative: str) -> bytes:
    if GIT_REVISION_PATTERN.fullmatch(revision):
        result = run_git(root, "show", f"{revision}:{relative}", binary=True)
        return result if isinstance(result, bytes) else result.encode("utf-8")
    path = root / relative
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("当前工作树不存在普通文件")
    return path.read_bytes()


def validate_source_refs(
    root: Path,
    documents: list[tuple[Path, str, dict[str, Any], str]],
    errors: list[str],
) -> None:
    current_source_revision = f"source:{source_digest(root)}"
    work: list[tuple[Path, str, list[Any]]] = []
    for path, kind, data, _ in documents:
        revision = data.get("observed_at")
        if kind in {"behavior", "rule"}:
            work.append((path, str(revision), data.get("code_refs", [])))
        elif kind == "evidence":
            work.append((path, str(revision), data.get("source_refs", [])))
        elif kind == "asset":
            work.append((path, str(revision), data.get("code_refs", [])))
        elif kind == "capability_map":
            scenarios = data.get("scenarios", {})
            if isinstance(scenarios, dict):
                for scenario in scenarios.values():
                    if isinstance(scenario, dict):
                        work.append(
                            (path, str(revision), scenario.get("source_refs", []))
                        )
        elif kind == "audit":
            challenges = data.get("challenges", {})
            if isinstance(challenges, dict):
                for challenge in challenges.values():
                    if isinstance(challenge, dict):
                        work.append(
                            (
                                path,
                                str(
                                    challenge.get("revision", data.get("revision", ""))
                                ),
                                challenge.get("source_refs", []),
                            )
                        )
    cache: dict[tuple[str, str], bytes] = {}
    for object_path, revision, refs in work:
        if not source_revision_valid(revision) or not isinstance(refs, list):
            continue
        if revision.startswith("source:") and revision != current_source_revision:
            add_error(
                errors,
                object_path,
                f"源码摘要不可恢复：对象={revision} 当前={current_source_revision}",
            )
            continue
        for raw in refs:
            if not isinstance(raw, str):
                continue
            parsed = parse_source_ref(raw)
            if parsed is None:
                add_error(errors, object_path, f"源码引用格式无效：{raw}")
                continue
            relative, anchor = parsed
            key = (revision, relative)
            try:
                if key not in cache:
                    cache[key] = content_at_revision(root, revision, relative)
                content = cache[key]
            except (OSError, RuntimeError, UnicodeError) as error:
                add_error(errors, object_path, f"源码引用不存在：{raw}（{error}）")
                continue
            if anchor and anchor not in content.decode("utf-8", errors="replace"):
                add_error(errors, object_path, f"源码引用锚点不存在：{raw}")


def git_file_paths(root: Path) -> list[str]:
    output = run_git(
        root,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        binary=True,
    )
    raw = output if isinstance(output, bytes) else output.encode("utf-8")
    return sorted(
        path
        for path in raw.decode("utf-8", errors="strict").split("\0")
        if path
        and path != SEMANTIC_DIRECTORY
        and not path.startswith(f"{SEMANTIC_DIRECTORY}/")
    )


def source_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for relative in git_file_paths(root):
        path = root / relative
        if path.is_symlink():
            identity = "symlink:" + os.readlink(path)
        elif path.is_file():
            identity = "file:" + hashlib.sha256(path.read_bytes()).hexdigest()
        else:
            continue
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(identity.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def validate_regions(
    root: Path, baseline: dict[str, Any], path: Path, errors: list[str]
) -> None:
    regions = baseline.get("regions", [])
    if not isinstance(regions, list):
        return
    valid = [
        item
        for item in regions
        if isinstance(item, dict) and isinstance(item.get("path"), str)
    ]
    matched_regions: set[str] = set()
    for relative in git_file_paths(root):
        matches = [
            item["path"]
            for item in valid
            if relative == item["path"]
            or relative.startswith(f"{item['path'].rstrip('/')}/")
        ]
        if not matches:
            add_error(errors, path, f"未分类 Git 路径：{relative}")
        elif len(matches) > 1:
            add_error(errors, path, f"Git 路径命中多个区域：{relative} -> {matches}")
        else:
            matched_regions.add(matches[0])
    for item in valid:
        if item["path"] not in matched_regions:
            add_error(errors, path, f"区域没有对应 Git 路径：{item['path']}")


def validate_strict_snapshot(
    root: Path, baseline: dict[str, Any], path: Path, errors: list[str]
) -> None:
    snapshot = baseline.get("source_snapshot", {})
    if not isinstance(snapshot, dict):
        return
    base = snapshot.get("base_revision")
    if isinstance(base, str) and GIT_REVISION_PATTERN.fullmatch(base):
        try:
            run_git(root, "cat-file", "-e", f"{base}^{{commit}}")
            result = subprocess.run(
                ["git", "-C", str(root), "merge-base", "--is-ancestor", base, "HEAD"],
                check=False,
                capture_output=True,
            )
            if result.returncode != 0:
                add_error(errors, path, f"基准 revision 不是当前 HEAD 的祖先：{base}")
        except RuntimeError as error:
            add_error(errors, path, f"基准 revision 不可用：{error}")
    expected = snapshot.get("content_digest")
    actual = source_digest(root)
    if expected != actual:
        add_error(errors, path, f"内容摘要不一致：材料={expected} 当前={actual}")


def preflight_path(root: Path) -> Path:
    return (root / ".echo-semantic" / "preflight.json").resolve()


def load_preflight(root: Path) -> dict[str, Any] | None:
    path = preflight_path(root)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"无法读取预检状态：{error}") from error
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        raise RuntimeError("预检状态版本无效")
    return data


def changed_paths(root: Path, base: str) -> list[str]:
    output = run_git(root, "diff", "--name-only", "--diff-filter=ACDMRT", base, "--")
    tracked = str(output).splitlines()
    untracked_output = run_git(root, "ls-files", "--others", "--exclude-standard")
    return sorted({*tracked, *str(untracked_output).splitlines()})


def added_lines(root: Path, base: str, relative: str) -> list[str]:
    path = root / relative
    try:
        tracked = bool(
            str(run_git(root, "ls-files", "--error-unmatch", relative)).strip()
        )
    except RuntimeError:
        tracked = False
    if not tracked and path.is_file():
        try:
            return path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeError):
            return []
    try:
        output = run_git(root, "diff", "--unified=0", base, "--", relative)
    except RuntimeError:
        return []
    return [
        line[1:]
        for line in str(output).splitlines()
        if line.startswith("+") and not line.startswith("+++")
    ]


def infer_signals(
    root: Path,
    base: str,
    paths: list[str],
    in_scope_paths: set[str] | None = None,
) -> tuple[dict[str, bool], set[str]]:
    signals = {
        "publicApi": False,
        "newStateAuthority": False,
        "newProtocol": False,
        "crossServiceMigration": False,
        "unknownProductionCode": False,
    }
    high_paths: set[str] = set()
    for relative in paths:
        path_parts = PurePosixPath(relative).parts
        parts = set(path_parts)
        suffix = PurePosixPath(relative).suffix.lower()
        lines = added_lines(root, base, relative)
        protocol_path = bool(parts & PROTOCOL_SEGMENTS) or any(
            part.lower().endswith(("-contract", "-contracts", "-protocol", "-schema"))
            for part in path_parts
        )
        if (
            protocol_path
            or suffix in {".proto", ".graphql", ".avsc"}
            or "openapi" in relative.lower()
        ):
            signals["newProtocol"] = True
            high_paths.add(relative)
        if parts & MIGRATION_SEGMENTS:
            signals["crossServiceMigration"] = True
            high_paths.add(relative)
        pattern = PUBLIC_PATTERNS.get(suffix)
        if (
            pattern
            and (in_scope_paths is None or relative in in_scope_paths)
            and any(pattern.search(line) for line in lines)
        ):
            signals["publicApi"] = True
            high_paths.add(relative)
        elif (
            (suffix in UNKNOWN_SOURCE_SUFFIXES or suffix in SOURCE_SUFFIXES)
            and pattern is None
            and (in_scope_paths is None or relative in in_scope_paths)
        ):
            signals["unknownProductionCode"] = True
            high_paths.add(relative)
        if any(STATE_AUTHORITY_PATTERN.search(line) for line in lines):
            signals["newStateAuthority"] = True
            high_paths.add(relative)
    return signals, high_paths


def allowed_path(relative: str, values: Any) -> bool:
    return isinstance(values, list) and any(
        isinstance(item, str)
        and (relative == item or relative.startswith(f"{item.rstrip('/')}/"))
        for item in values
    )


def in_scope_code_paths(
    objects: dict[str, tuple[str, dict[str, Any], Path]], paths: list[str]
) -> set[str]:
    baseline = objects.get("baseline.repository")
    if baseline is None:
        return set(paths)
    regions = baseline[1].get("regions", [])
    if not isinstance(regions, list):
        return set(paths)
    scoped: set[str] = set()
    for relative in paths:
        for region in regions:
            if not isinstance(region, dict) or region.get("status") != "in_scope":
                continue
            prefix = region.get("path")
            if isinstance(prefix, str) and (
                relative == prefix or relative.startswith(f"{prefix.rstrip('/')}/")
            ):
                scoped.add(relative)
                break
    return scoped


def validate_change_evidence(
    root: Path,
    semantic_root: Path,
    base: str,
    objects: dict[str, tuple[str, dict[str, Any], Path]],
    errors: list[str],
) -> None:
    try:
        run_git(root, "cat-file", "-e", f"{base}^{{commit}}")
        paths = changed_paths(root, base)
    except RuntimeError as error:
        add_error(errors, semantic_root, f"无法读取变更基准：{error}")
        return
    code_paths = [
        path
        for path in paths
        if path != SEMANTIC_DIRECTORY and not path.startswith(f"{SEMANTIC_DIRECTORY}/")
    ]
    semantic_paths = [
        path for path in paths if path.startswith(f"{SEMANTIC_DIRECTORY}/")
    ]
    if not code_paths:
        return

    try:
        preflight = load_preflight(root)
    except RuntimeError as error:
        add_error(errors, semantic_root, str(error))
        preflight = None
    inferred, high_paths = infer_signals(
        root, base, code_paths, in_scope_code_paths(objects, code_paths)
    )
    deleted_paths = [path for path in code_paths if not (root / path).exists()]
    high_paths.update(deleted_paths)
    declared: dict[str, Any] = {}
    if preflight is not None:
        for issue in validate_preflight(preflight, root, expected_base=base):
            add_error(errors, semantic_root, f"语义预检合同无效：{issue}")
        for relative in code_paths:
            if not allowed_path(relative, preflight.get("allowedPaths")):
                add_error(errors, semantic_root, f"变化超出预检允许路径：{relative}")
        declared = (
            preflight.get("signals", {})
            if isinstance(preflight.get("signals"), dict)
            else {}
        )
        for signal, active in inferred.items():
            if active and not declared.get(signal):
                add_error(
                    errors, semantic_root, f"预检未声明机器识别的高风险信号：{signal}"
                )
        for ref in preflight.get("semanticRefs", []):
            if ref not in objects:
                add_error(errors, semantic_root, f"预检引用不存在语义对象：{ref}")

    high_risk = bool(high_paths) or any(bool(value) for value in declared.values())
    if not high_risk:
        return
    evidence_paths = [
        path
        for path in semantic_paths
        if any(
            path.startswith(f"{SEMANTIC_DIRECTORY}/{directory}/")
            for directory in (
                "maps",
                "behaviors",
                "rules",
                "evidence",
                "findings",
                "audits",
                "discovery",
                "assets",
            )
        )
    ]
    if not evidence_paths:
        add_error(errors, semantic_root, "高风险变化没有同次更新语义对象")
        return
    evidence_text = "\n".join(
        (root / path).read_text(encoding="utf-8")
        for path in evidence_paths
        if (root / path).is_file()
    )
    for relative in sorted(high_paths):
        if relative not in evidence_text:
            add_error(errors, semantic_root, f"高风险路径没有同次语义依据：{relative}")

    if deleted_paths:
        if preflight is None:
            add_error(errors, semantic_root, "删除变化缺少 semantic-preflight")
        else:
            if preflight.get("risk") != "high":
                add_error(errors, semantic_root, "删除变化的 risk 必须是 high")
            repair_refs = preflight.get("repairRefs", [])
            delete_paths = preflight.get("deletePaths", [])
            if not isinstance(repair_refs, list) or not repair_refs:
                add_error(errors, semantic_root, "删除变化缺少 repairRefs")
            if not isinstance(delete_paths, list) or not delete_paths:
                add_error(errors, semantic_root, "删除变化缺少 deletePaths")
            else:
                for deleted in deleted_paths:
                    if deleted not in delete_paths:
                        add_error(errors, semantic_root, f"删除路径未获授权：{deleted}")
            for reference in repair_refs if isinstance(repair_refs, list) else []:
                target = objects.get(reference)
                if target is None or target[0] != "finding":
                    add_error(
                        errors, semantic_root, f"repairRefs 引用无效：{reference}"
                    )
                elif target[1].get("status") != "resolved":
                    add_error(errors, semantic_root, f"repairRefs 未完成：{reference}")
                else:
                    finding = target[1]
                    if finding.get("type") != "consolidation_candidate":
                        add_error(
                            errors,
                            semantic_root,
                            f"repair Finding 必须是 consolidation_candidate：{reference}",
                        )
                    if finding.get("decision") not in {"merge", "migrate", "retire"}:
                        add_error(
                            errors,
                            semantic_root,
                            f"repair Finding 缺少已批准归并决策：{reference}",
                        )
                    replacement_refs = finding.get("replacement_refs", [])
                    canonical = finding.get("canonical_asset_ref")
                    candidates = finding.get("candidate_asset_refs", [])
                    finding_delete_paths = finding.get("delete_paths", [])
                    if (
                        not isinstance(finding_delete_paths, list)
                        or not finding_delete_paths
                    ):
                        add_error(
                            errors,
                            semantic_root,
                            f"repair Finding 缺少 delete_paths：{reference}",
                        )
                    else:
                        if (
                            not isinstance(candidates, list)
                            or canonical not in candidates
                        ):
                            add_error(
                                errors,
                                semantic_root,
                                f"repair Finding 的 canonical asset 不属于 candidate_asset_refs：{reference}",
                            )
                        if isinstance(candidates, list):
                            for asset_ref in candidates:
                                asset_target = objects.get(asset_ref)
                                if asset_target is None or asset_target[0] != "asset":
                                    add_error(
                                        errors,
                                        semantic_root,
                                        f"repair Finding 的 candidate asset 引用无效：{reference} -> {asset_ref}",
                                    )
                        canonical_target = (
                            objects.get(canonical)
                            if isinstance(canonical, str)
                            else None
                        )
                        if canonical_target is None or canonical_target[0] != "asset":
                            add_error(
                                errors,
                                semantic_root,
                                f"repair Finding 的 canonical asset 引用无效：{reference} -> {canonical}",
                            )
                        else:
                            canonical_refs = canonical_target[1].get("code_refs", [])
                            if any(
                                allowed_path(deleted, [str(code_ref).split("#", 1)[0]])
                                for deleted in deleted_paths
                                for code_ref in (
                                    canonical_refs
                                    if isinstance(canonical_refs, list)
                                    else []
                                )
                            ):
                                add_error(
                                    errors,
                                    semantic_root,
                                    f"repair Finding 的 canonical asset 也在删除范围：{reference}",
                                )
                        for deleted in deleted_paths:
                            if not allowed_path(deleted, finding_delete_paths):
                                add_error(
                                    errors,
                                    semantic_root,
                                    f"repair Finding 未声明删除路径：{reference} -> {deleted}",
                                )
                    if not isinstance(replacement_refs, list) or not replacement_refs:
                        add_error(
                            errors,
                            semantic_root,
                            f"repair Finding 缺少 replacement_refs：{reference}",
                        )
                    if (
                        not isinstance(canonical, str)
                        or not isinstance(replacement_refs, list)
                        or canonical not in replacement_refs
                    ):
                        add_error(
                            errors,
                            semantic_root,
                            f"repair Finding 的 replacement_refs 未包含 canonical asset：{reference}",
                        )
                    if not isinstance(candidates, list) or len(candidates) < 2:
                        add_error(
                            errors,
                            semantic_root,
                            f"repair Finding 缺少 candidate_asset_refs：{reference}",
                        )
                    else:
                        for deleted in deleted_paths:
                            if not any(
                                (asset_target := objects.get(asset_ref)) is not None
                                and asset_target[0] == "asset"
                                and any(
                                    allowed_path(
                                        deleted, [str(code_ref).split("#", 1)[0]]
                                    )
                                    for code_ref in asset_target[1].get("code_refs", [])
                                )
                                for asset_ref in candidates
                            ):
                                add_error(
                                    errors,
                                    semantic_root,
                                    f"repair Finding 的 candidate_assets 未覆盖删除路径：{reference} -> {deleted}",
                                )
                    if (
                        not isinstance(finding.get("rollback_ref"), str)
                        or not finding.get("rollback_ref", "").strip()
                    ):
                        add_error(
                            errors,
                            semantic_root,
                            f"repair Finding 缺少 rollback_ref：{reference}",
                        )
                    evidence_refs = finding.get("verification_evidence_refs", [])
                    if not isinstance(evidence_refs, list) or not evidence_refs:
                        add_error(
                            errors,
                            semantic_root,
                            f"repair Finding 缺少等价验证引用：{reference}",
                        )
                    for evidence_ref in (
                        evidence_refs if isinstance(evidence_refs, list) else []
                    ):
                        evidence_target = objects.get(evidence_ref)
                        if (
                            evidence_target is None
                            or evidence_target[0] != "evidence"
                            or evidence_target[1].get("evidence_type")
                            != "behavior_equivalence"
                        ):
                            add_error(
                                errors,
                                semantic_root,
                                f"repair Finding 的 behavior_equivalence 等价验证引用无效：{evidence_ref}",
                            )
                        else:
                            evidence = evidence_target[1]
                            if evidence.get("before_revision") != base:
                                add_error(
                                    errors,
                                    semantic_root,
                                    f"等价 Evidence 的 before_revision 未绑定删除基准：{evidence_ref}",
                                )
                            current_revision = f"source:{source_digest(root)}"
                            if evidence.get("after_revision") != current_revision:
                                add_error(
                                    errors,
                                    semantic_root,
                                    f"等价 Evidence 的 after_revision 未绑定当前源码：{evidence_ref}",
                                )
                            declared_deleted = evidence.get("deleted_paths", [])
                            if not isinstance(declared_deleted, list) or any(
                                not allowed_path(deleted, declared_deleted)
                                for deleted in deleted_paths
                            ):
                                add_error(
                                    errors,
                                    semantic_root,
                                    f"等价 Evidence 未覆盖全部删除路径：{evidence_ref}",
                                )
                            scenarios = evidence.get("scenario_results", {})
                            if any(
                                not isinstance(result, dict)
                                or result.get("status") != "matched"
                                for result in scenarios.values()
                            ):
                                add_error(
                                    errors,
                                    semantic_root,
                                    f"行为等价 Evidence 存在未匹配场景：{evidence_ref}",
                                )

        unresolved: list[str] = []
        for kind, data, path in objects.values():
            if kind == "discovery":
                values = data.get("unresolved", [])
                if isinstance(values, list):
                    unresolved.extend(str(value) for value in values)
            elif kind == "asset" and data.get("status") == "needs_review":
                unresolved.extend(str(ref) for ref in data.get("code_refs", []))
        if unresolved:
            add_error(
                errors,
                semantic_root,
                "删除变化存在未闭合动态或 needs_review 资产："
                + ", ".join(sorted(set(unresolved))),
            )

    architectural = any(
        inferred.get(name) or declared.get(name)
        for name in (
            "newStateAuthority",
            "newProtocol",
            "crossServiceMigration",
            "architectureChange",
        )
    )
    if architectural:
        authorities: list[dict[str, Any]] = []
        for candidate in paths:
            try:
                authorities.append(validate_design_authority(root, candidate))
            except AuthorityError:
                continue
        declared_authorities = (
            preflight.get("designAuthorities", []) if preflight else []
        )
        if declared_authorities:
            for declared_authority in declared_authorities:
                if not isinstance(declared_authority, dict):
                    add_error(errors, semantic_root, "绑定的 design/ADR 结构无效")
                    continue
                authority_path = declared_authority.get("path")
                try:
                    current = validate_design_authority(root, str(authority_path))
                except AuthorityError as error:
                    add_error(errors, semantic_root, str(error))
                    continue
                if current != declared_authority:
                    add_error(
                        errors,
                        semantic_root,
                        f"design/ADR 绑定摘要已变化：{authority_path}",
                    )
                if authority_path not in paths:
                    add_error(
                        errors,
                        semantic_root,
                        f"绑定的 design/ADR 没有同次更新：{authority_path}",
                    )
        elif not authorities:
            add_error(errors, semantic_root, "架构类变化没有同次更新正式 design/ADR")


def validate_repository(
    root: Path, strict_snapshot: bool = False, base: str | None = None
) -> list[str]:
    errors: list[str] = []
    semantic_root = root / SEMANTIC_DIRECTORY
    tracked_runtime = str(
        run_git(
            root,
            "ls-files",
            "--",
            *[f"{SEMANTIC_DIRECTORY}/{name}" for name in sorted(RUNTIME_STATE_FILES)],
        )
    ).splitlines()
    for relative in tracked_runtime:
        add_error(errors, root / relative, "运行态文件不能被 Git 跟踪")
    documents = collect_documents(semantic_root, errors)
    for path, kind, data, body in documents:
        validate_common(path, kind, data, body, errors)
        if kind == "baseline":
            validate_baseline(data, path, errors)
        elif kind == "capability_map":
            validate_map(data, path, errors)
        elif kind in {"behavior", "rule"}:
            validate_behavior_rule(data, kind, path, errors)
        elif kind == "asset":
            validate_asset(data, path, errors)
        else:
            validate_special(data, kind, path, errors)
    objects = validate_relations(documents, errors)
    validate_continuity_repository_evidence(root, documents, errors)
    baseline_entry = next((item for item in documents if item[1] == "baseline"), None)
    if baseline_entry:
        validate_regions(root, baseline_entry[2], baseline_entry[0], errors)
        validate_source_refs(root, documents, errors)
        if strict_snapshot:
            validate_strict_snapshot(root, baseline_entry[2], baseline_entry[0], errors)
    if base is not None:
        validate_change_evidence(root, semantic_root, base, objects, errors)
    return errors


def write_document(path: Path, data: dict[str, Any], headings: Iterable[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frontmatter = yaml.safe_dump(data, allow_unicode=True, sort_keys=False).rstrip()
    body = "\n\n".join(f"## {heading}\n\n已记录。" for heading in headings)
    path.write_text(
        f"---\n{frontmatter}\n---\n\n# 自测对象\n\n{body}\n", encoding="utf-8"
    )


def run_self_test() -> int:
    with tempfile.TemporaryDirectory(prefix="echo-semantic-") as temporary:
        root = Path(temporary) / "repository"
        root.mkdir()
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        subprocess.run(
            ["git", "-C", str(root), "config", "user.email", "test@example.com"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(root), "config", "user.name", "Test"], check=True
        )
        source = root / "src" / "lib.rs"
        source.parent.mkdir()
        source.write_text("pub fn run() {}\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(root), "add", "src/lib.rs"], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                "source",
            ],
            check=True,
        )
        revision = str(run_git(root, "rev-parse", "HEAD")).strip()
        semantic = root / SEMANTIC_DIRECTORY
        for directory in REQUIRED_DIRECTORIES:
            (semantic / directory).mkdir(parents=True)
        (semantic / "README.md").write_text("# 自测语义材料\n", encoding="utf-8")
        behavior_id = "behavior.run"
        evidence_id = "evidence.run"
        map_id = "map.runtime"
        rule_id = "rule.single-authority"
        behavior = semantic / "behaviors" / f"{behavior_id}.md"
        write_document(
            behavior,
            {
                "schema_version": 1,
                "id": behavior_id,
                "kind": "behavior",
                "status": "verified",
                "expectation": "inferred",
                "risk": "high",
                "primary_focus": "time_lifecycle",
                "focus": ["contract_evidence"],
                "boundary": "boundary.runtime",
                "observed_at": revision,
                "code_refs": ["src/lib.rs#run"],
                "rule_refs": [rule_id],
                "evidence_refs": [evidence_id],
                "finding_refs": [],
            },
            REQUIRED_HEADINGS["behavior"],
        )
        write_document(
            semantic / "rules" / f"{rule_id}.md",
            {
                "schema_version": 1,
                "id": rule_id,
                "kind": "rule",
                "status": "verified",
                "expectation": "inferred",
                "risk": "high",
                "primary_focus": "state_authority",
                "focus": [],
                "observed_at": revision,
                "behavior_refs": [behavior_id],
                "code_refs": ["src/lib.rs#run"],
                "evidence_refs": [evidence_id],
                "finding_refs": [],
            },
            REQUIRED_HEADINGS["rule"],
        )
        write_document(
            semantic / "evidence" / f"{evidence_id}.md",
            {
                "schema_version": 1,
                "id": evidence_id,
                "kind": "evidence",
                "observed_at": revision,
                "source_refs": ["src/lib.rs#run"],
                "supports": [behavior_id, rule_id],
                "limitations": [],
            },
            REQUIRED_HEADINGS["evidence"],
        )
        write_document(
            semantic / "maps" / f"{map_id}.md",
            {
                "schema_version": 1,
                "id": map_id,
                "kind": "capability_map",
                "title": "运行能力",
                "risk": "high",
                "observed_at": revision,
                "boundary_refs": ["boundary.runtime"],
                "behavior_refs": [behavior_id],
                "rule_refs": [rule_id],
                "evidence_refs": [evidence_id],
                "finding_refs": [],
                "audit_refs": [],
                "related_map_refs": [],
                "scenarios": {
                    "run": {
                        "status": "mapped",
                        "source_refs": ["src/lib.rs#run"],
                        "behavior_refs": [behavior_id],
                    }
                },
            },
            REQUIRED_HEADINGS["capability_map"],
        )
        coverage = [
            {"region": "src", "lens": lens, "status": "covered", "refs": [map_id]}
            for lens in sorted(LENS_VALUES)
        ]
        write_document(
            semantic / "baseline.md",
            {
                "schema_version": 1,
                "id": "baseline.repository",
                "kind": "baseline",
                "source_snapshot": {
                    "base_revision": revision,
                    "content_digest": source_digest(root),
                },
                "inventory_closure": "closed",
                "behavior_model_closure": "closed",
                "map_refs": [map_id],
                "regions": [{"path": "src", "status": "in_scope"}],
                "boundaries": [
                    {"id": "boundary.runtime", "map_ref": map_id, "risk": "high"}
                ],
                "coverage": coverage,
            },
            REQUIRED_HEADINGS["baseline"],
        )
        errors = validate_repository(root, strict_snapshot=True)
        if errors:
            print("有效自测样本未通过：", *errors, sep="\n", file=sys.stderr)
            return 1
        equivalence = {
            "schema_version": 1,
            "id": "evidence.equivalence",
            "kind": "evidence",
            "observed_at": revision,
            "source_refs": ["src/lib.rs#run"],
            "supports": [behavior_id],
            "limitations": ["只覆盖已列出的场景"],
            "evidence_type": "behavior_equivalence",
            "before_revision": revision,
            "after_revision": revision,
            "scenario_results": {
                "run": {"status": "matched", "source_refs": ["src/lib.rs#run"]}
            },
            "command_results": [{"command": "project test", "exit_code": 0}],
            "coverage": ["run"],
        }
        equivalence_errors: list[str] = []
        validate_special(
            equivalence,
            "evidence",
            semantic / "evidence/equivalence.md",
            equivalence_errors,
        )
        if equivalence_errors:
            print(
                "行为等价 Evidence 自测失败：",
                *equivalence_errors,
                sep="\n",
                file=sys.stderr,
            )
            return 1
        broken_equivalence = dict(equivalence)
        broken_equivalence["command_results"] = [
            {"command": "project test", "exit_code": 1}
        ]
        broken_errors: list[str] = []
        validate_special(
            broken_equivalence,
            "evidence",
            semantic / "evidence/broken-equivalence.md",
            broken_errors,
        )
        if not any("等价命令 0 未成功" in item for item in broken_errors):
            print("失败的行为等价命令未被拒绝", file=sys.stderr)
            return 1
        continuity = {
            "schema_version": 1,
            "id": "evidence.continuity",
            "kind": "evidence",
            "observed_at": f"source:{source_digest(root)}",
            "source_refs": ["src/lib.rs#run"],
            "supports": [],
            "limitations": ["只覆盖自测义务"],
            "evidence_type": "semantic_continuity",
            "merge_base_revision": revision,
            "predecessor_revisions": [revision],
            "result_snapshot": f"source:{source_digest(root)}",
            "resolutions": {
                "behavior.legacy": {
                    "disposition": "retired",
                    "predecessor_fingerprints": {revision: "1" * 64},
                    "evidence_refs": [],
                    "decision_authorities": [
                        {
                            "kind": "adr",
                            "path": "docs/adr/retire.md",
                            "content_digest": "2" * 64,
                        }
                    ],
                    "compatibility_impact": "不再提供旧行为",
                    "rollback_ref": "revert self-test",
                }
            },
        }
        continuity_errors: list[str] = []
        validate_special(
            continuity,
            "evidence",
            semantic / "evidence/evidence.continuity.md",
            continuity_errors,
        )
        if continuity_errors:
            print(
                "语义连续性 Evidence 自测失败：",
                *continuity_errors,
                sep="\n",
                file=sys.stderr,
            )
            return 1
        broken_continuity = dict(continuity)
        broken_continuity["result_snapshot"] = revision
        broken_continuity_errors: list[str] = []
        validate_special(
            broken_continuity,
            "evidence",
            semantic / "evidence/evidence.broken-continuity.md",
            broken_continuity_errors,
        )
        if not any("result_snapshot" in item for item in broken_continuity_errors):
            print("自引用结果 revision 未被拒绝", file=sys.stderr)
            return 1
        asset = {
            "schema_version": 1,
            "id": "asset.run",
            "kind": "asset",
            "title": "src/lib.rs",
            "asset_type": "file",
            "status": "active",
            "risk": "low",
            "observed_at": f"source:{source_digest(root)}",
            "boundary_refs": [],
            "code_refs": ["src/lib.rs#run"],
            "consumer_refs": [],
            "behavior_refs": [],
            "rule_refs": [],
            "evidence_refs": [],
            "finding_refs": [],
        }
        asset_errors: list[str] = []
        validate_asset(asset, semantic / "assets/asset.run.md", asset_errors)
        if asset_errors:
            print("asset 对象自测失败：", *asset_errors, sep="\n", file=sys.stderr)
            return 1
        finding = {
            "schema_version": 1,
            "id": "finding.consolidation.run",
            "kind": "finding",
            "type": "consolidation_candidate",
            "status": "open",
            "severity": "medium",
            "primary_focus": "state_authority",
            "focus": ["contract_evidence"],
            "boundary_ref": "boundary.runtime",
            "behavior_refs": [],
            "rule_refs": [],
            "evidence_refs": [],
            "audit_refs": [],
            "decision_refs": [],
            "repair_evidence_refs": [],
            "verification_evidence_refs": [],
            "rereview_audit_refs": [],
            "discovered_at": revision,
            "candidate_asset_refs": ["asset.run", "asset.run-alt"],
            "decision": "defer",
        }
        finding_errors: list[str] = []
        validate_special(
            finding,
            "finding",
            semantic / "findings/finding.consolidation.run.md",
            finding_errors,
        )
        if finding_errors:
            print("归并 Finding 自测失败：", *finding_errors, sep="\n", file=sys.stderr)
            return 1
        evidence = semantic / "evidence" / f"{evidence_id}.md"
        original = evidence.read_text(encoding="utf-8")
        evidence.write_text(
            original.replace("src/lib.rs#run", "src/missing.rs#run"), encoding="utf-8"
        )
        if not any("源码引用不存在" in item for item in validate_repository(root)):
            print("失效源码引用未被拒绝", file=sys.stderr)
            return 1
        evidence.write_text(original, encoding="utf-8")
        (root / "unclassified.txt").write_text("x\n", encoding="utf-8")
        if not any("未分类 Git 路径" in item for item in validate_repository(root)):
            print("未分类路径未被拒绝", file=sys.stderr)
            return 1
        (root / "unclassified.txt").unlink()
        subprocess.run(["git", "-C", str(root), "add", "."], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                "baseline",
            ],
            check=True,
        )
        change_base = str(run_git(root, "rev-parse", "HEAD")).strip()
        old_source = root / "src" / "old.rs"
        old_source.write_text("pub fn old() {}\n", encoding="utf-8")
        baseline_text = (semantic / "baseline.md").read_text(encoding="utf-8")
        baseline_digest = re.search(r"content_digest:\s*([0-9a-f]{64})", baseline_text)
        if baseline_digest is None:
            print("删除自测基线缺少内容摘要", file=sys.stderr)
            return 1
        (semantic / "baseline.md").write_text(
            baseline_text.replace(baseline_digest.group(1), source_digest(root), 1),
            encoding="utf-8",
        )
        subprocess.run(["git", "-C", str(root), "add", "."], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                "deletion baseline",
            ],
            check=True,
        )
        deletion_base = str(run_git(root, "rev-parse", "HEAD")).strip()
        old_source.unlink()
        repair_path = semantic / "findings" / "finding.repair.md"
        write_document(
            repair_path,
            {
                "id": "finding.repair",
                "kind": "finding",
                "status": "resolved",
                "type": "consolidation_candidate",
                "decision": "migrate",
                "canonical_asset_ref": "asset.run",
                "severity": "high",
                "primary_focus": "state_authority",
                "boundary_ref": "boundary.runtime",
                "candidate_asset_refs": ["asset.old", "asset.run"],
                "delete_paths": ["src/old.rs"],
                "replacement_refs": ["asset.run"],
                "rollback_ref": "revert deletion-self-test",
                "repair_evidence_refs": ["evidence.equivalence"],
                "verification_evidence_refs": ["evidence.equivalence"],
                "rereview_audit_refs": ["audit.repair"],
            },
            REQUIRED_HEADINGS["finding"],
        )
        equivalence_path = semantic / "evidence" / "evidence.equivalence.md"
        write_document(
            equivalence_path,
            {
                "id": "evidence.equivalence",
                "kind": "evidence",
                "evidence_type": "behavior_equivalence",
                "observed_at": f"source:{source_digest(root)}",
                "source_refs": ["src/lib.rs#run"],
                "supports": [],
                "limitations": ["只覆盖自测场景"],
                "before_revision": deletion_base,
                "after_revision": f"source:{source_digest(root)}",
                "deleted_paths": ["src/old.rs"],
                "scenario_results": {
                    "run": {
                        "status": "matched",
                        "source_refs": ["src/lib.rs#run"],
                    }
                },
                "command_results": [{"command": "project test", "exit_code": 0}],
                "coverage": ["run"],
            },
            REQUIRED_HEADINGS["evidence"],
        )
        preflight_path = semantic / "preflight.json"
        preflight_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "pluginId": PLUGIN_ID,
                    "scope": "task",
                    "repositoryRoot": str(root.resolve()),
                    "baseRevision": deletion_base,
                    "recordedAt": datetime.now(timezone.utc).isoformat(),
                    "taskId": "deletion-self-test",
                    "kind": "refactor",
                    "risk": "high",
                    "allowedPaths": ["src"],
                    "reuse": ["finding.repair"],
                    "verifications": ["project test"],
                    "basis": [],
                    "semanticRefs": [],
                    "repairRefs": ["finding.repair"],
                    "deletePaths": ["src/old.rs"],
                    "signals": {
                        "publicApi": False,
                        "newStateAuthority": False,
                        "newProtocol": False,
                        "crossServiceMigration": False,
                        "architectureChange": False,
                        "unknownProductionCode": False,
                    },
                    "boundaryDecision": {"createsNew": False, "reason": "复用边界"},
                    "designAuthorities": [],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        repair_objects = {
            "finding.repair": (
                "finding",
                {
                    "status": "resolved",
                    "type": "consolidation_candidate",
                    "decision": "migrate",
                    "canonical_asset_ref": "asset.run",
                    "candidate_asset_refs": ["asset.old", "asset.run"],
                    "delete_paths": ["src/old.rs"],
                    "replacement_refs": ["asset.run"],
                    "rollback_ref": "revert deletion-self-test",
                    "verification_evidence_refs": ["evidence.equivalence"],
                },
                repair_path,
            ),
            "asset.old": (
                "asset",
                {
                    **asset,
                    "id": "asset.old",
                    "title": "src/old.rs",
                    "code_refs": ["src/old.rs#old"],
                },
                semantic / "assets/asset.old.md",
            ),
            "asset.run": ("asset", asset, semantic / "assets/asset.run.md"),
            "evidence.equivalence": (
                "evidence",
                {
                    "evidence_type": "behavior_equivalence",
                    "before_revision": deletion_base,
                    "after_revision": f"source:{source_digest(root)}",
                    "deleted_paths": ["src/old.rs"],
                    "scenario_results": {"run": {"status": "matched"}},
                },
                equivalence_path,
            ),
        }
        missing_equivalence: list[str] = []
        validate_change_evidence(
            root,
            semantic,
            deletion_base,
            {"finding.repair": repair_objects["finding.repair"]},
            missing_equivalence,
        )
        if not any("behavior_equivalence" in item for item in missing_equivalence):
            print("删除缺少等价 Evidence 时未被拒绝", file=sys.stderr)
            return 1
        deletion_errors: list[str] = []
        validate_change_evidence(
            root, semantic, deletion_base, repair_objects, deletion_errors
        )
        if deletion_errors:
            print(
                "完整删除证据自测未通过：", *deletion_errors, sep="\n", file=sys.stderr
            )
            return 1
        wrong_revision_objects = dict(repair_objects)
        wrong_revision_evidence = dict(repair_objects["evidence.equivalence"][1])
        wrong_revision_evidence["before_revision"] = "0" * 40
        wrong_revision_objects["evidence.equivalence"] = (
            "evidence",
            wrong_revision_evidence,
            equivalence_path,
        )
        wrong_revision_errors: list[str] = []
        validate_change_evidence(
            root,
            semantic,
            deletion_base,
            wrong_revision_objects,
            wrong_revision_errors,
        )
        if not any("before_revision" in item for item in wrong_revision_errors):
            print("错误删除基准未被拒绝", file=sys.stderr)
            return 1
        deleted_canonical_objects = dict(repair_objects)
        deleted_canonical_finding = dict(repair_objects["finding.repair"][1])
        deleted_canonical_finding["canonical_asset_ref"] = "asset.old"
        deleted_canonical_finding["replacement_refs"] = ["asset.old"]
        deleted_canonical_objects["finding.repair"] = (
            "finding",
            deleted_canonical_finding,
            repair_path,
        )
        deleted_canonical_errors: list[str] = []
        validate_change_evidence(
            root,
            semantic,
            deletion_base,
            deleted_canonical_objects,
            deleted_canonical_errors,
        )
        if not any(
            "canonical asset 也在删除范围" in item for item in deleted_canonical_errors
        ):
            print("删除 canonical asset 未被拒绝", file=sys.stderr)
            return 1
        unknown_objects = dict(repair_objects)
        unknown_objects["discovery.dynamic"] = (
            "discovery",
            {"unresolved": ["src/old.rs"]},
            semantic / "discovery/discovery.dynamic.md",
        )
        unknown_errors: list[str] = []
        validate_change_evidence(
            root, semantic, deletion_base, unknown_objects, unknown_errors
        )
        if not any("未闭合动态" in item for item in unknown_errors):
            print("动态未知未被拒绝", file=sys.stderr)
            return 1
        preflight_path.unlink()
        repair_path.unlink()
        equivalence_path.unlink()
        old_source.write_text("pub fn old() {}\n", encoding="utf-8")
        refreshed_baseline = semantic / "baseline.md"
        refreshed_text = refreshed_baseline.read_text(encoding="utf-8")
        refreshed_digest = re.search(
            r"content_digest:\s*([0-9a-f]{64})", refreshed_text
        )
        if refreshed_digest is None:
            print("恢复自测基线缺少内容摘要", file=sys.stderr)
            return 1
        refreshed_baseline.write_text(
            refreshed_text.replace(refreshed_digest.group(1), source_digest(root), 1),
            encoding="utf-8",
        )
        change_base = deletion_base
        language_cases = (
            ("src/api.py", "def public_api():\n    return None\n", "publicApi"),
            ("src/api.go", "package api\nfunc PublicAPI() {}\n", "publicApi"),
            ("src/reexport.rs", "pub use crate::run;\n", "publicApi"),
            ("src/Api.kt", "class PublicApi\n", "unknownProductionCode"),
            ("src/api.dart", "class PublicApi {}\n", "unknownProductionCode"),
            ("src/api.scala", "object PublicApi\n", "unknownProductionCode"),
            ("src/build.zig", "pub fn build() void {}\n", "unknownProductionCode"),
            ("src/api.ex", "defmodule PublicApi do\nend\n", "unknownProductionCode"),
        )
        for relative, content, expected_signal in language_cases:
            candidate = root / relative
            candidate.write_text(content, encoding="utf-8")
            signals, _ = infer_signals(root, change_base, [relative], {relative})
            if not signals[expected_signal]:
                print(
                    f"多语言高风险信号未识别：{relative}/{expected_signal}",
                    file=sys.stderr,
                )
                return 1
            candidate.unlink()
        source.write_text("pub fn run() {}\npub fn new_api() {}\n", encoding="utf-8")
        baseline = semantic / "baseline.md"
        baseline_text = baseline.read_text(encoding="utf-8")
        old_digest = re.search(r"content_digest:\s*([0-9a-f]{64})", baseline_text)
        if old_digest is None:
            print("自测基线缺少内容摘要", file=sys.stderr)
            return 1
        baseline.write_text(
            baseline_text.replace(old_digest.group(1), source_digest(root), 1),
            encoding="utf-8",
        )
        errors = validate_repository(root, strict_snapshot=True, base=change_base)
        if not any("高风险变化没有同次更新语义对象" in item for item in errors):
            print("缺少语义依据的高风险变化未被拒绝", file=sys.stderr)
            return 1
        behavior.write_text(
            behavior.read_text(encoding="utf-8") + "\n高风险更新：src/lib.rs\n",
            encoding="utf-8",
        )
        errors = validate_repository(root, strict_snapshot=True, base=change_base)
        if errors:
            print(
                "补充语义依据后的高风险变化未通过：", *errors, sep="\n", file=sys.stderr
            )
            return 1
    print("语义治理校验器自测通过")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="校验语义材料和代码变更依据")
    parser.add_argument("--root", type=Path, help="目标仓库根目录")
    parser.add_argument(
        "--strict-snapshot", action="store_true", help="要求源码摘要与当前工作树一致"
    )
    parser.add_argument("--base", help="用于增量变更门禁的 Git 基准 revision")
    parser.add_argument(
        "--require-change-evidence",
        action="store_true",
        help="对高风险差异强制语义和设计依据",
    )
    parser.add_argument(
        "--self-test", action="store_true", help="运行内置有效与无效样本"
    )
    parser.add_argument("--continuity-merge-base", help="语义连续性比较的共同 Git 基准")
    parser.add_argument(
        "--continuity-predecessor",
        action="append",
        default=[],
        help="语义连续性比较的前置 revision，可重复提供",
    )
    parser.add_argument("--continuity-result", help="语义连续性比较的候选结果 revision")
    parser.add_argument(
        "--continuity-report", type=Path, help="可选的连续性 JSON 报告路径"
    )
    args = parser.parse_args()
    continuity_requested = bool(
        args.continuity_merge_base
        or args.continuity_predecessor
        or args.continuity_result
        or args.continuity_report
    )
    if args.self_test:
        if (
            args.root is not None
            or args.base is not None
            or args.strict_snapshot
            or continuity_requested
        ):
            parser.error("--self-test 不能与仓库参数同时使用")
        return run_self_test()
    if args.root is None:
        parser.error("必须提供 --root 或 --self-test")
    supplied = args.root.expanduser().resolve()
    try:
        root_value = run_git(supplied, "rev-parse", "--show-toplevel")
        root = Path(str(root_value).strip()).resolve()
        if continuity_requested:
            if (
                not args.continuity_merge_base
                or not args.continuity_predecessor
                or not args.continuity_result
            ):
                parser.error(
                    "连续性门禁必须同时提供 --continuity-merge-base、"
                    "--continuity-predecessor 和 --continuity-result"
                )
            if (
                args.base is not None
                or args.strict_snapshot
                or args.require_change_evidence
            ):
                parser.error("连续性门禁不能与单基准仓库校验参数同时使用")
            report = compare_continuity(
                root,
                args.continuity_merge_base,
                args.continuity_predecessor,
                args.continuity_result,
            )
            encoded = (
                json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
            )
            if args.continuity_report is not None:
                destination = args.continuity_report.expanduser().resolve()
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(encoded, encoding="utf-8")
            print(encoded, end="")
            return 0 if report["passed"] else 1
        base = args.base if args.require_change_evidence or args.base else None
        if args.require_change_evidence and not base:
            parser.error("--require-change-evidence 必须同时提供 --base")
        errors = validate_repository(
            root, strict_snapshot=args.strict_snapshot, base=base
        )
    except (OSError, RuntimeError, UnicodeError) as error:
        print(f"语义治理校验失败：{error}", file=sys.stderr)
        return 1
    if errors:
        print(f"语义治理校验失败，共 {len(errors)} 项：", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"语义治理校验通过：{root / SEMANTIC_DIRECTORY}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
