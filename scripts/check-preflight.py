"""运行态锁内使用的完整预检合同校验入口。"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
from preflight_contract import validate_preflight


def main() -> int:
    parser = argparse.ArgumentParser(description="在提交临界区重验完整预检合同")
    parser.add_argument("--root", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument(
        "--phase", choices=("record", "check", "verify"), default="record"
    )
    parser.add_argument("--now", type=int)
    args = parser.parse_args()
    raw = sys.stdin.buffer.read(1024 * 1024 + 1)
    try:
        if len(raw) > 1024 * 1024:
            raise ValueError("预检输入超过 1 MiB")
        errors = validate_preflight(
            json.loads(raw),
            Path(args.root),
            current_head=args.head,
            phase=args.phase,
            now=datetime.fromtimestamp(args.now / 1000, timezone.utc)
            if args.now is not None
            else None,
        )
    except (ValueError, OSError) as error:
        errors = [f"完整预检合同读取失败：{error}"]
    print(json.dumps(errors, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
