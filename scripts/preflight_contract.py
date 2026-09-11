"""Echo Semantic 任务预检的共享确定性合同。"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from governance_contract import AuthorityError, validate_design_authority

PLUGIN_ID = "echo-semantic"
KINDS = {"bugfix", "feature", "refactor", "contract", "style"}
RISKS = {"low", "medium", "high"}
SIGNALS = {
    "publicApi",
    "newStateAuthority",
    "newProtocol",
    "crossServiceMigration",
    "architectureChange",
    "unknownProductionCode",
}
ARCHITECTURAL_SIGNALS = {
    "newStateAuthority",
    "newProtocol",
    "crossServiceMigration",
    "architectureChange",
}
TASK_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
DIGEST_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SEMANTIC_OBJECT_DIRECTORIES = (
    "maps",
    "behaviors",
    "rules",
    "evidence",
    "findings",
    "audits",
    "discovery",
    "assets",
)


def semantic_object_ids(root: Path) -> set[str]:
    objects: set[str] = set()
    semantic_root = root / ".echo-semantic"
    for directory in SEMANTIC_OBJECT_DIRECTORIES:
        for path in (semantic_root / directory).glob("*.md"):
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                continue
            frontmatter = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
            if frontmatter is None:
                continue
            identifier = re.search(
                r"^id:\s*['\"]?([^'\"\s]+)['\"]?\s*$",
                frontmatter.group(1),
                re.MULTILINE,
            )
            if identifier is not None:
                objects.add(identifier.group(1))
    return objects


def semantic_object_metadata(root: Path, identifier: str) -> dict[str, str] | None:
    semantic_root = root / ".echo-semantic"
    for directory in SEMANTIC_OBJECT_DIRECTORIES:
        for path in (semantic_root / directory).glob("*.md"):
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                continue
            frontmatter = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
            if frontmatter is None:
                continue
            if not re.search(
                rf"^id:\s*['\"]?{re.escape(identifier)}['\"]?\s*$",
                frontmatter.group(1),
                re.MULTILINE,
            ):
                continue
            return {
                "frontmatter": frontmatter.group(1),
                "kind": re.search(
                    r"^kind:\s*([^\s]+)\s*$", frontmatter.group(1), re.MULTILINE
                ).group(1)
                if re.search(
                    r"^kind:\s*([^\s]+)\s*$", frontmatter.group(1), re.MULTILINE
                )
                else "",
                "status": re.search(
                    r"^status:\s*([^\s]+)\s*$", frontmatter.group(1), re.MULTILINE
                ).group(1)
                if re.search(
                    r"^status:\s*([^\s]+)\s*$", frontmatter.group(1), re.MULTILINE
                )
                else "",
            }
    return None


def _string_list(
    value: Any, field: str, errors: list[str], *, required: bool = False
) -> list[str]:
    if not isinstance(value, list) or any(
        not isinstance(item, str) or not item.strip() for item in value
    ):
        errors.append(f"{field} 必须是非空字符串列表")
        return []
    if required and not value:
        errors.append(f"{field} 不能为空")
    return value


def validate_preflight(
    value: Any,
    root: Path,
    *,
    current_head: str | None = None,
    expected_base: str | None = None,
    now: datetime | None = None,
) -> list[str]:
    if not isinstance(value, dict):
        return ["预检记录必须是对象"]
    errors: list[str] = []
    if value.get("schemaVersion") != 1:
        errors.append("schemaVersion 必须是 1")
    if value.get("pluginId") != PLUGIN_ID:
        errors.append("pluginId 无效")
    if value.get("scope") != "task":
        errors.append("scope 必须是 task")
    if value.get("repositoryRoot") != str(root.resolve()):
        errors.append("repositoryRoot 与当前仓库不匹配")

    base = value.get("baseRevision")
    if not isinstance(base, str) or not REVISION_PATTERN.fullmatch(base):
        errors.append("baseRevision 必须是 40 位 Git revision")
    else:
        if current_head is not None and base != current_head:
            errors.append("baseRevision 不是当前 HEAD")
        if expected_base is not None and base != expected_base:
            errors.append("baseRevision 与变更基准不一致")

    task_id = value.get("taskId")
    if not isinstance(task_id, str) or not TASK_ID_PATTERN.fullmatch(task_id):
        errors.append("taskId 无效")
    if value.get("kind") not in KINDS:
        errors.append("kind 无效")
    if value.get("risk") not in RISKS:
        errors.append("risk 无效")

    allowed_paths = _string_list(
        value.get("allowedPaths"), "allowedPaths", errors, required=True
    )
    for raw in allowed_paths:
        path = PurePosixPath(raw)
        if path.is_absolute() or ".." in path.parts or raw in {"", "."}:
            errors.append(f"allowedPaths 包含无效路径：{raw}")
    _string_list(value.get("reuse"), "reuse", errors, required=True)
    _string_list(value.get("verifications"), "verifications", errors, required=True)
    basis = _string_list(value.get("basis"), "basis", errors)
    semantic_refs = _string_list(value.get("semanticRefs"), "semanticRefs", errors)
    known_objects = semantic_object_ids(root)
    for reference in semantic_refs:
        if reference not in known_objects:
            errors.append(f"semanticRefs 引用不存在语义对象：{reference}")

    repair_refs = value.get("repairRefs", [])
    if not isinstance(repair_refs, list) or any(
        not isinstance(item, str) or not item.strip() for item in repair_refs
    ):
        errors.append("repairRefs 必须是字符串列表")
    else:
        for reference in repair_refs:
            if reference not in known_objects:
                errors.append(f"repairRefs 引用不存在语义对象：{reference}")
            elif (
                (metadata := semantic_object_metadata(root, reference)) is None
                or metadata.get("kind") != "finding"
                or metadata.get("status") != "resolved"
            ):
                errors.append(f"repairRefs 必须引用已完成的 Finding：{reference}")
    delete_paths = value.get("deletePaths", [])
    if not isinstance(delete_paths, list) or any(
        not isinstance(item, str) or not item.strip() for item in delete_paths
    ):
        errors.append("deletePaths 必须是字符串列表")
    else:
        for raw in delete_paths:
            normalized = PurePosixPath(raw)
            if normalized.is_absolute() or ".." in normalized.parts or raw in {"", "."}:
                errors.append(f"deletePaths 包含无效路径：{raw}")
        if delete_paths and value.get("risk") != "high":
            errors.append("删除变化的 risk 必须是 high")
    if delete_paths and isinstance(repair_refs, list):
        for reference in repair_refs:
            metadata = semantic_object_metadata(root, reference)
            if metadata is None or metadata.get("kind") != "finding":
                continue
            frontmatter = metadata.get("frontmatter", "")
            for field in (
                "type",
                "decision",
                "canonical_asset_ref",
                "delete_paths",
                "replacement_refs",
                "rollback_ref",
            ):
                if not re.search(rf"^{field}:\s*", frontmatter, re.MULTILINE):
                    errors.append(f"repair Finding 缺少 {field}：{reference}")

    boundary = value.get("boundaryDecision")
    if (
        not isinstance(boundary, dict)
        or not isinstance(boundary.get("createsNew"), bool)
        or not isinstance(boundary.get("reason"), str)
        or not boundary.get("reason", "").strip()
    ):
        errors.append("boundaryDecision 无效")

    signals = value.get("signals")
    if (
        not isinstance(signals, dict)
        or set(signals) != SIGNALS
        or any(not isinstance(signals.get(name), bool) for name in SIGNALS)
    ):
        errors.append("signals 必须包含完整布尔信号集合")
        signals = {}

    authorities = value.get("designAuthorities")
    if not isinstance(authorities, list):
        errors.append("designAuthorities 必须是列表")
        authorities = []
    for authority in authorities:
        if (
            not isinstance(authority, dict)
            or authority.get("kind") not in {"design", "adr"}
            or not isinstance(authority.get("path"), str)
            or not authority.get("path", "").strip()
            or not isinstance(authority.get("contentDigest"), str)
            or not DIGEST_PATTERN.fullmatch(authority.get("contentDigest", ""))
        ):
            errors.append("designAuthorities 包含无效设计权威")
            continue
        try:
            current = validate_design_authority(
                root, authority["path"], authority["kind"]
            )
            if current != authority:
                errors.append(f"designAuthorities 内容摘要已变化：{authority['path']}")
        except AuthorityError as error:
            errors.append(str(error))

    high_risk = any(signals.get(name) for name in SIGNALS)
    if high_risk:
        if value.get("risk") != "high":
            errors.append("高风险信号要求 risk=high")
        if not basis:
            errors.append("高风险信号要求 basis")
        if not semantic_refs:
            errors.append("高风险信号要求 semanticRefs")
    if any(signals.get(name) for name in ARCHITECTURAL_SIGNALS) and not authorities:
        errors.append("架构类信号要求 designAuthorities")

    recorded_at = value.get("recordedAt")
    try:
        timestamp = datetime.fromisoformat(str(recorded_at))
        if timestamp.tzinfo is None:
            raise ValueError("缺少时区")
        current = now or datetime.now(timezone.utc)
        age = current - timestamp.astimezone(timezone.utc)
        if age < -timedelta(minutes=5) or age > timedelta(hours=24):
            errors.append("recordedAt 超出有效期")
    except (TypeError, ValueError):
        errors.append("recordedAt 无效")
    return errors
