"""扫描报告的确定性合同；候选报告不定义正式语义。"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import uuid
from pathlib import Path, PurePosixPath
from typing import Any


def report_digest(report: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(
            report, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode()
    ).hexdigest()


def validate_scan_report(data: Any) -> list[str]:
    errors: list[str] = []
    if (
        not isinstance(data, dict)
        or data.get("kind") != "discovery"
        or not isinstance(data.get("scan_report"), dict)
    ):
        return ["不是独立 Discovery 扫描报告"]
    report = data["scan_report"]
    if (
        report.get("schema_version") != 2
        or report.get("scope") != "repository"
        or report.get("analysis") != "static"
        or report.get("result") != "completed"
    ):
        errors.append("扫描报告范围、版本或完成状态无效")
    try:
        digest = report_digest(report)
    except (TypeError, ValueError, RecursionError):
        return ["扫描报告不是有界规范 JSON 数据"]
    if data.get("id") != f"discovery.scan.{digest}":
        errors.append("扫描报告内容身份不匹配")
    snapshot = report.get("source_snapshot")
    if (
        not isinstance(snapshot, dict)
        or not re.fullmatch(r"[0-9a-f]{40}", str(snapshot.get("base_revision", "")))
        or not re.fullmatch(r"[0-9a-f]{64}", str(snapshot.get("content_digest", "")))
    ):
        return errors + ["扫描快照格式无效"]
    if snapshot != data.get("source_snapshot"):
        errors.append("报告与 Discovery 快照不一致")
    paths, manifest = report.get("paths"), report.get("file_manifest")
    if (
        not isinstance(paths, list)
        or not all(
            isinstance(p, str)
            and p
            and not PurePosixPath(p).is_absolute()
            and ".." not in PurePosixPath(p).parts
            and "\\" not in p
            for p in paths
        )
        or len(set(paths)) != len(paths)
    ):
        return errors + ["扫描路径无效"]
    if not isinstance(manifest, dict) or set(paths) != set(manifest):
        return errors + ["扫描路径与文件身份不闭合"]
    if data.get("inspected_paths") != paths:
        errors.append("Discovery 扫描范围不匹配")
    if data.get("scope") != "repository" or report_digest(manifest) != snapshot.get(
        "content_digest", ""
    ):
        errors.append("报告范围或文件清单摘要不一致")
    for path, identity in manifest.items():
        if not isinstance(identity, dict) or identity.get("kind") not in {
            "file",
            "excluded",
            "missing",
        }:
            errors.append(f"扫描文件身份无效：{path}")
        elif identity["kind"] == "file" and (
            not re.fullmatch(r"[0-9a-f]{64}", str(identity.get("content_digest", "")))
            or not isinstance(identity.get("mode"), int)
        ):
            errors.append(f"扫描文件摘要或模式无效：{path}")
    if not re.fullmatch(r"[0-9a-f]{64}", str(report.get("index_digest", ""))):
        errors.append("扫描索引身份无效")
    assets, candidates = report.get("assets"), report.get("candidates")
    if not isinstance(assets, list) or not isinstance(candidates, list):
        return errors + ["扫描资产与候选必须为列表"]
    asset_ids: set[str] = set()
    for asset in assets:
        if (
            not isinstance(asset, dict)
            or not isinstance(asset.get("id"), str)
            or asset["id"] in asset_ids
        ):
            errors.append("扫描资产身份重复或无效")
            continue
        asset_ids.add(asset["id"])
        refs = asset.get("code_refs")
        if (
            not isinstance(refs, list)
            or not refs
            or any(
                not isinstance(ref, str) or ref.split("#", 1)[0] not in manifest
                for ref in refs
            )
        ):
            errors.append("候选资产引用超出扫描范围")
        consumers = asset.get("consumer_refs")
        if not isinstance(consumers, list) or any(
            not isinstance(p, str) or p not in manifest for p in consumers
        ):
            errors.append("候选消费者超出扫描范围")
    candidate_ids = []
    for candidate in candidates:
        if (
            not isinstance(candidate, dict)
            or candidate.get("decision") != "needs_review"
            or not isinstance(candidate.get("asset_refs"), list)
            or len(candidate["asset_refs"]) < 2
            or not all(isinstance(ref, str) for ref in candidate["asset_refs"])
            or not set(candidate["asset_refs"]) <= asset_ids
            or not isinstance(candidate.get("id"), str)
        ):
            errors.append("候选必须待确认并绑定扫描资产")
            continue
        candidate_ids.append(candidate.get("id"))
    if candidate_ids != data.get("candidate_refs") or len(set(candidate_ids)) != len(
        candidate_ids
    ):
        errors.append("Discovery 候选身份不闭合")
    if (
        report.get("globalClosure") != "not_checked"
        or report.get("behavior_model_closure") != "open"
    ):
        errors.append("静态报告不能宣称全项目行为闭合")
    for field in ("unresolved", "limitations", "excluded"):
        if not isinstance(report.get(field), list):
            errors.append(f"扫描报告缺少 {field}")
    if data.get("unresolved") != report.get("unresolved"):
        errors.append("Discovery 未知项不匹配")
    if (
        not isinstance(report.get("repository_root"), str)
        or not report["repository_root"]
    ):
        errors.append("报告缺少仓库身份")
    if isinstance(report.get("excluded"), list) and any(
        not isinstance(item, dict)
        or item.get("path") not in manifest
        or not isinstance(item.get("reason"), str)
        or not item.get("reason")
        for item in report["excluded"]
    ):
        errors.append("排除路径缺少范围或理由")
    return errors


def publish_report(root: Path, identifier: str, text: str) -> Path:
    """目录描述符绑定发布，拒绝 symlink 与目录身份变化；不覆盖现有报告。"""
    if os.open not in os.supports_dir_fd or os.link not in os.supports_dir_fd:
        raise ValueError("当前平台缺少安全的目录描述符发布能力")
    if not re.fullmatch(r"discovery\.scan\.[0-9a-f]{64}", identifier):
        raise ValueError("报告身份无效")
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptors = []
    temp = "echo-semantic-scan-" + str(uuid.uuid4()) + ".tmp"
    git_fd = None
    filename = identifier + ".md"
    destination = root / ".echo-semantic/discovery" / filename
    try:
        root_fd = os.open(root, flags)
        descriptors.append(root_fd)
        parent = root_fd
        bindings = [(root, root_fd)]
        for name in (".echo-semantic", "discovery"):
            try:
                os.mkdir(name, dir_fd=parent)
            except FileExistsError:
                pass
            parent = os.open(name, flags, dir_fd=parent)
            descriptors.append(parent)
            bindings.append(
                (
                    root / ".echo-semantic"
                    if name == ".echo-semantic"
                    else destination.parent,
                    parent,
                )
            )

        def check_bindings() -> None:
            for path, descriptor in bindings:
                actual = path.lstat()
                opened = os.fstat(descriptor)
                if not stat.S_ISDIR(actual.st_mode) or (
                    actual.st_dev,
                    actual.st_ino,
                ) != (opened.st_dev, opened.st_ino):
                    raise ValueError("报告目录身份变化，拒绝发布")

        check_bindings()
        try:
            descriptor = os.open(
                filename,
                os.O_RDONLY
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_NONBLOCK", 0),
                dir_fd=parent,
            )
        except FileNotFoundError:
            descriptor = None
        if descriptor is not None:
            try:
                info = os.fstat(descriptor)
                if not stat.S_ISREG(info.st_mode) or info.st_size > 16 * 1024 * 1024:
                    raise ValueError("已有报告不是有界普通文件")
                with os.fdopen(descriptor, "rb", closefd=False) as stream:
                    previous = stream.read(16 * 1024 * 1024 + 1)
                after = os.fstat(descriptor)
                current = os.stat(filename, dir_fd=parent, follow_symlinks=False)
                identity = lambda entry: (
                    entry.st_dev,
                    entry.st_ino,
                    entry.st_size,
                    entry.st_mtime_ns,
                    entry.st_ctime_ns,
                )
                if (
                    identity(info) != identity(after)
                    or identity(after) != identity(current)
                    or not stat.S_ISREG(current.st_mode)
                ):
                    raise ValueError("已有报告读取期间发生变化")
                if previous != text.encode():
                    raise ValueError("已有报告不同，禁止覆盖")
                check_bindings()
                return destination
            finally:
                os.close(descriptor)
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--absolute-git-dir"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        if result.returncode:
            raise ValueError("无法绑定 Git 私有临时目录")
        git_fd = os.open(result.stdout.strip(), flags)
        descriptors.append(git_fd)
        descriptor = os.open(
            temp,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
            dir_fd=git_fd,
        )
        try:
            with os.fdopen(descriptor, "wb", closefd=False) as stream:
                stream.write(text.encode())
                stream.flush()
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        check_bindings()
        os.link(
            temp, filename, src_dir_fd=git_fd, dst_dir_fd=parent, follow_symlinks=False
        )
        try:
            check_bindings()
        except (OSError, ValueError):
            os.unlink(filename, dir_fd=parent)
            raise
        return destination
    finally:
        if git_fd is not None:
            try:
                os.unlink(temp, dir_fd=git_fd)
            except FileNotFoundError:
                pass
        for descriptor in reversed(descriptors):
            os.close(descriptor)
