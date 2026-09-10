import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "semantic-preflight" / "scripts" / "preflight.py"


class PreflightTest(unittest.TestCase):
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
