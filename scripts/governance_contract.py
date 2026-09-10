"""语义治理脚本共享的正式设计权威解析合同。"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path, PurePosixPath
from typing import Any


class AuthorityError(ValueError):
    """表示目标文件不是可绑定的正式设计权威。"""


def _relative_path(root: Path, value: str) -> str:
    raw = Path(value).expanduser()
    if raw.is_absolute():
        try:
            raw = raw.resolve().relative_to(root)
        except ValueError as error:
            raise AuthorityError(f"设计权威不在仓库内：{value}") from error
    relative = PurePosixPath(raw.as_posix())
    if (
        relative.is_absolute()
        or ".." in relative.parts
        or relative.suffix.lower() != ".md"
    ):
        raise AuthorityError(f"设计权威必须是仓库内 Markdown：{value}")
    return relative.as_posix()


def _has_heading(text: str, alternatives: tuple[str, ...]) -> bool:
    headings = [
        match.group(1).strip().lower()
        for match in re.finditer(r"^#{1,6}\s+(.+?)\s*$", text, re.MULTILINE)
    ]
    return any(
        any(term.lower() in heading for term in alternatives) for heading in headings
    )


def validate_design_authority(
    root: Path, value: str, expected_kind: str | None = None
) -> dict[str, Any]:
    """验证 design/ADR 的路径、章节和内容摘要。"""
    relative = _relative_path(root, value)
    path = root / relative
    if not path.is_file() or path.is_symlink():
        raise AuthorityError(f"设计权威不存在普通文件：{relative}")
    parts = tuple(part.lower() for part in PurePosixPath(relative).parts)
    if "adr" in parts:
        kind = "adr"
    elif PurePosixPath(relative).name.lower() == "design.md" or any(
        part in {"design", "designs"} for part in parts
    ):
        kind = "design"
    else:
        raise AuthorityError(f"路径不是正式 design/ADR：{relative}")
    if expected_kind is not None and kind != expected_kind:
        raise AuthorityError(f"设计权威类型应为 {expected_kind}：{relative}")

    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise AuthorityError(f"无法读取设计权威 {relative}：{error}") from error
    if not re.search(r"^#\s+\S", text, re.MULTILINE):
        raise AuthorityError(f"设计权威缺少一级标题：{relative}")
    if kind == "adr":
        groups = (
            ("状态", "status"),
            ("背景", "context", "problem"),
            ("候选", "方案", "options", "alternatives"),
            ("决策", "decision"),
            ("影响", "consequences"),
        )
    else:
        groups = (
            ("目标", "problem", "goal"),
            ("范围", "边界", "scope", "boundary"),
            ("方案", "设计", "决策", "design", "decision"),
            ("验收", "验证", "acceptance", "verification"),
        )
    for alternatives in groups:
        if not _has_heading(text, alternatives):
            raise AuthorityError(
                f"设计权威缺少章节 {'/'.join(alternatives)}：{relative}"
            )
    return {
        "path": relative,
        "kind": kind,
        "contentDigest": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }
