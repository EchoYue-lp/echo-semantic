"""提交边界、正式引用和摘要隔离的反例。"""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from artifact_contract import check_artifacts, tracked_artifact_errors


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="echo-artifact-check-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for args in [
            ("init", "-q"),
            ("config", "user.email", "fixture@example.com"),
            ("config", "user.name", "Fixture"),
        ]:
            self.git(*args)

    def git(self, *args):
        result = subprocess.run(
            ["git", "-C", str(self.root), *args], capture_output=True, check=False
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def write(self, relative, content="{}"):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def commit(self):
        self.git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD").decode().strip()

    def test_unborn_index_and_worktree_do_not_hide_artifacts(self):
        relative = ".echo-semantic/local/task/中文 name\nresult.json"
        self.write(relative)
        self.git("add", "-f", relative)
        (self.root / relative).unlink()
        before = (self.root / ".git/index").read_bytes()
        report = check_artifacts(self.root, staged=True)
        self.assertTrue(any(relative in e for e in report["errors"]))
        self.assertEqual((self.root / ".git/index").read_bytes(), before)
        self.assertTrue(tracked_artifact_errors(self.root))

    def test_candidate_uses_committed_tree_and_cleanup_can_pass(self):
        self.write("source.py", "print('ok')")
        self.git("add", ".")
        base = self.commit()
        self.write(".echo-semantic/route.json")
        self.git("add", "-f", ".echo-semantic/route.json")
        self.commit()
        self.git("rm", ".echo-semantic/route.json")
        self.assertTrue(check_artifacts(self.root, base=base)["errors"])
        self.assertFalse(check_artifacts(self.root, staged=True)["errors"])
        self.commit()
        self.assertFalse(check_artifacts(self.root, base=base)["errors"])

    def test_rename_into_local_fails_but_fixture_and_logs_only_warn(self):
        self.write("tests/fixtures/response.json")
        self.write("tests/fixtures/process.log", "expected fixture")
        self.git("add", ".")
        report = check_artifacts(self.root, staged=True)
        self.assertFalse(report["errors"])
        self.assertEqual(len(report["warnings"]), 1)
        base = self.commit()
        target = self.root / ".echo-semantic/local/task/response.json"
        target.parent.mkdir(parents=True)
        self.git("mv", "tests/fixtures/response.json", str(target))
        self.assertTrue(check_artifacts(self.root, staged=True)["errors"])
        self.commit()
        self.assertTrue(check_artifacts(self.root, base=base)["errors"])

    def test_no_baseline_cli_enforces_and_invalid_base_fails(self):
        self.write(".echo-semantic/status.json")
        self.git("add", ".")
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts/artifact_contract.py"),
                "--root",
                str(self.root),
                "--staged",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn(
            ".echo-semantic/status.json", json.loads(result.stdout)["errors"][0]
        )
        self.commit()
        with self.assertRaises(ValueError):
            check_artifacts(self.root, base="missing-revision")

    def test_reserved_paths_are_case_insensitive_across_hosts(self):
        self.write(".ECHO-SEMANTIC/LOCAL/task/generated.py", "temporary")
        self.write(".ECHO-SEMANTIC/STATUS.JSON")
        self.git("add", "-f", ".ECHO-SEMANTIC")
        self.assertEqual(len(check_artifacts(self.root, staged=True)["errors"]), 2)
        self.assertEqual(len(tracked_artifact_errors(self.root)), 2)

    def test_record_rejects_local_reuse_candidates_and_aliases(self):
        self.write("source.py", "def candidate():\n    return 1\n")
        self.git("add", ".")
        self.commit()
        self.write(
            ".echo-semantic/local/task/candidate.py", "def candidate():\n    return 1\n"
        )
        for path in [
            ".echo-semantic/local/task/candidate.py",
            "./.echo-semantic/local/task/candidate.py",
            ".echo-semantic//local/task/candidate.py",
            ".ECHO-SEMANTIC/LOCAL/task/candidate.py",
        ]:
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "skills/semantic-preflight/scripts/preflight.py"),
                    "record",
                    "--root",
                    str(self.root),
                    "--kind",
                    "bugfix",
                    "--risk",
                    "low",
                    "--allow",
                    "source.py",
                    "--search",
                    ".",
                    "--reuse-decision",
                    "reuse",
                    "--reuse",
                    "检查临时候选不能成为正式复用依据",
                    "--verify",
                    "定向测试",
                    "--reuse-existing-boundary",
                    "复用现有边界",
                    "--candidate",
                    json.dumps(
                        {
                            "path": path,
                            "symbol": "candidate",
                            "selected": True,
                            "reason": "临时副本",
                        }
                    ),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("本地产物不能作为", result.stderr)
            self.assertFalse((self.root / ".echo-semantic/preflight.json").exists())

    def test_local_not_source_reference_or_digest_input(self):
        if importlib.util.find_spec("yaml") is None:
            result = subprocess.run(
                [
                    "uv",
                    "run",
                    "--with",
                    "PyYAML>=6.0,<7",
                    "python",
                    str(Path(__file__)),
                    "ArtifactTests.test_local_not_source_reference_or_digest_input",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return
        spec = importlib.util.spec_from_file_location(
            "artifact_verifier",
            ROOT / "skills/semantic-contract/scripts/verify_semantic.py",
        )
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        self.write("source.py", "print('ok')")
        self.git("add", ".")
        base = self.commit()
        digest = verifier.source_digest(self.root)
        historical = verifier.source_digest_at_revision(self.root, base)
        self.write(".echo-semantic/local/task/generated.py", "SECRET_ARTIFACT")
        self.git("add", "-f", ".echo-semantic/local/task/generated.py")
        self.assertEqual(verifier.source_digest(self.root), digest)
        self.commit()
        self.assertEqual(
            verifier.source_digest_at_revision(self.root, "HEAD"), historical
        )
        self.assertIsNone(
            verifier.parse_source_ref(".echo-semantic/local/task/generated.py#SECRET")
        )
        for alias in [
            "./.echo-semantic/local/task/generated.py",
            ".echo-semantic//local/task/generated.py",
            ".ECHO-SEMANTIC/LOCAL/task/generated.py",
        ]:
            self.assertIsNone(verifier.parse_source_ref(alias))
        (self.root / ".echo-semantic/local/task/generated.py").write_text("changed")
        self.assertEqual(verifier.source_digest(self.root), digest)
        spec = importlib.util.spec_from_file_location(
            "artifact_inventory", ROOT / "skills/semantic-discover/scripts/inventory.py"
        )
        inventory = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(inventory)
        self.assertNotIn(
            ".echo-semantic/local/task/generated.py", inventory.git_paths(self.root)
        )
        # 在大小写不敏感卷也保留指定的 Git 路径拼写，真实检查历史 tree。
        self.git("config", "core.ignorecase", "false")
        self.write(".ECHO-SEMANTIC/LOCAL/task/case-alias.txt", "temporary")
        self.git("add", "-f", ".ECHO-SEMANTIC/LOCAL/task/case-alias.txt")
        self.commit()
        self.assertIn(
            b".ECHO-SEMANTIC/LOCAL/task/case-alias.txt", self.git("ls-files", "-z")
        )
        self.assertEqual(
            verifier.source_digest_at_revision(self.root, "HEAD"), historical
        )
        self.assertEqual(verifier.source_digest(self.root), digest)
        self.assertNotIn(
            ".ECHO-SEMANTIC/LOCAL/task/case-alias.txt", inventory.git_paths(self.root)
        )
        self.git("rm", "--cached", "-f", ".echo-semantic/local/task/generated.py")
        self.git("rm", "--cached", "-f", ".ECHO-SEMANTIC/LOCAL/task/case-alias.txt")
        self.write(
            ".echo-semantic/preflight.json",
            json.dumps(
                {
                    "schemaVersion": 2,
                    "reuseCheck": {
                        "evidence": [{"path": ".echo-semantic/local/task/generated.py"}]
                    },
                }
            ),
        )
        # local 依据在完整合同读取内容前拒绝；不将其字节纳入签名。
        verifier.validate_preflight = lambda *args, **kwargs: self.fail(
            "不能读取local依据"
        )
        errors, _ = verifier.validate_task(self.root, "HEAD", "task")
        self.assertTrue(any("本地产物不能作为" in e for e in errors))
        self.write(
            ".echo-semantic/preflight.json",
            json.dumps(
                {
                    "schemaVersion": 2,
                    "reuseCheck": {
                        "evidence": [
                            {"path": "./.echo-semantic//local/task/generated.py"}
                        ]
                    },
                }
            ),
        )
        errors, _ = verifier.validate_task(self.root, "HEAD", "task")
        self.assertTrue(any("本地产物不能作为" in e for e in errors))
        if sys.platform != "win32":
            (self.root / "alias").symlink_to(
                self.root / ".echo-semantic/local/task", target_is_directory=True
            )
            with self.assertRaises(RuntimeError):
                verifier.content_at_revision(
                    self.root, "source:" + digest, "alias/generated.py"
                )


if __name__ == "__main__":
    unittest.main()
