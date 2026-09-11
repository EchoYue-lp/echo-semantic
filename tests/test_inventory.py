from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "semantic-discover" / "scripts" / "inventory.py"


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


class InventoryTests(unittest.TestCase):
    def repository(self) -> Path:
        directory = Path(self.temporary.name) / "repository"
        directory.mkdir()
        git(directory, "init", "-q")
        git(directory, "config", "user.email", "test@example.com")
        git(directory, "config", "user.name", "Test")
        return directory

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="echo-semantic-inventory-")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_inventory(self, root: Path, *args: str) -> dict:
        result = subprocess.run(
            ["uv", "run", str(SCRIPT), "--root", str(root), *args],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_stable_assets_and_collision_candidates(self) -> None:
        root = self.repository()
        (root / "src").mkdir()
        (root / "src/a.py").write_text(
            "def Shared():\n    return 1\n", encoding="utf-8"
        )
        (root / "src/b.py").write_text(
            "def Shared():\n    return 2\n", encoding="utf-8"
        )
        git(root, "add", ".")
        git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")

        first = self.run_inventory(root)
        second = self.run_inventory(root)
        self.assertEqual(first, second)
        self.assertEqual(len(first["candidates"]), 1)
        self.assertEqual(len(first["candidates"][0]["asset_refs"]), 2)
        self.assertEqual(first["candidates"][0]["decision"], "needs_review")
        self.assertTrue(
            any(asset["status"] == "candidate" for asset in first["assets"])
        )

    def test_dynamic_unknown_is_reported_and_write_creates_objects(self) -> None:
        root = self.repository()
        (root / "src").mkdir()
        (root / "src/runtime.py").write_text(
            "value = load_dynamic()\nhandler = getattr(value, 'run')\n",
            encoding="utf-8",
        )
        git(root, "add", ".")
        git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")

        report = self.run_inventory(root, "--write")
        self.assertIn("src/runtime.py", report["unresolved"])
        self.assertTrue(
            (root / ".echo-semantic/discovery/discovery.semantic-assets.md").is_file()
        )
        self.assertTrue(list((root / ".echo-semantic/assets").glob("*.md")))

    def test_explicit_paths_limit_inventory_scope(self) -> None:
        root = self.repository()
        (root / "src").mkdir()
        (root / "src/a.py").write_text("def A():\n    return 1\n", encoding="utf-8")
        (root / "src/b.py").write_text("def B():\n    return 2\n", encoding="utf-8")
        git(root, "add", ".")
        git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")

        report = self.run_inventory(root, "--path", "src/a.py")
        self.assertTrue(report["assets"])
        self.assertTrue(
            all(
                any(ref.startswith("src/a.py") for ref in asset["code_refs"])
                for asset in report["assets"]
            )
        )

    def test_explicit_directory_limits_inventory_scope(self) -> None:
        root = self.repository()
        (root / "src").mkdir()
        (root / "src/a.py").write_text("def A():\n    return 1\n", encoding="utf-8")
        (root / "other.py").write_text("def Other():\n    return 2\n", encoding="utf-8")
        git(root, "add", ".")
        git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")

        report = self.run_inventory(root, "--path", "src")
        self.assertTrue(report["assets"])
        self.assertTrue(
            all(
                ref.startswith("src/")
                for asset in report["assets"]
                for ref in asset["code_refs"]
            )
        )


if __name__ == "__main__":
    unittest.main()
