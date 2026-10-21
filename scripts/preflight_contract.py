"""Echo Semantic 任务预检的共享确定性合同。"""

from __future__ import annotations

import hashlib
import os
import re
import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from artifact_contract import is_local_artifact
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


def source_bytes(
    root: Path, relative: str, *, max_bytes: int = 8 * 1024 * 1024
) -> bytes:
    """只读根内普通文件；支持 dir_fd 时逐层绑定目录，拒绝符号链接。"""
    if is_local_artifact(relative):
        raise ValueError(f"本地产物不能作为源码或复用依据：{relative}")
    parts = PurePosixPath(relative).parts
    if (
        not parts
        or relative in {"", "."}
        or ".." in parts
        or "\\" in relative
        or PurePosixPath(relative).is_absolute()
    ):
        raise ValueError(f"依据路径不是安全相对路径：{relative}")
    path = root / relative
    for parent in [path, *path.parents]:
        if parent == root.parent:
            break
        if parent.is_symlink():
            raise ValueError(f"依据路径含符号链接：{relative}")
    descriptors = []
    try:
        flags = (
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        )
        if os.open in os.supports_dir_fd:
            directory = os.open(root, flags | getattr(os, "O_DIRECTORY", 0))
            descriptors.append(directory)
            for part in parts[:-1]:
                directory = os.open(
                    part, flags | getattr(os, "O_DIRECTORY", 0), dir_fd=directory
                )
                descriptors.append(directory)
            descriptor = os.open(parts[-1], flags, dir_fd=directory)
        else:
            descriptor = os.open(path, flags)
        descriptors.append(descriptor)
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > max_bytes:
            raise ValueError(f"依据不是有界普通文件：{relative}")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            content = stream.read(max_bytes + 1)
        after = os.fstat(descriptor)
        current = path.lstat()
        identity = lambda item: (
            item.st_dev,
            item.st_ino,
            item.st_size,
            item.st_mtime_ns,
            item.st_ctime_ns,
        )
        if (
            len(content) > max_bytes
            or identity(before) != identity(after)
            or identity(after) != identity(current)
            or not path.resolve().is_relative_to(root.resolve())
        ):
            raise ValueError(f"依据读取期间变化：{relative}")
        return content
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def file_evidence(
    root: Path, relative: str, *, mutable: bool = False
) -> dict[str, Any]:
    return {
        "path": relative,
        "contentDigest": hashlib.sha256(source_bytes(root, relative)).hexdigest(),
        "mutable": mutable,
    }


def reuse_check_contents(
    value: Any,
    root: Path,
    allowed: list[str],
    errors: list[str],
    *,
    phase: str = "check",
) -> dict[str, bytes]:
    if not isinstance(value, dict) or set(value) != {
        "searchPaths",
        "decision",
        "reason",
        "candidates",
        "evidence",
    }:
        errors.append("reuseCheck 必须包含搜索范围、决定、理由、候选与相关依据")
        return {}
    searches = _string_list(
        value.get("searchPaths"), "reuseCheck.searchPaths", errors, required=True
    )
    for relative in searches:
        if (
            PurePosixPath(relative).is_absolute()
            or ".." in PurePosixPath(relative).parts
            or "\\" in relative
        ):
            errors.append("reuseCheck.searchPaths 包含非法路径")
            continue
        target = root if relative in {"", "."} else root / relative
        try:
            stat_result = target.lstat()
            if target.is_symlink() or not target.resolve().is_relative_to(
                root.resolve()
            ):
                errors.append(f"搜索范围不能是仓外或符号链接：{relative}")
            elif not (
                stat.S_ISREG(stat_result.st_mode) or stat.S_ISDIR(stat_result.st_mode)
            ):
                errors.append(f"搜索范围不是文件或目录：{relative}")
        except OSError:
            errors.append(f"搜索范围不存在：{relative}")
    decision = value.get("decision")
    if (
        decision not in {"reuse", "extend", "new"}
        or not isinstance(value.get("reason"), str)
        or not value.get("reason", "").strip()
    ):
        errors.append("reuseCheck 的决定或理由无效")
    candidates, evidence = value.get("candidates"), value.get("evidence")
    if not isinstance(candidates, list) or not isinstance(evidence, list):
        errors.append("reuseCheck 的候选与依据必须是列表")
        return {}
    contents: dict[str, bytes] = {}
    paths: set[str] = set()
    for item in evidence:
        if (
            not isinstance(item, dict)
            or set(item) != {"path", "contentDigest", "mutable"}
            or not isinstance(item.get("path"), str)
            or not isinstance(item.get("mutable"), bool)
            or not isinstance(item.get("contentDigest"), str)
            or not DIGEST_PATTERN.fullmatch(item.get("contentDigest", ""))
        ):
            errors.append("reuseCheck.evidence 依据格式无效")
            continue
        relative = item["path"]
        if relative in paths:
            errors.append(f"依据路径重复：{relative}")
            continue
        paths.add(relative)
        mutable = item["mutable"]
        if mutable and not any(
            relative == p or relative.startswith(p.rstrip("/") + "/") for p in allowed
        ):
            errors.append(f"可修改依据超出允许路径：{relative}")
        try:
            content = source_bytes(root, relative)
            contents[relative] = content
            if (phase == "record" or not mutable) and hashlib.sha256(
                content
            ).hexdigest() != item["contentDigest"]:
                errors.append(f"相关依据内容摘要已变化：{relative}")
        except (OSError, ValueError) as error:
            errors.append(str(error))
    selected = 0
    for candidate in candidates:
        if (
            not isinstance(candidate, dict)
            or set(candidate) != {"path", "symbol", "selected", "reason"}
            or not isinstance(candidate.get("path"), str)
            or not isinstance(candidate.get("symbol"), str)
            or not isinstance(candidate.get("selected"), bool)
            or not isinstance(candidate.get("reason"), str)
            or not candidate.get("reason", "").strip()
        ):
            errors.append("reuseCheck.candidates 候选格式无效")
            continue
        selected += int(candidate["selected"])
        content = contents.get(candidate["path"])
        if content is None:
            errors.append(f"候选没有有效内容依据：{candidate['path']}")
        elif candidate["symbol"] and not re.search(
            r"(?<!\w)" + re.escape(candidate["symbol"]) + r"(?!\w)",
            content.decode("utf-8", errors="replace"),
        ):
            errors.append(f"候选符号不存在：{candidate['path']}#{candidate['symbol']}")
    if (decision in {"reuse", "extend"} and not selected) or (
        decision == "new" and selected
    ):
        errors.append("复用决定与选定候选不一致")
    return contents


