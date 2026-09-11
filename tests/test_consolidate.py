from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "semantic-consolidate" / "scripts" / "consolidate.py"


def git(root: Path, *args: str) -> None:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise AssertionError(result.stderr)


class ConsolidationTests(unittest.TestCase):
    def test_candidate_becomes_deferred_finding(self) -> None:
        with tempfile.TemporaryDirectory(prefix="echo-semantic-consolidate-") as raw:
            root = Path(raw)
            git(root, "init", "-q")
            git(root, "config", "user.email", "test@example.com")
            git(root, "config", "user.name", "Test")
            (root / "src").mkdir()
            (root / "src/a.py").write_text(
                "def Shared():\n    return 1\n", encoding="utf-8"
            )
            (root / "src/b.py").write_text(
                "def Shared():\n    return 2\n", encoding="utf-8"
            )
            git(root, "add", ".")
            git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")

            result = subprocess.run(
                [
                    "uv",
                    "run",
                    str(SCRIPT),
                    "--root",
                    str(root),
                    "--boundary",
                    "boundary.example",
                    "--write",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(len(report["written_findings"]), 1)
            finding = Path(report["written_findings"][0])
            text = finding.read_text(encoding="utf-8")
            self.assertIn("type: consolidation_candidate", text)
            self.assertIn("status: open", text)
            self.assertIn("decision: defer", text)

    def test_approved_decision_requires_canonical_from_selected_candidate(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="echo-semantic-consolidate-canonical-"
        ) as raw:
            root = Path(raw)
            git(root, "init", "-q")
            git(root, "config", "user.email", "test@example.com")
            git(root, "config", "user.name", "Test")
            (root / "src").mkdir()
            (root / "src/a.py").write_text(
                "def Shared():\n    return 1\n", encoding="utf-8"
            )
            (root / "src/b.py").write_text(
                "def Shared():\n    return 2\n", encoding="utf-8"
            )
            git(root, "add", ".")
            git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")

            result = subprocess.run(
                [
                    "uv",
                    "run",
                    str(SCRIPT),
                    "--root",
                    str(root),
                    "--boundary",
                    "boundary.example",
                    "--decision",
                    "merge",
                    "--canonical-asset",
                    "asset.missing",
                    "--write",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("不属于指定候选簇", result.stdout)


if __name__ == "__main__":
    unittest.main()
