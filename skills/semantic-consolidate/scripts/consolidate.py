#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["PyYAML>=6.0,<7"]
# ///
"""把语义资产盘点候选写成等待人工决策的 Finding。"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import yaml

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_ROOT / "../semantic-discover/scripts"))
from inventory import scan


def finding_id(candidate: dict[str, Any]) -> str:
    return (
        "finding.consolidation."
        + hashlib.sha256(str(candidate["id"]).encode("utf-8")).hexdigest()[:20]
    )


def write_finding(
    root: Path,
    candidate: dict[str, Any],
    boundary: str,
    digest: str,
    decision: str,
    canonical_asset: str | None,
) -> Path:
    identifier = finding_id(candidate)
    data = {
        "schema_version": 1,
        "id": identifier,
        "kind": "finding",
        "type": "consolidation_candidate",
        "status": "open",
        "severity": "medium",
        "primary_focus": "state_authority",
        "focus": ["contract_evidence", "state_authority"],
        "boundary_ref": boundary,
        "behavior_refs": [],
        "rule_refs": [],
        "evidence_refs": [],
        "audit_refs": [],
        "decision_refs": [],
        "repair_evidence_refs": [],
        "verification_evidence_refs": [],
        "rereview_audit_refs": [],
        "discovered_at": f"source:{digest}",
        "candidate_asset_refs": candidate["asset_refs"],
        "canonical_asset_ref": canonical_asset,
        "decision": decision,
    }
    frontmatter = yaml.safe_dump(data, allow_unicode=True, sort_keys=False).rstrip()
    body = (
        "# 候选归并\n\n"
        "## 问题\n\n多个资产具有相同稳定符号名，尚未证明业务语义等价。\n\n"
        "## 触发条件与影响\n\n静态候选需要检查消费者、状态权威、权限和失败恢复。\n\n"
        "## 证据\n\n候选来自同一 revision 的语义资产盘点。\n\n"
        f"## 处理记录\n\n当前决策为 {decision}，等待人工确认 canonical owner。\n"
    )
    path = root / ".echo-semantic/findings" / f"{identifier}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"---\n{frontmatter}\n---\n\n{body}", encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="写入语义候选归并 Finding")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--path", action="append", default=[], help="只处理指定仓库相对路径"
    )
    parser.add_argument("--boundary", required=True, help="候选所属的已有 boundary id")
    parser.add_argument(
        "--decision",
        choices=("keep", "merge", "migrate", "retire", "defer"),
        default="defer",
    )
    parser.add_argument("--candidate-id", help="只处理指定候选 id")
    parser.add_argument("--canonical-asset")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    try:
        if args.decision in {"merge", "migrate", "retire"} and not args.canonical_asset:
            raise ValueError("merge/migrate/retire 必须提供 --canonical-asset")
        report = scan(args.root.resolve(), False, args.path or None)
        candidates = report["candidates"]
        if args.candidate_id:
            candidates = [
                candidate
                for candidate in candidates
                if candidate["id"] == args.candidate_id
            ]
            if not candidates:
                raise ValueError(f"找不到候选：{args.candidate_id}")
        if args.decision in {"merge", "migrate", "retire"}:
            if len(candidates) != 1:
                raise ValueError("批准归并时必须通过 --candidate-id 指定唯一候选")
            if args.canonical_asset not in candidates[0]["asset_refs"]:
                raise ValueError("canonical asset 不属于指定候选簇")
        report["candidates"] = candidates
        written = []
        if args.write:
            for candidate in candidates:
                written.append(
                    str(
                        write_finding(
                            args.root.resolve(),
                            candidate,
                            args.boundary,
                            report["source_snapshot"]["content_digest"],
                            args.decision,
                            args.canonical_asset,
                        )
                    )
                )
        report["written_findings"] = written
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (OSError, RuntimeError, UnicodeError, ValueError) as error:
        print(f"语义候选归并失败：{error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
