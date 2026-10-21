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
            capture_output=True,
            text=True,
            check=False,
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
        self.assertTrue(Path(report["report_path"]).is_file())
        self.assertFalse(
            (root / ".echo-semantic/discovery/discovery.semantic-assets.md").exists()
        )
        self.assertFalse((root / ".echo-semantic/assets").exists())

    def test_saved_report_is_independent_and_stale_confirmation_fails(self) -> None:
        root = self.repository()
        (root / "target.py").write_text("def Target():\n    return 1\n")
        git(root, "add", ".")
        git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")
        report = self.run_inventory(root, "--write")
        path = Path(report["report_path"])
        self.assertFalse((root / ".echo-semantic/baseline.md").exists())
        check = subprocess.run(
            [
                "uv",
                "run",
                str(SCRIPT),
                "--root",
                str(root),
                "--confirm-report",
                str(path),
                "--confirmation",
                "用户已确认候选用于基线维护",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(check.returncode, 0, check.stdout + check.stderr)
        (root / "target.py").write_text("def Target():\n    return 2\n")
        check = subprocess.run(
            [
                "uv",
                "run",
                str(SCRIPT),
                "--root",
                str(root),
                "--confirm-report",
                str(path),
                "--confirmation",
                "用户已确认候选用于基线维护",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(check.returncode, 0)
        self.assertFalse((root / ".echo-semantic/baseline.md").exists())

    def test_save_preserves_formal_material_and_runtime_and_is_idempotent(self) -> None:
        root = self.repository()
        (root / "src.py").write_text("def Shared():\n    return 1\n")
        semantic = root / ".echo-semantic"
        (semantic / "assets").mkdir(parents=True)
        (semantic / "discovery").mkdir()
        protected = {
            "baseline.md": b"formal baseline\n",
            "assets/asset.old.md": b"formal asset\n",
            "discovery/discovery.semantic-assets.md": b"previous discovery\n",
            "preflight.json": b'{"task":"active"}\n',
            "continuation.json": b'{"resume":"active"}\n',
            "route.json": b'{"verificationReceipt":"active"}\n',
        }
        for path, content in protected.items():
            (semantic / path).write_bytes(content)
        git(root, "add", "src.py")
        git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")
        first = self.run_inventory(root, "--write")
        second = self.run_inventory(root, "--write")
        self.assertEqual(first["report_path"], second["report_path"])
        for path, content in protected.items():
            self.assertEqual((semantic / path).read_bytes(), content)
        self.assertEqual(
            len(list((semantic / "discovery").glob("discovery.scan.*.md"))), 1
        )

    def test_scan_detects_mid_analysis_change_and_does_not_publish(self) -> None:
        root = self.repository()
        (root / "target.py").write_text("def Target():\n    return 1\n")
        git(root, "add", ".")
        git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")
        program = """
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('inventory',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=Path(sys.argv[2]);original=module.extract_assets
def changed(*args,**kwargs):
    value=original(*args,**kwargs)
    (root/'target.py').write_text('def Target():\\n    return 2\\n')
    return value
module.extract_assets=changed
try:module.scan(root,True)
except ValueError as error:
    assert '扫描期间源码变化' in str(error);sys.exit(0)
raise AssertionError('变化中扫描不能发布')
"""
        result = subprocess.run(
            [
                "uv",
                "run",
                "--with",
                "PyYAML>=6.0,<7",
                "python",
                "-c",
                program,
                str(SCRIPT),
                str(root),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((root / ".echo-semantic").exists())

    def test_concurrent_publication_keeps_one_complete_report(self) -> None:
        root = self.repository()
        (root / "target.py").write_text("def Target():\n    return 1\n")
        git(root, "add", ".")
        git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")
        command = ["uv", "run", str(SCRIPT), "--root", str(root), "--write"]
        first = subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        second = subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        reports = []
        for process in (first, second):
            stdout, stderr = process.communicate(timeout=30)
            self.assertEqual(process.returncode, 0, stdout + stderr)
            reports.append(json.loads(stdout))
        self.assertEqual(reports[0]["report_path"], reports[1]["report_path"])
        directory = root / ".echo-semantic/discovery"
        self.assertEqual(len(list(directory.iterdir())), 1)
        checked = subprocess.run(
            [
                "uv",
                "run",
                str(SCRIPT),
                "--root",
                str(root),
                "--check-report",
                reports[0]["report_path"],
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)

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

    def test_sensitive_paths_are_excluded_and_tampered_report_is_rejected(self) -> None:
        root = self.repository()
        (root / "target.py").write_text("def Target():\n    return 1\n")
        (root / ".env").write_text("SECRET=fixture-do-not-read\n")
        git(root, "add", ".")
        git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")
        report = self.run_inventory(root, "--write")
        self.assertIn(".env", [item["path"] for item in report["excluded"]])
        path = Path(report["report_path"])
        text = path.read_text()
        self.assertNotIn("fixture-do-not-read", text)
        path.write_text(
            text.replace(
                "behavior_model_closure: open", "behavior_model_closure: closed"
            )
        )
        result = subprocess.run(
            [
                "uv",
                "run",
                str(SCRIPT),
                "--root",
                str(root),
                "--check-report",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("不能宣称", result.stdout)

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

    def test_directory_swap_during_publication_never_writes_outside(self) -> None:
        root = self.repository()
        program = """
import os,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,sys.argv[1]);from scan_contract import publish_report
root=Path(sys.argv[2]);outside=Path(tempfile.mkdtemp(prefix='echo-outside-report-'))
original=os.link
def changed(*args,**kwargs):
    directory=root/'.echo-semantic/discovery'
    directory.rename(root/'.echo-semantic/old-discovery')
    directory.symlink_to(outside,target_is_directory=True)
    return original(*args,**kwargs)
try:
    with patch.object(os,'supports_dir_fd', {*os.supports_dir_fd,changed}),patch.object(os,'link',changed):
        try:publish_report(root,'discovery.scan.'+'a'*64,'complete report')
        except ValueError as error:assert '目录身份变化' in str(error)
        else:raise AssertionError('目录替换不能成功')
    assert not list(outside.iterdir()), '不得写仓外'
    assert not list((root/'.echo-semantic/old-discovery').iterdir()), '失败后撤回本次链接'
finally:outside.rmdir()
"""
        result = subprocess.run(
            ["python3", "-c", program, str(ROOT / "scripts"), str(root)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_local_inventory_never_hashes_unrelated_content(self) -> None:
        root = self.repository()
        (root / "target.py").write_text("def Target():\n    return 1\n")
        (root / "unrelated.bin").write_bytes(b"x" * 1024)
        git(root, "add", ".")
        git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")
        program = """
import importlib.util,json,sys
from pathlib import Path
from unittest.mock import patch
root=Path(sys.argv[2])
spec=importlib.util.spec_from_file_location('local_inventory',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
original=module.source_bytes
def read(repo,path,*args,**kwargs):
    assert path != 'unrelated.bin', '不得读取无关文件内容'
    return original(repo,path,*args,**kwargs)
with patch.object(module,'source_bytes',read):
    print(json.dumps(module.scan(root,False,['target.py'])))
"""
        result = subprocess.run(
            [
                "uv",
                "run",
                "--with",
                "PyYAML>=6.0,<7",
                "python",
                "-c",
                program,
                str(SCRIPT),
                str(root),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["scope"], "task")
        self.assertTrue(report["assets"])


if __name__ == "__main__":
    unittest.main()
