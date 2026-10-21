#!/usr/bin/env python3
"""记录并检查任务级语义预检状态。"""

from __future__ import annotations

import argparse
import json
import os
import stat
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

sys.dont_write_bytecode = True
PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "scripts"))
from governance_contract import AuthorityError, validate_design_authority
from preflight_contract import file_evidence, validate_preflight

PLUGIN_ID = "echo-semantic"
PROJECT_STATE_DIRECTORY = ".echo-semantic"
SCHEMA_VERSION = 2
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
    directory = root / PROJECT_STATE_DIRECTORY
    if (directory.exists() or directory.is_symlink()) and (
        directory.is_symlink() or not directory.is_dir()
    ):
        raise PreflightError(f"Echo Semantic 项目目录必须是普通目录：{directory}")
    return directory / "preflight.json"


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


def normalize_search_path(root: Path, value: str) -> str:
    if value in {"", "."}:
        return "."
    relative = normalize_path(root, value)
    target = root / relative
    try:
        stat_result = target.lstat()
    except OSError as error:
        raise PreflightError(f"搜索范围不存在：{relative}") from error
    if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
        raise PreflightError(f"搜索范围不能是仓外或符号链接：{relative}")
    if not (stat.S_ISREG(stat_result.st_mode) or stat.S_ISDIR(stat_result.st_mode)):
        raise PreflightError(f"搜索范围不是文件或目录：{relative}")
    return relative


def existing_authority(
    root: Path, value: str, expected_kind: str | None = None
) -> dict[str, object]:
    try:
        return validate_design_authority(root, value, expected_kind)
    except AuthorityError as error:
        raise PreflightError(str(error)) from error


