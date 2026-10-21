"""检查 Git 索引或候选 tree 的产物边界；不读取原始日志正文。"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path, PurePosixPath

LOCAL_DIRECTORY = ".echo-semantic/local"
RUNTIME_PATHS = {
    f".echo-semantic/{name}"
    for name in (
        "status.md",
        "status.json",
        "preflight.json",
        "route.json",
        "continuation.json",
        "session-snapshot.json",
        "stop-dedupe.json",
    )
}


def is_local_artifact(path: str) -> bool:
    normalized = PurePosixPath(path).as_posix().casefold()
    return normalized == LOCAL_DIRECTORY or normalized.startswith(LOCAL_DIRECTORY + "/")


def is_forbidden_artifact(path: str) -> bool:
    return PurePosixPath(
        path
    ).as_posix().casefold() in RUNTIME_PATHS or is_local_artifact(path)


def git_bytes(root: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, check=False, timeout=30
    )
    if result.returncode:
        # Git stderr 可能包含远端/环境信息，只报告命令类别。
        raise ValueError(f"无法执行 Git 产物检查：{args[0]}")
    return result.stdout


def git_paths(raw: bytes) -> list[str]:
    return [p.decode("utf-8", errors="strict") for p in raw.split(b"\0") if p]


def tracked_artifact_errors(root: Path) -> list[str]:
    paths = git_paths(git_bytes(root, "ls-files", "-z"))
    return [
        f"{root / p}: {'本地产物' if is_local_artifact(p) else '运行态文件'}不能被 Git 跟踪"
        for p in paths
        if is_forbidden_artifact(p)
    ]


def check_artifacts(
    root: Path, *, staged: bool = False, base: str | None = None
) -> dict:
    if staged:
        # 读取索引条目，不写 tree、索引缓存或临时清单；结束时重验索引。
        index = git_bytes(root, "ls-files", "--stage", "-z")
        all_paths = []
        for entry in index.split(b"\0"):
            if not entry:
                continue
            metadata, path = entry.split(b"\t", 1)
            if metadata.split()[-1] != b"0":
                raise ValueError("索引包含未解决冲突")
            all_paths.append(path.decode("utf-8", errors="strict"))
        candidate = "index:" + hashlib.sha256(index).hexdigest()
        changed = git_paths(
            git_bytes(
                root,
                "diff",
                "--cached",
                "--no-renames",
                "--name-only",
                "--diff-filter=ACMT",
                "-z",
                "--",
            )
        )
        if git_bytes(root, "ls-files", "--stage", "-z") != index:
            raise ValueError("检查期间索引发生变化，请重试")
    else:
        if not base:
            raise ValueError("候选提交检查必须提供 --base")
        candidate = (
            git_bytes(root, "rev-parse", "--verify", "HEAD^{tree}").decode().strip()
        )
        before = (
            git_bytes(
                root, "rev-parse", "--verify", "--end-of-options", f"{base}^{{tree}}"
            )
            .decode()
            .strip()
        )
        changed = git_paths(
            git_bytes(
                root,
                "diff-tree",
                "--no-commit-id",
                "--no-renames",
                "-r",
                "--name-only",
                "--diff-filter=ACMT",
                "-z",
                before,
                candidate,
                "--",
            )
        )
        all_paths = git_paths(
            git_bytes(root, "ls-tree", "-r", "--name-only", "-z", candidate)
        )
    errors = [f"不可提交的产物：{p}" for p in all_paths if is_forbidden_artifact(p)]
    warnings = [
        f"请核对是否为原始运行产物，必要 fixture 可以保留：{p}"
        for p in changed
        if not is_forbidden_artifact(p)
        and (
            p.lower().endswith((".log", ".jsonl"))
            or "/surefire-reports/" in p
            or "/test-results/" in p
        )
    ]
    return {
        "scope": "staged" if staged else "commit",
        "candidateIdentity": candidate,
        "paths": changed,
        "errors": errors,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="检查待提交产物，不修改索引或文件")
    parser.add_argument("--root", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--staged", action="store_true")
    source.add_argument("--base")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    try:
        actual = Path(
            git_bytes(root, "rev-parse", "--show-toplevel").decode().strip()
        ).resolve()
        if root != actual:
            raise ValueError("产物根必须是 Git 仓库根")
        report = check_artifacts(root, staged=args.staged, base=args.base)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({"errors": [str(error)]}, ensure_ascii=False))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
