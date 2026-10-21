#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["PyYAML>=6.0,<7"]
# ///
"""查看语义资产候选并保存待确认扫描报告，正式 Finding 由确认后的维护流程写入。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_ROOT / "../semantic-discover/scripts"))
from inventory import save_report, scan


def main() -> int:
    parser = argparse.ArgumentParser(description="查看待确认归并候选与独立扫描报告")
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
        written = []
        if args.write:
            if args.path:
                raise ValueError("局部候选只输出报告，不覆盖正式 Finding")
            if args.decision != "defer" or args.canonical_asset:
                raise ValueError(
                    "扫描写入只保存待确认报告；批准决策须核对报告后走正式语义维护"
                )
            report["report_path"] = save_report(args.root.resolve(), report)
        report["candidates"] = candidates
        report["written_findings"] = written
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (OSError, RuntimeError, UnicodeError, ValueError) as error:
        print(f"语义候选归并失败：{error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
