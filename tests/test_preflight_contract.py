import copy
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from governance_contract import validate_design_authority
from preflight_contract import validate_preflight


def valid_record(root: Path) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "pluginId": "echo-semantic",
        "repositoryRoot": str(root.resolve()),
        "baseRevision": "a" * 40,
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "taskId": "contract-test",
        "kind": "bugfix",
        "risk": "low",
        "allowedPaths": ["src"],
        "reuse": ["复用现有能力"],
        "verifications": ["运行定向测试"],
        "basis": [],
        "semanticRefs": [],
        "signals": {
            "publicApi": False,
            "newStateAuthority": False,
            "newProtocol": False,
            "crossServiceMigration": False,
            "architectureChange": False,
            "unknownProductionCode": False,
        },
        "boundaryDecision": {"createsNew": False, "reason": "复用现有边界"},
        "designAuthorities": [],
    }


class PreflightContractTest(unittest.TestCase):
    def test_shared_contract_fixture(self) -> None:
        fixture = json.loads(
            (ROOT / "tests/fixtures/preflight-contract.json").read_text(
                encoding="utf-8"
            )
        )
        with tempfile.TemporaryDirectory(prefix="echo-preflight-fixture-") as temp:
            root = Path(temp)
            for item in fixture["cases"]:
                record = copy.deepcopy(valid_record(root))
                record.update(item.get("set", {}))
                record["signals"].update(item.get("signals", {}))
                for field in item.get("remove", []):
                    record.pop(field, None)
                self.assertEqual(
                    validate_preflight(record, root, current_head="a" * 40) == [],
                    item["valid"],
                    item["name"],
                )

    def test_valid_low_risk_record(self) -> None:
        root = Path("/tmp/echo-semantic-contract")
        record = valid_record(root)
        self.assertEqual(validate_preflight(record, root, current_head="a" * 40), [])

    def test_missing_reuse_and_verification_are_rejected(self) -> None:
        root = Path("/tmp/echo-semantic-contract")
        record = valid_record(root)
        record["reuse"] = []
        record.pop("verifications")
        errors = validate_preflight(record, root, current_head="a" * 40)
        self.assertTrue(any("reuse" in error for error in errors))
        self.assertTrue(any("verifications" in error for error in errors))

    def test_architecture_signal_requires_evidence_and_authority(self) -> None:
        root = Path("/tmp/echo-semantic-contract")
        record = valid_record(root)
        record["signals"]["architectureChange"] = True
        errors = validate_preflight(record, root, current_head="a" * 40)
        self.assertTrue(any("risk=high" in error for error in errors))
        self.assertTrue(any("basis" in error for error in errors))
        self.assertTrue(any("semanticRefs" in error for error in errors))
        self.assertTrue(any("designAuthorities" in error for error in errors))

    def test_semantic_reference_and_design_digest_must_remain_current(self) -> None:
        with tempfile.TemporaryDirectory(prefix="echo-preflight-contract-") as temp:
            root = Path(temp)
            rule = root / ".echo-semantic/rules/rule.state-authority.md"
            rule.parent.mkdir(parents=True)
            rule.write_text("---\nid: rule.state-authority\n---\n", encoding="utf-8")
            design = root / "docs/design/design.md"
            design.parent.mkdir(parents=True)
            design.write_text(
                "# 设计\n\n## 目标\n目标\n\n## 范围\n范围\n\n"
                "## 方案\n方案\n\n## 验收\n验收\n",
                encoding="utf-8",
            )
            record = valid_record(root)
            record["risk"] = "high"
            record["basis"] = ["架构依据"]
            record["semanticRefs"] = ["rule.state-authority"]
            record["signals"]["architectureChange"] = True
            record["designAuthorities"] = [
                validate_design_authority(root, "docs/design/design.md")
            ]
            self.assertEqual(
                validate_preflight(record, root, current_head="a" * 40), []
            )
            design.write_text(design.read_text(encoding="utf-8") + "变化\n")
            errors = validate_preflight(record, root, current_head="a" * 40)
            self.assertTrue(any("内容摘要已变化" in error for error in errors))

            record["semanticRefs"] = ["rule.missing"]
            errors = validate_preflight(record, root, current_head="a" * 40)
            self.assertTrue(any("引用不存在语义对象" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
