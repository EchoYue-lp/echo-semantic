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
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "scripts"))
from governance_contract import AuthorityError, validate_design_authority

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


def split_document(path: Path, errors: list[str]) -> tuple[dict[str, Any], str] | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        add_error(errors, path, f"无法读取：{error}")
        return None
    if not text.startswith("---\n"):
        add_error(errors, path, "缺少 YAML 前置元数据")
        return None
    end = text.find("\n---\n", 4)
    if end < 0:
        add_error(errors, path, "前置元数据没有结束标记")
        return None
    try:
        data = yaml.safe_load(text[4:end])
    except (yaml.YAMLError, RecursionError) as error:
        add_error(errors, path, f"YAML 无法解析：{error}")
        return None
    if not isinstance(data, dict):
        add_error(errors, path, "前置元数据必须是对象")
        return None
    return data, text[end + 5 :]


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
    elif kind == "finding":
        if data.get("type") not in {
            "implementation_bug",
            "intent_gap",
            "evidence_gap",
            "authority_conflict",
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
        elif kind == "finding":
            boundary = data.get("boundary_ref")
            if boundary not in boundary_to_map:
                add_error(errors, path, f"Finding 引用未知边界：{boundary}")
        elif kind == "audit":
            boundary = data.get("boundary_ref")
            if boundary not in boundary_to_map:
                add_error(errors, path, f"Audit 引用未知边界：{boundary}")
    return objects


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
    output = run_git(root, "diff", "--name-only", "--diff-filter=ACMRT", base, "--")
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
    declared: dict[str, Any] = {}
    if preflight is not None:
        if preflight.get("repositoryRoot") != str(root.resolve()):
            add_error(errors, semantic_root, "预检状态属于另一个仓库")
        if preflight.get("baseRevision") != base:
            add_error(errors, semantic_root, "预检基准与变更基准不一致")
        recorded_at = preflight.get("recordedAt")
        try:
            timestamp = datetime.fromisoformat(str(recorded_at))
            if timestamp.tzinfo is None:
                raise ValueError("缺少时区")
            if datetime.now(timezone.utc) - timestamp.astimezone(
                timezone.utc
            ) > timedelta(hours=24):
                add_error(errors, semantic_root, "语义预检记录已超过 24 小时")
        except (TypeError, ValueError):
            add_error(errors, semantic_root, "语义预检 recordedAt 无效")
        if not isinstance(preflight.get("taskId"), str) or not preflight.get("taskId"):
            add_error(errors, semantic_root, "语义预检缺少 taskId")
        boundary_decision = preflight.get("boundaryDecision")
        if (
            not isinstance(boundary_decision, dict)
            or not isinstance(boundary_decision.get("createsNew"), bool)
            or not isinstance(boundary_decision.get("reason"), str)
            or not boundary_decision.get("reason")
        ):
            add_error(errors, semantic_root, "语义预检缺少有效边界结论")
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
        if any(inferred.values()) or any(bool(value) for value in declared.values()):
            if preflight.get("risk") != "high":
                add_error(errors, semantic_root, "高风险变化的预检 risk 必须是 high")
            if not preflight.get("basis") or not preflight.get("semanticRefs"):
                add_error(errors, semantic_root, "高风险变化缺少依据或语义对象引用")
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
            for directory in ("maps", "behaviors", "rules", "evidence", "audits")
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
    documents = collect_documents(semantic_root, errors)
    for path, kind, data, body in documents:
        validate_common(path, kind, data, body, errors)
        if kind == "baseline":
            validate_baseline(data, path, errors)
        elif kind == "capability_map":
            validate_map(data, path, errors)
        elif kind in {"behavior", "rule"}:
            validate_behavior_rule(data, kind, path, errors)
        else:
            validate_special(data, kind, path, errors)
    objects = validate_relations(documents, errors)
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
    args = parser.parse_args()
    if args.self_test:
        if args.root is not None or args.base is not None or args.strict_snapshot:
            parser.error("--self-test 不能与仓库参数同时使用")
        return run_self_test()
    if args.root is None:
        parser.error("必须提供 --root 或 --self-test")
    supplied = args.root.expanduser().resolve()
    try:
        root_value = run_git(supplied, "rev-parse", "--show-toplevel")
        root = Path(str(root_value).strip()).resolve()
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