def semantic_object_index(
    root: Path, references: set[str] | None = None
) -> dict[str, dict[str, str]]:
    """单次调用内共享元数据；无引用不读取，已找到全部引用即停止。"""
    objects: dict[str, dict[str, str]] = {}
    if references == set():
        return objects
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
                metadata = frontmatter.group(1)
                kind = re.search(r"^kind:\s*([^\s]+)\s*$", metadata, re.MULTILINE)
                status = re.search(r"^status:\s*([^\s]+)\s*$", metadata, re.MULTILINE)
                objects.setdefault(
                    identifier.group(1),
                    {
                        "frontmatter": metadata,
                        "kind": kind.group(1) if kind else "",
                        "status": status.group(1) if status else "",
                    },
                )
                if references is not None and references <= objects.keys():
                    return objects
    return objects


def semantic_object_ids(root: Path) -> set[str]:
    return set(semantic_object_index(root))


def semantic_object_metadata(root: Path, identifier: str) -> dict[str, str] | None:
    return semantic_object_index(root, {identifier}).get(identifier)


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
    phase: str = "check",
) -> list[str]:
    if not isinstance(value, dict):
        return ["预检记录必须是对象"]
    errors: list[str] = []
    if value.get("schemaVersion") != 2:
        errors.append("schemaVersion 必须是 2；旧记录需要重新预检")
    if value.get("pluginId") != PLUGIN_ID:
        errors.append("pluginId 无效")
    if value.get("scope") != "task":
        errors.append("scope 必须是 task")
    if value.get("verificationScope", "task") not in ("task", "repository"):
        errors.append("verificationScope 必须是 task 或 repository")
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
    contents = reuse_check_contents(
        value.get("reuseCheck"), root, allowed_paths, errors, phase=phase
    )
    _string_list(value.get("verifications"), "verifications", errors, required=True)
    basis = _string_list(value.get("basis"), "basis", errors)
    semantic_refs = _string_list(value.get("semanticRefs"), "semanticRefs", errors)
    repair_refs = value.get("repairRefs", [])
    valid_repair_refs = isinstance(repair_refs, list) and all(
        isinstance(item, str) and item.strip() for item in repair_refs
    )
    known_objects: dict[str, dict[str, str]] = {}
    for relative, content in contents.items():
        if not relative.startswith(".echo-semantic/"):
            continue
        text = content.decode("utf-8", errors="replace")
        frontmatter = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
        if frontmatter is None:
            continue
        metadata = frontmatter.group(1)
        identifier = re.search(
            r"^id:\s*['\"]?([^'\"\s]+)['\"]?\s*$", metadata, re.MULTILINE
        )
        if identifier:
            kind = re.search(r"^kind:\s*([^\s]+)\s*$", metadata, re.MULTILINE)
            status = re.search(r"^status:\s*([^\s]+)\s*$", metadata, re.MULTILINE)
            known_objects[identifier.group(1)] = {
                "frontmatter": metadata,
                "kind": kind.group(1) if kind else "",
                "status": status.group(1) if status else "",
            }
    for reference in semantic_refs:
        if reference not in known_objects:
            errors.append(f"semanticRefs 引用不存在语义对象：{reference}")

    if not isinstance(repair_refs, list) or any(
        not isinstance(item, str) or not item.strip() for item in repair_refs
    ):
        errors.append("repairRefs 必须是字符串列表")
    else:
        for reference in repair_refs:
            if reference not in known_objects:
                errors.append(f"repairRefs 引用不存在语义对象：{reference}")
            elif (
                (metadata := known_objects.get(reference)) is None
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
    if delete_paths and valid_repair_refs:
        for reference in repair_refs:
            metadata = known_objects.get(reference)
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
        timestamp = datetime.fromisoformat(str(recorded_at).replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError("缺少时区")
        current = now or datetime.now(timezone.utc)
        age = current - timestamp.astimezone(timezone.utc)
        if age < -timedelta(minutes=5) or age > timedelta(hours=24):
            errors.append("recordedAt 超出有效期")
    except (TypeError, ValueError):
        errors.append("recordedAt 无效")
    return errors
