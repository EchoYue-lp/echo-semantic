#!/usr/bin/env python3
"""记录并检查任务级语义预检状态。"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "scripts"))
from governance_contract import AuthorityError, validate_design_authority

PLUGIN_ID = "echo-coding-semantic-governance"
SCHEMA_VERSION = 1
KINDS = ("bugfix", "feature", "refactor", "contract", "style")
RISKS = ("low", "medium", "high")


class PreflightError(RuntimeError):
    """表示预检输入或仓库状态不满足合同。"""


def run_git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "未知 Git 错误"
        raise PreflightError(detail)
    return result.stdout.strip()


def repository_root(value: str) -> Path:
    supplied = Path(value).expanduser().resolve()
    root = Path(run_git(supplied, "rev-parse", "--show-toplevel")).resolve()
    return root


def state_path(root: Path) -> Path:
    raw = run_git(root, "rev-parse", "--git-path", f"{PLUGIN_ID}/preflight.json")
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (root / path).resolve()


def normalize_path(root: Path, value: str) -> str:
    raw = Path(value).expanduser()
    if raw.is_absolute():
        try:
            raw = raw.resolve().relative_to(root)
        except ValueError as error:
            raise PreflightError(f"路径不在仓库内：{value}") from error
    normalized = PurePosixPath(raw.as_posix())
    if not normalized.parts or normalized.as_posix() in {"", "."}:
        raise PreflightError("允许路径不能是整个仓库")
    if normalized.is_absolute() or ".." in normalized.parts:
        raise PreflightError(f"路径必须是安全的仓库相对路径：{value}")
    return normalized.as_posix().rstrip("/")


def existing_authority(
    root: Path, value: str, expected_kind: str | None = None
) -> dict[str, object]:
    try:
        return validate_design_authority(root, value, expected_kind)
    except AuthorityError as error:
        raise PreflightError(str(error)) from error


def write_atomic(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def record(args: argparse.Namespace) -> int:
    root = repository_root(args.root)
    allowed = sorted({normalize_path(root, item) for item in args.allow})
    if not allowed:
        raise PreflightError("至少需要一个允许修改路径")
    if not args.reuse:
        raise PreflightError("至少需要一项已有能力或无法复用的依据")
    if not args.verify:
        raise PreflightError("至少需要一项验证要求")
    if args.new_boundary_reason:
        boundary_decision = {"createsNew": True, "reason": args.new_boundary_reason}
    else:
        boundary_decision = {
            "createsNew": False,
            "reason": args.reuse_existing_boundary,
        }

    signals = {
        "publicApi": args.public_api,
        "newStateAuthority": args.new_state_authority,
        "newProtocol": args.new_protocol,
        "crossServiceMigration": args.cross_service_migration,
        "architectureChange": args.architecture_change,
        "unknownProductionCode": args.unknown_production_code,
    }
    high_risk = any(signals.values())
    if high_risk and args.risk != "high":
        raise PreflightError(
            "公共 API、状态权威、协议、跨服务迁移或架构变化必须标为 high"
        )
    if high_risk and (not args.basis or not args.semantic_ref):
        raise PreflightError("高风险变化必须提供 --basis 和 --semantic-ref")

    authorities = [
        *[existing_authority(root, value) for value in args.design_authority],
        *[existing_authority(root, value, "adr") for value in args.adr],
    ]
    architectural = any(
        signals[name]
        for name in (
            "newStateAuthority",
            "newProtocol",
            "crossServiceMigration",
            "architectureChange",
        )
    )
    if architectural and not authorities:
        raise PreflightError("架构类变化必须绑定现有 design 或 ADR")

    payload: dict[str, object] = {
        "schemaVersion": SCHEMA_VERSION,
        "pluginId": PLUGIN_ID,
        "repositoryRoot": str(root),
        "baseRevision": run_git(root, "rev-parse", "HEAD"),
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "taskId": args.task_id or str(uuid.uuid4()),
        "kind": args.kind,
        "risk": args.risk,
        "allowedPaths": allowed,
        "reuse": args.reuse,
        "verifications": args.verify,
        "basis": args.basis,
        "semanticRefs": args.semantic_ref,
        "signals": signals,
        "boundaryDecision": boundary_decision,
        "designAuthorities": authorities,
    }
    destination = state_path(root)
    write_atomic(destination, payload)
    print(f"语义预检已记录：{destination}")
    return 0


def load_state(root: Path) -> tuple[Path, dict[str, object]]:
    path = state_path(root)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise PreflightError("当前任务没有语义预检记录") from error
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise PreflightError(f"无法读取语义预检记录：{error}") from error
    if not isinstance(data, dict) or data.get("schemaVersion") != SCHEMA_VERSION:
        raise PreflightError("语义预检记录版本无效")
    return path, data


def path_allowed(relative: str, allowed: list[object]) -> bool:
    return any(
        isinstance(item, str)
        and (relative == item or relative.startswith(f"{item.rstrip('/')}/"))
        for item in allowed
    )


def check(args: argparse.Namespace) -> int:
    root = repository_root(args.root)
    _, data = load_state(root)
    if Path(str(data.get("repositoryRoot", ""))).resolve() != root:
        raise PreflightError("预检记录属于另一个仓库")
    if args.path:
        relative = normalize_path(root, args.path)
        allowed = data.get("allowedPaths", [])
        if not isinstance(allowed, list) or not path_allowed(relative, allowed):
            raise PreflightError(f"路径不在预检允许范围：{relative}")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


def clear(args: argparse.Namespace) -> int:
    root = repository_root(args.root)
    path = state_path(root)
    if path.exists():
        path.unlink()
        print(f"已清除语义预检记录：{path}")
    else:
        print("没有需要清除的语义预检记录")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="记录并检查生成前语义预检")
    commands = root.add_subparsers(dest="command", required=True)

    record_parser = commands.add_parser("record", help="记录当前任务预检")
    record_parser.add_argument("--root", required=True)
    record_parser.add_argument("--kind", choices=KINDS, required=True)
    record_parser.add_argument("--risk", choices=RISKS, required=True)
    record_parser.add_argument("--task-id")
    record_parser.add_argument("--allow", action="append", default=[], required=True)
    record_parser.add_argument("--reuse", action="append", default=[], required=True)
    record_parser.add_argument("--verify", action="append", default=[], required=True)
    record_parser.add_argument("--basis", action="append", default=[])
    record_parser.add_argument("--semantic-ref", action="append", default=[])
    record_parser.add_argument("--design-authority", action="append", default=[])
    record_parser.add_argument("--adr", action="append", default=[])
    boundary_group = record_parser.add_mutually_exclusive_group(required=True)
    boundary_group.add_argument("--new-boundary-reason")
    boundary_group.add_argument("--reuse-existing-boundary")
    record_parser.add_argument("--public-api", action="store_true")
    record_parser.add_argument("--new-state-authority", action="store_true")
    record_parser.add_argument("--new-protocol", action="store_true")
    record_parser.add_argument("--cross-service-migration", action="store_true")
    record_parser.add_argument("--architecture-change", action="store_true")
    record_parser.add_argument("--unknown-production-code", action="store_true")
    record_parser.set_defaults(handler=record)

    check_parser = commands.add_parser("check", help="检查预检记录或单个路径")
    check_parser.add_argument("--root", required=True)
    check_parser.add_argument("--path")
    check_parser.set_defaults(handler=check)

    clear_parser = commands.add_parser("clear", help="清除当前任务预检")
    clear_parser.add_argument("--root", required=True)
    clear_parser.set_defaults(handler=clear)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        return int(args.handler(args))
    except (OSError, UnicodeError, PreflightError) as error:
        print(f"语义预检失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
