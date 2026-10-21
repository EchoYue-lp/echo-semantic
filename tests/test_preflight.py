import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "semantic-preflight" / "scripts" / "preflight.py"


class PreflightTest(unittest.TestCase):
    def test_repository_completion_scope_requires_explicit_cli_option(self):
        args = [
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "bugfix",
            "--risk",
            "low",
            "--allow",
            "README.md",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "夹具复用调查",
            "--verify",
            "定向测试",
            "--reuse-existing-boundary",
            "现有边界",
        ]
        result = self.run_script(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        state_path = self.repository / ".echo-semantic/preflight.json"
        self.assertEqual(
            json.loads(state_path.read_text())["verificationScope"], "task"
        )
        result = self.run_script(*args, "--verification-scope", "repository")
        self.assertEqual(result.returncode, 0, result.stderr)
        state = json.loads(state_path.read_text())
        self.assertEqual(state["verificationScope"], "repository")
        self.assertEqual(state["scope"], "task")
        self.assertFalse((self.repository / ".echo-semantic/baseline.md").exists())
        result = subprocess.run(
            [
                "uv",
                "run",
                str(ROOT / "skills/semantic-contract/scripts/verify_semantic.py"),
                "--root",
                str(self.repository),
                "--repository-scope",
                "--task-id",
                state["taskId"],
                "--base",
                state["baseRevision"],
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("缺少", result.stderr)
        self.assertTrue(state_path.exists())
        self.assertFalse((self.repository / ".echo-semantic/baseline.md").exists())

    @unittest.skipUnless(hasattr(os, "mkfifo"), "平台没有 FIFO")
    def test_incremental_check_rejects_non_regular_runtime_without_blocking(
        self,
    ) -> None:
        path = self.repository / ".echo-semantic/preflight.json"
        path.parent.mkdir()
        os.mkfifo(path)
        result = subprocess.run(
            [
                "python3",
                str(SCRIPT),
                "check",
                "--root",
                str(self.repository),
                "--task-id",
                "task",
                "--compact",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("普通文件", result.stderr)

    def test_same_task_cannot_lower_risk_or_remove_high_risk_signal(self) -> None:
        self.write_semantic_rule()
        common = [
            "record",
            "--root",
            str(self.repository),
            "--task-id",
            "stable-task",
            "--kind",
            "bugfix",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "复用能力",
            "--verify",
            "定向测试",
            "--reuse-existing-boundary",
            "已有边界",
        ]
        high = self.run_script(
            *common,
            "--risk",
            "high",
            "--public-api",
            "--basis",
            "契约变更",
            "--semantic-ref",
            "rule.state-authority",
        )
        self.assertEqual(high.returncode, 0, high.stderr)
        path = self.repository / ".echo-semantic/preflight.json"
        before = path.read_bytes()
        for risk in ["low", "high"]:
            lowered = self.run_script(*common, "--risk", risk)
            self.assertNotEqual(lowered.returncode, 0)
            self.assertIn("不得降级", lowered.stderr)
            self.assertEqual(path.read_bytes(), before)
        new_task = self.run_script(*common, "--task-id", "new-task", "--risk", "low")
        self.assertEqual(new_task.returncode, 0, new_task.stderr)

    def test_task_bound_compact_check_does_not_renew_or_rewrite_record(self) -> None:
        result = self.run_script(
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "bugfix",
            "--risk",
            "low",
            "--task-id",
            "task-one",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "复用现有边界",
            "--verify",
            "定向测试",
            "--reuse-existing-boundary",
            "现有能力",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        path = self.repository / ".echo-semantic/preflight.json"
        before = path.read_bytes()
        checked = self.run_script(
            "check",
            "--root",
            str(self.repository),
            "--task-id",
            "task-one",
            "--path",
            "src/parser.py",
            "--compact",
        )
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertEqual(json.loads(checked.stdout)["taskId"], "task-one")
        self.assertNotIn("reuse", json.loads(checked.stdout))
        self.assertEqual(path.read_bytes(), before)
        wrong = self.run_script(
            "check", "--root", str(self.repository), "--task-id", "task-two"
        )
        self.assertNotEqual(wrong.returncode, 0)
        self.assertIn("任务", wrong.stderr)

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="echo-preflight-")
        self.repository = Path(self.temporary.name)
        subprocess.run(["git", "init", "-q", str(self.repository)], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(self.repository),
                "config",
                "user.email",
                "test@example.com",
            ],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.repository), "config", "user.name", "Test"],
            check=True,
        )
        (self.repository / "README.md").write_text("# Test\n", encoding="utf-8")
        subprocess.run(
            ["git", "-C", str(self.repository), "add", "README.md"], check=True
        )
        subprocess.run(
            [
                "git",
                "-C",
                str(self.repository),
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                "initial",
            ],
            check=True,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(SCRIPT), *args], capture_output=True, text=True, check=False
        )

    def write_semantic_rule(self) -> None:
        rule = self.repository / ".echo-semantic/rules/rule.state-authority.md"
        rule.parent.mkdir(parents=True, exist_ok=True)
        rule.write_text(
            "---\nid: rule.state-authority\nkind: rule\n---\n",
            encoding="utf-8",
        )

    def test_records_low_risk_contract_in_project_state_directory(self) -> None:
        result = self.run_script(
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "bugfix",
            "--risk",
            "low",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "复用现有解析器",
            "--verify",
            "cargo test parser",
            "--reuse-existing-boundary",
            "扩展现有解析边界",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        state = json.loads(
            (self.repository / ".echo-semantic/preflight.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(state["allowedPaths"], ["src"])
        self.assertEqual(state["risk"], "low")
        self.assertTrue(state["taskId"])

    def test_high_risk_requires_basis_and_semantic_reference(self) -> None:
        result = self.run_script(
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "contract",
            "--risk",
            "high",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "没有可复用公共接口",
            "--verify",
            "cargo test",
            "--reuse-existing-boundary",
            "扩展现有公共契约边界",
            "--public-api",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--basis", result.stderr)

    def test_records_controlled_delete_targets_and_repair_reference(self) -> None:
        finding = self.repository / ".echo-semantic/findings/finding.repair.md"
        finding.parent.mkdir(parents=True, exist_ok=True)
        finding.write_text(
            "---\nid: finding.repair\nkind: finding\nstatus: resolved\ntype: consolidation_candidate\ndecision: migrate\ncanonical_asset_ref: asset.new\ndelete_paths: [src/old.py]\nreplacement_refs: [asset.new]\nrollback_ref: revert-old\n---\n",
            encoding="utf-8",
        )
        result = self.run_script(
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "refactor",
            "--risk",
            "high",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "finding.repair",
            "--verify",
            "project test",
            "--repair-ref",
            "finding.repair",
            "--delete-path",
            "src/old.py",
            "--basis",
            "受控删除",
            "--semantic-ref",
            "finding.repair",
            "--reuse-existing-boundary",
            "复用已有重构边界",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        state = json.loads(
            (self.repository / ".echo-semantic/preflight.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(state["repairRefs"], ["finding.repair"])
        self.assertEqual(state["deletePaths"], ["src/old.py"])
        self.assertEqual(state["scope"], "task")

    def test_high_risk_rejects_missing_semantic_object(self) -> None:
        result = self.run_script(
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "contract",
            "--risk",
            "high",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "复用现有接口",
            "--verify",
            "cargo test",
            "--basis",
            "公共接口变化",
            "--semantic-ref",
            "rule.missing",
            "--public-api",
            "--reuse-existing-boundary",
            "扩展现有契约边界",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("引用不存在语义对象", result.stderr)

    def test_rejects_symlinked_project_state_directory(self) -> None:
        outside = self.repository.parent / f"{self.repository.name}-outside"
        outside.mkdir()
        os.symlink(outside, self.repository / ".echo-semantic")
        result = self.run_script(
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "bugfix",
            "--risk",
            "low",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "复用现有解析器",
            "--verify",
            "cargo test parser",
            "--reuse-existing-boundary",
            "扩展现有解析边界",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("必须是普通目录", result.stderr)
        self.assertFalse((outside / "preflight.json").exists())

    def test_rejects_unwritable_exclude_contract(self) -> None:
        exclude = self.repository / ".git" / "info" / "exclude"
        exclude.unlink()
        exclude.mkdir()
        result = self.run_script(
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "bugfix",
            "--risk",
            "low",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "复用现有解析器",
            "--verify",
            "cargo test parser",
            "--reuse-existing-boundary",
            "扩展现有解析边界",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "无法把 Echo Semantic 运行态加入 .git/info/exclude", result.stderr
        )
        self.assertFalse((self.repository / ".echo-semantic/preflight.json").exists())
        shutil.rmtree(exclude)

    def test_architecture_change_requires_existing_authority(self) -> None:
        result = self.run_script(
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "refactor",
            "--risk",
            "high",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "复用现有状态机",
            "--verify",
            "cargo test",
            "--basis",
            "收敛唯一状态权威",
            "--semantic-ref",
            "rule.state-authority",
            "--architecture-change",
            "--new-boundary-reason",
            "收敛新的跨模块状态边界",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("design 或 ADR", result.stderr)

    def test_arbitrary_markdown_cannot_impersonate_adr(self) -> None:
        result = self.run_script(
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "refactor",
            "--risk",
            "high",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "复用现有状态机",
            "--verify",
            "cargo test",
            "--basis",
            "收敛唯一权威",
            "--semantic-ref",
            "rule.state-authority",
            "--architecture-change",
            "--new-boundary-reason",
            "形成新的模块边界",
            "--adr",
            "README.md",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("不是正式 design/ADR", result.stderr)

    def test_formal_adr_is_bound_by_content_digest(self) -> None:
        self.write_semantic_rule()
        adr = self.repository / "docs" / "adr" / "0001-test.md"
        adr.parent.mkdir(parents=True)
        adr.write_text(
            "# ADR\n\n## 状态\n已采纳\n\n## 背景\n问题\n\n"
            "## 候选方案\n方案\n\n## 决策\n采用\n\n## 影响\n影响\n",
            encoding="utf-8",
        )
        result = self.run_script(
            "record",
            "--root",
            str(self.repository),
            "--kind",
            "refactor",
            "--risk",
            "high",
            "--allow",
            "src",
            "--search",
            ".",
            "--reuse-decision",
            "new",
            "--reuse",
            "复用现有状态机",
            "--verify",
            "cargo test",
            "--basis",
            "收敛唯一权威",
            "--semantic-ref",
            "rule.state-authority",
            "--architecture-change",
            "--new-boundary-reason",
            "形成新的模块边界",
            "--adr",
            "docs/adr/0001-test.md",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        state = json.loads(
            (self.repository / ".echo-semantic/preflight.json").read_text(
                encoding="utf-8"
            )
        )
        authority = state["designAuthorities"][0]
        self.assertEqual(authority["kind"], "adr")
        self.assertEqual(len(authority["contentDigest"]), 64)


if __name__ == "__main__":
    unittest.main()
