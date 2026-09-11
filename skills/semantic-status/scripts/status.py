#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["PyYAML>=6.0,<7"]
# ///
"""生成项目语义治理状态和下一步 Frontier。"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

sys.dont_write_bytecode = True
PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "scripts"))
from preflight_contract import validate_preflight

PLUGIN_ID = "echo-semantic"
ROUTES = {"bootstrap", "maintenance", "fast", "standard", "strict", "idle"}
KINDS = {"bugfix", "feature", "refactor", "contract", "style"}
RISKS = {"low", "medium", "high"}
BASELINE_FIELDS = {
    "source_snapshot",
    "inventory_closure",
    "behavior_model_closure",
    "map_refs",
    "regions",
    "boundaries",
    "coverage",
}


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Git 命令失败")
    return result.stdout.strip()


def git_status(root: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Git 状态读取失败")
    return result.stdout


def repository_root(value: Path) -> Path:
    supplied = value.expanduser().resolve()
    return Path(git(supplied, "rev-parse", "--show-toplevel")).resolve()


def metadata(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"缺少 YAML 前置元数据：{path}")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise ValueError(f"YAML 前置元数据没有结束：{path}")
    value = yaml.safe_load(text[4:end])
    if not isinstance(value, dict):
        raise TypeError(f"YAML 前置元数据必须是对象：{path}")
    return value


def private_json(root: Path, name: str) -> dict[str, Any] | None:
    path = root / ".echo-semantic" / name
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def scan_objects(root: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "counts": {},
        "openFindings": [],
        "staleAudits": [],
        "needsReview": [],
        "invalidObjects": [],
    }
    for directory in (
        "maps",
        "behaviors",
        "rules",
        "evidence",
        "findings",
        "audits",
        "discovery",
        "assets",
    ):
        object_root = root / directory
        paths = sorted(object_root.glob("*.md")) if object_root.is_dir() else []
        result["counts"][directory] = len(paths)
        for path in paths:
            try:
                data = metadata(path)
            except (OSError, UnicodeError, ValueError, yaml.YAMLError) as error:
                result["invalidObjects"].append(
                    {"path": str(path), "reason": str(error)}
                )
                continue
            object_id = data.get("id", path.stem)
            if directory == "findings" and data.get("status") == "open":
                result["openFindings"].append(object_id)
            if directory == "audits" and data.get("freshness") == "stale":
                result["staleAudits"].append(object_id)
            if data.get("status") in {"needs_review", "stale"}:
                result["needsReview"].append(object_id)
    return result


def preflight_state(root: Path, value: dict[str, Any] | None) -> dict[str, Any]:
    if value is None:
        return {"present": False, "fresh": False}
    reasons = validate_preflight(
        value, root, current_head=git(root, "rev-parse", "HEAD")
    )
    return {
        "present": True,
        "valid": not reasons,
        "fresh": not reasons,
        "taskId": value.get("taskId"),
        "risk": value.get("risk"),
        "kind": value.get("kind"),
        "allowedPaths": value.get("allowedPaths", []),
        "reasons": reasons,
    }


def baseline_state(root: Path, value: dict[str, Any] | None) -> dict[str, Any]:
    if value is None:
        return {"present": False, "validStructure": False, "reasons": []}
    reasons: list[str] = []
    missing = sorted(BASELINE_FIELDS - set(value))
    if missing:
        reasons.append(f"缺少字段：{'、'.join(missing)}")
    snapshot = value.get("source_snapshot")
    if not isinstance(snapshot, dict):
        reasons.append("源码快照无效")
    elif not re.fullmatch(r"[0-9a-f]{40}", str(snapshot.get("base_revision", ""))):
        reasons.append("源码快照基准无效")
    elif not re.fullmatch(r"[0-9a-f]{64}", str(snapshot.get("content_digest", ""))):
        reasons.append("源码摘要无效")
    if value.get("inventory_closure") not in {"open", "closed"}:
        reasons.append("库存闭合值无效")
    if value.get("behavior_model_closure") not in {"open", "closed"}:
        reasons.append("行为闭合值无效")
    for field in ("map_refs", "regions", "boundaries", "coverage"):
        if not isinstance(value.get(field), list) or not value.get(field):
            reasons.append(f"{field} 为空或不是列表")
    regions = value.get("regions")
    if isinstance(regions, list):
        for region in regions:
            if not isinstance(region, dict) or not isinstance(region.get("path"), str):
                reasons.append("仓库区域结构无效")
    for directory in (
        "maps",
        "behaviors",
        "rules",
        "evidence",
        "findings",
        "audits",
        "discovery",
        "assets",
    ):
        if not (root / directory).is_dir():
            reasons.append(f"缺少语义目录：{directory}")
        elif directory in {
            "maps",
            "behaviors",
            "rules",
            "evidence",
            "discovery",
        } and not list((root / directory).glob("*.md")):
            reasons.append(f"语义目录为空：{directory}")
    return {
        "present": True,
        "validStructure": not reasons,
        "reasons": reasons,
    }


def route_state(root: Path, value: dict[str, Any] | None) -> dict[str, Any]:
    if value is None:
        return {"present": False, "trusted": False, "reasons": []}
    reasons: list[str] = []
    if value.get("schemaVersion") != 1:
        reasons.append("版本无效")
    if value.get("pluginId") != PLUGIN_ID:
        reasons.append("插件标识无效")
    if value.get("repositoryRoot") != str(root.resolve()):
        reasons.append("仓库不匹配")
    current_head = git(root, "rev-parse", "HEAD")
    if value.get("headRevision") != current_head:
        reasons.append("路由 HEAD 已变化")
    current_worktree_digest = hashlib.sha256(
        git_status(root).encode("utf-8")
    ).hexdigest()
    if value.get("worktreeDigest") != current_worktree_digest:
        reasons.append("路由工作树已变化")
    if value.get("route") not in ROUTES:
        reasons.append("路由无效")
    if not isinstance(value.get("host"), str) or not value.get("host"):
        reasons.append("宿主无效")
    if not isinstance(value.get("skills"), list) or not value.get("skills"):
        reasons.append("入口列表无效")
    if not isinstance(value.get("changedPaths"), list) or not isinstance(
        value.get("highRiskPaths"), list
    ):
        reasons.append("差异列表无效")
    runtime_probe = value.get("runtimeProbe")
    if not isinstance(runtime_probe, dict) or not isinstance(
        runtime_probe.get("detected"), bool
    ):
        reasons.append("运行时探测无效")
        runtime_probe = {}
    enforcement = value.get("enforcement")
    if not isinstance(enforcement, dict) or any(
        not isinstance(enforcement.get(key), bool)
        for key in ("preEdit", "stop", "continuation")
    ):
        reasons.append("执行能力无效")
        enforcement = {}
    hook_evidence = value.get("hookEvidence")
    valid_evidence: set[str] = set()
    if not isinstance(hook_evidence, dict):
        reasons.append("Hook 事件证据无效")
        hook_evidence = {}
    try:
        plugin_version = json.loads(
            (PLUGIN_ROOT / "package.json").read_text(encoding="utf-8")
        ).get("version")
    except (OSError, UnicodeError, json.JSONDecodeError):
        plugin_version = None
        reasons.append("插件版本不可读")
    for name, evidence in hook_evidence.items():
        if name not in {
            "sessionStart",
            "preEdit",
            "preCompact",
            "stop",
        } or not isinstance(evidence, dict):
            reasons.append(f"Hook 事件证据无效：{name}")
            continue
        try:
            observed = datetime.fromisoformat(str(evidence.get("observedAt")))
            age = datetime.now(timezone.utc) - observed.astimezone(timezone.utc)
        except ValueError:
            reasons.append(f"Hook 事件时间无效：{name}")
            continue
        if age < timedelta(0) or age > timedelta(hours=24):
            reasons.append(f"Hook 事件证据过期：{name}")
            continue
        if evidence.get("pluginVersion") != plugin_version:
            reasons.append(f"Hook 事件插件版本不匹配：{name}")
            continue
        if evidence.get("hostVersion") != runtime_probe.get("version"):
            reasons.append(f"Hook 事件宿主版本不匹配：{name}")
            continue
        valid_evidence.add(name)
    capabilities = value.get("capabilities")
    if not isinstance(capabilities, dict):
        reasons.append("静态能力无效")
        capabilities = {}
    hooks = capabilities.get("hooks", {})
    lifecycle = capabilities.get("lifecycle", {})
    expected_enforcement = {
        "preEdit": "preEdit" in valid_evidence and hooks.get("preToolUse") is True,
        "stop": "stop" in valid_evidence and hooks.get("stop") is True,
        "continuation": "preCompact" in valid_evidence
        and lifecycle.get("compact") != "unsupported",
    }
    if enforcement != expected_enforcement:
        reasons.append("执行能力与 Hook 事件证据不一致")
    if (
        value.get("route") not in {"bootstrap", "maintenance"}
        and "stop" not in valid_evidence
    ):
        reasons.append("非 bootstrap 路由缺少停止 Hook 事件证据")
    updated_at = value.get("updatedAt")
    try:
        timestamp = datetime.fromisoformat(str(updated_at))
        age = datetime.now(timezone.utc) - timestamp.astimezone(timezone.utc)
        if age < timedelta(0) or age > timedelta(hours=24):
            reasons.append("路由超过 24 小时有效期")
    except ValueError:
        reasons.append("路由时间无效")
    return {**value, "trusted": not reasons, "reasons": reasons}


def continuation_state(root: Path, value: dict[str, Any] | None) -> dict[str, Any]:
    if value is None:
        return {"present": False, "trusted": False}
    reasons: list[str] = []
    if value.get("schemaVersion") != 1:
        reasons.append("版本无效")
    if value.get("pluginId") != PLUGIN_ID:
        reasons.append("插件标识无效")
    if value.get("repositoryRoot") != str(root.resolve()):
        reasons.append("仓库不匹配")
    if not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", str(value.get("taskId", ""))
    ):
        reasons.append("taskId 无效")
    branch = git(root, "branch", "--show-current") or None
    if value.get("branch") != branch:
        reasons.append("分支不匹配")
    if value.get("route") not in ROUTES:
        reasons.append("路由无效")
    for field in ("stage", "next"):
        if not isinstance(value.get(field), str) or not value.get(field).strip():
            reasons.append(f"{field} 无效")
    for field in ("resolved", "open"):
        if not isinstance(value.get(field), list) or any(
            not isinstance(item, str) or not item.strip() for item in value[field]
        ):
            reasons.append(f"{field} 无效")
    updated_at = value.get("updatedAt")
    try:
        timestamp = datetime.fromisoformat(str(updated_at))
        age = datetime.now(timezone.utc) - timestamp.astimezone(timezone.utc)
        if age < timedelta(0) or age > timedelta(days=7):
            reasons.append("超过 7 天有效期")
    except ValueError:
        reasons.append("时间无效")
    refs = value.get("evidenceRefs")
    hashes = value.get("evidenceHashes")
    if (
        not isinstance(refs, list)
        or not isinstance(hashes, list)
        or len(refs) != len(hashes)
    ):
        reasons.append("证据摘要结构无效")
    else:
        for reference, expected in zip(refs, hashes):
            if not isinstance(reference, str) or Path(reference).is_absolute():
                reasons.append(f"证据路径无效：{reference}")
                continue
            target = (root / reference).resolve()
            try:
                target.relative_to(root.resolve())
                if not target.is_file():
                    raise OSError
                actual = hashlib.sha256(target.read_bytes()).hexdigest()
                if actual != expected:
                    reasons.append(f"证据已变化：{reference}")
            except (OSError, ValueError):
                reasons.append(f"证据不可读：{reference}")
    return {
        "present": True,
        "trusted": not reasons,
        "taskId": value.get("taskId"),
        "route": value.get("route"),
        "stage": value.get("stage"),
        "next": value.get("next"),
        "open": value.get("open", []),
        "reasons": reasons,
    }


def visible_status_state(root: Path, value: dict[str, Any] | None) -> dict[str, Any]:
    if value is None:
        return {"present": False, "trusted": False, "reasons": []}
    reasons: list[str] = []
    if value.get("schemaVersion") != 1:
        reasons.append("版本无效")
    if value.get("pluginId") != PLUGIN_ID:
        reasons.append("插件标识无效")
    if value.get("state") not in {"working", "ready", "blocked", "idle", "stale"}:
        reasons.append("状态值无效")
    revision = value.get("revision")
    if not isinstance(revision, str) or not revision:
        reasons.append("状态版本无效")
    updated_at = value.get("updatedAt")
    age: timedelta | None = None
    try:
        timestamp = datetime.fromisoformat(str(updated_at))
        age = datetime.now(timezone.utc) - timestamp.astimezone(timezone.utc)
        if age < timedelta(0) or age > timedelta(days=7):
            reasons.append("状态时间无效或过期")
    except ValueError:
        reasons.append("状态时间无效")
    markdown = root / ".echo-semantic" / "status.md"
    try:
        text = markdown.read_text(encoding="utf-8")
        if not isinstance(revision, str) or f"状态版本：{revision}" not in text:
            reasons.append("status.md 与 status.json 版本不一致")
    except (OSError, UnicodeError):
        reasons.append("status.md 不可读")
    effective_state = value.get("state")
    if effective_state == "working" and age is not None and age > timedelta(minutes=10):
        effective_state = "stale"
    return {
        **value,
        "effectiveState": effective_state,
        "trusted": not reasons,
        "reasons": reasons,
    }


def next_actions(
    baseline: dict[str, Any] | None,
    route: dict[str, Any] | None,
    preflight: dict[str, Any],
    objects: dict[str, Any],
) -> list[str]:
    if (
        baseline is None
        or not baseline.get("present")
        or not baseline.get("validStructure")
    ):
        return ["semantic-discover", "semantic-verify"]
    if baseline.get("inventoryClosure") != "closed":
        return ["semantic-discover"]
    if route and route.get("route") == "maintenance":
        return [
            "semantic-discover",
            "semantic-status",
            "semantic-consolidate",
            "semantic-audit",
            "semantic-verify",
        ]
    if route and route.get("trusted") is not True:
        return ["semantic-verify"]
    if route and route.get("changedPaths") and not preflight.get("fresh"):
        return ["semantic-preflight"]
    if objects["invalidObjects"]:
        return ["semantic-verify"]
    if route and route.get("route") == "strict":
        return ["semantic-diff", "semantic-audit", "semantic-verify"]
    if route and route.get("route") == "standard":
        return ["semantic-diff", "semantic-verify"]
    if route and route.get("route") == "fast":
        return ["semantic-preflight", "semantic-verify"]
    if objects["openFindings"] or objects["staleAudits"]:
        return ["semantic-audit", "semantic-verify"]
    return ["semantic-status"]


def status(root: Path) -> dict[str, Any]:
    semantic_root = root / ".echo-semantic"
    baseline = None
    errors: list[str] = []
    if (semantic_root / "baseline.md").is_file():
        try:
            baseline = metadata(semantic_root / "baseline.md")
        except (OSError, UnicodeError, ValueError, yaml.YAMLError) as error:
            errors.append(str(error))
    objects = scan_objects(semantic_root)
    baseline_summary = baseline_state(semantic_root, baseline)
    baseline_for_actions = {
        **baseline_summary,
        "inventoryClosure": baseline.get("inventory_closure") if baseline else None,
    }
    route = route_state(root, private_json(root, "route.json"))
    preflight = preflight_state(root, private_json(root, "preflight.json"))
    continuation = continuation_state(root, private_json(root, "continuation.json"))
    visible_status = visible_status_state(root, private_json(root, "status.json"))
    return {
        "schemaVersion": 1,
        "pluginId": PLUGIN_ID,
        "repositoryRoot": str(root),
        "baseline": {
            **baseline_summary,
            "inventoryClosure": baseline.get("inventory_closure")
            if baseline_summary["validStructure"]
            else None,
            "behaviorModelClosure": baseline.get("behavior_model_closure")
            if baseline_summary["validStructure"]
            else None,
        },
        "route": route,
        "preflight": preflight,
        "continuation": continuation,
        "visibleStatus": visible_status,
        "frontier": objects,
        "errors": errors,
        "next": next_actions(baseline_for_actions, route, preflight, objects),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="生成语义治理状态")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        result = status(repository_root(args.root))
    except (OSError, UnicodeError, RuntimeError, ValueError) as error:
        print(f"语义状态生成失败：{error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