def read_record(path: Path) -> object:
    """只读取根内有界普通文件，不沿运行态符号链接读取。"""
    root = path.parent.parent
    expected = path.lstat()
    if not stat.S_ISREG(expected.st_mode) or expected.st_size > 1024 * 1024:
        raise PreflightError("预检运行态不是根内有界普通文件")
    descriptor = os.open(
        path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    )
    try:
        before = os.fstat(descriptor)
        current = path.lstat()
        if (
            not stat.S_ISREG(before.st_mode)
            or stat.S_ISLNK(current.st_mode)
            or before.st_size > 1024 * 1024
            or not path.resolve().is_relative_to(root)
            or (before.st_dev, before.st_ino) != (current.st_dev, current.st_ino)
            or (before.st_dev, before.st_ino) != (expected.st_dev, expected.st_ino)
        ):
            raise PreflightError("预检运行态不是根内有界普通文件")
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as stream:
            text = stream.read(1024 * 1024 + 1)
        after = os.fstat(descriptor)
        current = path.lstat()

        def identity(item):
            return (
                item.st_dev,
                item.st_ino,
                item.st_mode,
                item.st_size,
                item.st_mtime_ns,
                item.st_ctime_ns,
            )

        if (
            len(text.encode("utf-8")) > 1024 * 1024
            or identity(before) != identity(after)
            or identity(after) != identity(current)
            or not path.resolve().is_relative_to(root)
        ):
            raise PreflightError("预检运行态读取期间发生变化")
        return json.loads(text)
    finally:
        os.close(descriptor)


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

    if not args.search or not args.reuse_decision:
        raise PreflightError(
            "必须提供 --search 和 --reuse-decision，旧字符串记录不能替代复用检查"
        )
    candidates = []
    for raw in args.candidate:
        try:
            candidate = json.loads(raw)
        except json.JSONDecodeError as error:
            raise PreflightError("--candidate 必须为候选 JSON 对象") from error
        if not isinstance(candidate, dict):
            raise PreflightError("--candidate 必须为候选 JSON 对象")
        candidates.append(candidate)
    paths = {normalize_path(root, item): False for item in args.evidence}
    for item in args.mutable_evidence:
        paths[normalize_path(root, item)] = True
    for candidate in candidates:
        if isinstance(candidate.get("path"), str):
            path = normalize_path(root, candidate["path"])
            candidate["path"] = path
            paths.setdefault(path, False)
    for authority in authorities:
        paths.setdefault(str(authority["path"]), False)
    for reference in [*args.semantic_ref, *args.repair_ref]:
        # 语义对象使用显式身份文件名，不枚举读取无关材料。
        matches = [
            f".echo-semantic/{directory}/{reference}.md"
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
            if (root / f".echo-semantic/{directory}/{reference}.md").is_file()
        ]
        if len(matches) != 1:
            raise PreflightError(f"引用不存在语义对象或无法唯一定位：{reference}")
        paths.setdefault(matches[0], False)
    reuse_check = {
        "searchPaths": [normalize_search_path(root, item) for item in args.search],
        "decision": args.reuse_decision,
        "reason": "；".join(args.reuse),
        "candidates": candidates,
        "evidence": [
            file_evidence(root, relative, mutable=mutable)
            for relative, mutable in sorted(paths.items())
        ],
    }

    payload: dict[str, object] = {
        "schemaVersion": SCHEMA_VERSION,
        "pluginId": PLUGIN_ID,
        "repositoryRoot": str(root),
        "baseRevision": run_git(root, "rev-parse", "HEAD"),
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "taskId": args.task_id or str(uuid.uuid4()),
        "scope": "task",
        "verificationScope": args.verification_scope,
        "kind": args.kind,
        "risk": args.risk,
        "allowedPaths": allowed,
        "reuse": args.reuse,
        "reuseCheck": reuse_check,
        "verifications": args.verify,
        "basis": args.basis,
        "semanticRefs": args.semantic_ref,
        "repairRefs": args.repair_ref,
        "deletePaths": args.delete_path,
        "signals": signals,
        "boundaryDecision": boundary_decision,
        "designAuthorities": authorities,
    }
    contract_errors = validate_preflight(
        payload,
        root,
        current_head=str(payload["baseRevision"]),
        phase="record",
    )
    if contract_errors:
        raise PreflightError("；".join(contract_errors))
    destination = state_path(root)
    committed = subprocess.run(
        [
            "node",
            str(PLUGIN_ROOT / "scripts" / "record-preflight.mjs"),
            "--root",
            str(root),
            "--python",
            sys.executable,
        ],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    if committed.returncode != 0:
        raise PreflightError(committed.stderr.strip() or "运行态锁内预检写入失败")
    print(f"语义预检已记录：{destination}")
    return 0


def load_state(root: Path) -> tuple[Path, dict[str, object]]:
    path = state_path(root)
    try:
        data = read_record(path)
    except FileNotFoundError as error:
        raise PreflightError("当前任务没有语义预检记录") from error
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise PreflightError(f"无法读取语义预检记录：{error}") from error
    if not isinstance(data, dict) or data.get("schemaVersion") != SCHEMA_VERSION:
        raise PreflightError("语义预检记录版本无效")
    contract_errors = validate_preflight(
        data,
        root,
        current_head=run_git(root, "rev-parse", "HEAD"),
    )
    if contract_errors:
        raise PreflightError("语义预检记录不满足合同：" + "；".join(contract_errors))
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
    if args.task_id and data.get("taskId") != args.task_id:
        raise PreflightError("预检记录不属于当前任务，不得跨任务复用")
    if Path(str(data.get("repositoryRoot", ""))).resolve() != root:
        raise PreflightError("预检记录属于另一个仓库")
    if args.path:
        relative = normalize_path(root, args.path)
        allowed = data.get("allowedPaths", [])
        if not isinstance(allowed, list) or not path_allowed(relative, allowed):
            raise PreflightError(f"路径不在预检允许范围：{relative}")
    result = (
        {
            field: data[field]
            for field in (
                "taskId",
                "repositoryRoot",
                "baseRevision",
                "risk",
                "allowedPaths",
            )
        }
        if args.compact
        else data
    )
    print(json.dumps(result, ensure_ascii=False, indent=None if args.compact else 2))
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
    record_parser.add_argument(
        "--verification-scope",
        choices=("task", "repository"),
        default="task",
        help="完成验证范围；repository 必须由用户显式选择，不自动建库",
    )
    record_parser.add_argument("--allow", action="append", default=[], required=True)
    record_parser.add_argument("--reuse", action="append", default=[], required=True)
    record_parser.add_argument(
        "--search",
        action="append",
        default=[],
        help="已搜索的仓库相对范围，可使用 . 表示定向全仓检索",
    )
    record_parser.add_argument("--reuse-decision", choices=("reuse", "extend", "new"))
    record_parser.add_argument(
        "--candidate",
        action="append",
        default=[],
        help="候选 JSON：path、symbol、selected、reason",
    )
    record_parser.add_argument(
        "--evidence", action="append", default=[], help="必须保持内容不变的相关依据路径"
    )
    record_parser.add_argument(
        "--mutable-evidence",
        action="append",
        default=[],
        help="允许随任务修改、完成时重新验证的依据路径",
    )
    record_parser.add_argument("--verify", action="append", default=[], required=True)
    record_parser.add_argument("--basis", action="append", default=[])
    record_parser.add_argument("--semantic-ref", action="append", default=[])
    record_parser.add_argument("--repair-ref", action="append", default=[])
    record_parser.add_argument("--delete-path", action="append", default=[])
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
    check_parser.add_argument("--task-id", help="核对任务标识，禁止跨任务复用")
    check_parser.add_argument(
        "--compact", action="store_true", help="仅输出准入摘要，不刷新有效期"
    )
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
