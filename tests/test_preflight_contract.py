import copy
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from governance_contract import validate_design_authority
from preflight_contract import file_evidence, validate_preflight


def valid_record(root: Path) -> dict[str, object]:
    return {
        "schemaVersion": 2,
        "pluginId": "echo-semantic",
        "scope": "task",
        "repositoryRoot": str(root.resolve()),
        "baseRevision": "a" * 40,
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "taskId": "contract-test",
        "kind": "bugfix",
        "risk": "low",
        "allowedPaths": ["src"],
        "reuseCheck": {
            "searchPaths": ["."],
            "decision": "new",
            "reason": "已检查夹具相关能力",
            "candidates": [],
            "evidence": [],
        },
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
    def test_verification_scope_is_explicit_and_old_records_remain_task(self):
        with tempfile.TemporaryDirectory(prefix="echo-verification-scope-") as temp:
            root = Path(temp)
            record = valid_record(root)
            self.assertEqual(validate_preflight(record, root), [])
            record["verificationScope"] = "repository"
            self.assertEqual(validate_preflight(record, root), [])
            for invalid in ["all", True, [], None]:
                record["verificationScope"] = invalid
                self.assertTrue(
                    any(
                        "verificationScope" in issue
                        for issue in validate_preflight(record, root)
                    )
                )

    def test_candidates_bind_current_content_and_checked_symbol(self) -> None:
        with tempfile.TemporaryDirectory(prefix="echo-candidate-") as temp:
            root = Path(temp)
            candidate = root / "existing.py"
            candidate.write_text("def normalize(value):\n    return value\n")
            record = valid_record(root)
            check = record["reuseCheck"]
            check.update(
                decision="reuse",
                candidates=[
                    {
                        "path": "existing.py",
                        "symbol": "normalize",
                        "selected": True,
                        "reason": "输入输出相同",
                    }
                ],
                evidence=[file_evidence(root, "existing.py")],
            )
            self.assertEqual(validate_preflight(record, root), [])
            check["candidates"][0]["symbol"] = "missing"
            self.assertTrue(
                any("符号不存在" in issue for issue in validate_preflight(record, root))
            )
            check["candidates"][0]["symbol"] = "normalize"
            candidate.write_text("def normalize(value):\n    return None\n")
            self.assertTrue(
                any("摘要已变化" in issue for issue in validate_preflight(record, root))
            )

    def test_legacy_free_text_record_requires_reinspection(self) -> None:
        root = Path("/tmp/echo-semantic-contract")
        record = valid_record(root)
        record["schemaVersion"] = 1
        record.pop("reuseCheck", None)
        self.assertTrue(validate_preflight(record, root))

    def test_empty_references_do_not_read_semantic_files(self) -> None:
        with tempfile.TemporaryDirectory(prefix="echo-empty-refs-") as temp:
            root = Path(temp)
            rule = root / ".echo-semantic/rules/rule.unrelated.md"
            rule.parent.mkdir(parents=True)
            rule.write_text("---\nid: rule.unrelated\n---\n", encoding="utf-8")
            with patch.object(
                Path, "read_text", side_effect=AssertionError("不应扫描")
            ):
                self.assertEqual(validate_preflight(valid_record(root), root), [])

    def test_repair_metadata_is_read_once_per_validation_and_never_stale(self) -> None:
        with tempfile.TemporaryDirectory(prefix="echo-ref-reads-") as temp:
            root = Path(temp)
            finding = root / ".echo-semantic/findings/finding.repair.md"
            finding.parent.mkdir(parents=True)
            finding.write_text(
                "---\nid: finding.repair\nkind: finding\nstatus: resolved\n"
                "type: consolidation_candidate\ndecision: retire\n"
                "canonical_asset_ref: asset.new\ndelete_paths: [old.py]\n"
                "replacement_refs: [asset.new]\nrollback_ref: revert\n---\n",
                encoding="utf-8",
            )
            record = valid_record(root)
            record["reuseCheck"]["evidence"] = [
                file_evidence(root, finding.relative_to(root).as_posix())
            ]
            record.update(
                risk="high",
                semanticRefs=["finding.repair"],
                repairRefs=["finding.repair"],
                deletePaths=["old.py"],
            )
            original = Path.read_text
            reads = []

            def tracked(path, *args, **kwargs):
                reads.append(path)
                return original(path, *args, **kwargs)

            with patch.object(Path, "read_text", tracked):
                self.assertEqual(validate_preflight(record, root), [])
            self.assertEqual(reads.count(finding), 0)
            finding.write_text(
                "---\nid: finding.repair\nkind: finding\nstatus: open\n---\n"
            )
            self.assertTrue(
                any("变化" in error for error in validate_preflight(record, root))
            )

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
        with tempfile.TemporaryDirectory(prefix="echo-valid-record-") as temp:
            root = Path(temp)
            record = valid_record(root)
            self.assertEqual(
                validate_preflight(record, root, current_head="a" * 40), []
            )

    def test_missing_reuse_and_verification_are_rejected(self) -> None:
        root = Path("/tmp/echo-semantic-contract")
        record = valid_record(root)
        record["reuse"] = []
        record.pop("verifications")
        errors = validate_preflight(record, root, current_head="a" * 40)
        self.assertTrue(any("reuse" in error for error in errors))
        self.assertTrue(any("verifications" in error for error in errors))

    def test_repair_reference_must_target_completed_finding(self) -> None:
        with tempfile.TemporaryDirectory(prefix="echo-preflight-repair-") as temp:
            root = Path(temp)
            finding = root / ".echo-semantic/findings/finding.repair.md"
            finding.parent.mkdir(parents=True)
            finding.write_text(
                "---\nid: finding.repair\nkind: finding\nstatus: open\n---\n",
                encoding="utf-8",
            )
            record = valid_record(root)
            record["reuseCheck"]["evidence"] = [
                file_evidence(root, finding.relative_to(root).as_posix())
            ]
            record["repairRefs"] = ["finding.repair"]
            record["deletePaths"] = ["src/old.py"]
            errors = validate_preflight(record, root, current_head="a" * 40)
            self.assertTrue(any("已完成的 Finding" in error for error in errors))

    def test_delete_repair_requires_path_replacement_and_rollback_fields(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="echo-preflight-repair-fields-"
        ) as temp:
            root = Path(temp)
            finding = root / ".echo-semantic/findings/finding.repair.md"
            finding.parent.mkdir(parents=True)
            finding.write_text(
                "---\nid: finding.repair\nkind: finding\nstatus: resolved\n---\n",
                encoding="utf-8",
            )
            record = valid_record(root)
            record["reuseCheck"]["evidence"] = [
                file_evidence(root, finding.relative_to(root).as_posix())
            ]
            record["repairRefs"] = ["finding.repair"]
            record["deletePaths"] = ["src/old.py"]
            errors = validate_preflight(record, root, current_head="a" * 40)
            self.assertTrue(any("delete_paths" in error for error in errors))
            self.assertTrue(any("replacement_refs" in error for error in errors))
            self.assertTrue(any("rollback_ref" in error for error in errors))

    def test_delete_requires_high_risk(self) -> None:
        root = Path("/tmp/echo-semantic-contract")
        record = valid_record(root)
        record["deletePaths"] = ["src/old.py"]
        errors = validate_preflight(record, root, current_head="a" * 40)
        self.assertTrue(any("risk 必须是 high" in error for error in errors))

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
            record["reuseCheck"]["evidence"] = [
                file_evidence(root, rule.relative_to(root).as_posix())
            ]
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

    def test_search_scope_must_exist_and_stay_inside_repository(self) -> None:
        root = Path("/tmp/echo-semantic-contract")
        record = valid_record(root)
        record["reuseCheck"]["searchPaths"] = ["does-not-exist"]
        errors = validate_preflight(record, root)
        self.assertTrue(any("搜索范围不存在" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
