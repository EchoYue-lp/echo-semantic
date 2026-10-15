from __future__ import annotations

import copy
import gc
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/semantic-contract/scripts/verify_semantic.py"
SPEC = importlib.util.spec_from_file_location("audit_observation_verifier", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


class AuditObservationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix="audit-history-", dir=os.environ.get("TMPDIR")
        )
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Semantic fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        (self.root / "src").mkdir()
        (self.root / "src/current.txt").write_text("stable_anchor\n")
        self.history = self.root / "src/history.txt"
        self.history.write_text("anchor_one\n")
        self.first = self.commit("first historical anchor")
        self.history.write_text("anchor_two\n")
        self.second = self.commit("second historical anchor")
        self.history.write_text("anchor_current\n")
        self.current = self.commit("different current anchor")
        self.audit = {
            "schema_version": 1,
            "id": "audit.fixture",
            "kind": "audit",
            "boundary_ref": "boundary.fixture",
            "lens": "state_authority",
            "freshness": "examined",
            "revision": self.second,
            "challenges": {
                "first": {
                    "revision": self.first,
                    "source_refs": ["src/history.txt#anchor_one"],
                    "evidence_refs": ["evidence.fixture"],
                },
                "second": {
                    "revision": self.second,
                    "source_refs": ["src/history.txt#anchor_two"],
                    "evidence_refs": ["evidence.fixture"],
                },
            },
            "finding_refs": [],
        }

    def git(self, *args):
        result = subprocess.run(
            ["git", "-C", str(self.root), *args], capture_output=True, check=True
        )
        return result.stdout.decode().strip()

    def commit(self, label):
        self.git("add", ".")
        self.git("-c", "commit.gpgsign=false", "commit", "-qm", label)
        return self.git("rev-parse", "HEAD")

    def document(self, directory, data):
        filename = "baseline.md" if data["kind"] == "baseline" else data["id"] + ".md"
        path = self.root / ".echo-semantic" / directory / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("---\n" + json.dumps(data) + "\n---\n\n# Test observation\n")

    def snapshot(self, audit=None, *, behavior=None):
        baseline = {
            "schema_version": 1,
            "id": "baseline.repository",
            "kind": "baseline",
            "source_snapshot": {
                "base_revision": self.current,
                "content_digest": VERIFIER.source_digest(self.root),
            },
            "inventory_closure": "open",
            "behavior_model_closure": "open",
            "map_refs": [],
            "regions": [],
            "boundaries": [],
            "coverage": [],
        }
        self.document("", baseline)
        self.document(
            "evidence",
            {
                "schema_version": 1,
                "id": "evidence.fixture",
                "kind": "evidence",
                "observed_at": self.current,
                "source_refs": ["src/current.txt#stable_anchor"],
                "supports": [],
                "limitations": [],
            },
        )
        if audit is not None:
            self.document("audits", audit)
        if behavior is not None:
            self.document("behaviors", behavior)
        revision = self.commit("semantic observation")
        return VERIFIER.continuity_snapshot(self.root, revision)

    def ordinary_errors(self, audit):
        errors = []
        VERIFIER.validate_source_refs(
            self.root, [(Path("audit.fixture.md"), "audit", audit, "")], errors
        )
        return errors

    def test_two_challenges_same_path_keep_distinct_revision_and_anchor(self):
        self.assertEqual(self.ordinary_errors(self.audit), [])
        snapshot = self.snapshot(self.audit)
        self.assertEqual(snapshot["errors"], [])
        self.assertEqual(snapshot["obligations"], {})

    def test_missing_challenge_revision_uses_top_level_revision(self):
        audit = copy.deepcopy(self.audit)
        audit["challenges"] = {
            "fallback": {
                "source_refs": ["src/history.txt#anchor_two"],
                "evidence_refs": ["evidence.fixture"],
            }
        }
        self.assertEqual(self.ordinary_errors(audit), [])
        self.assertEqual(self.snapshot(audit)["errors"], [])

    def test_missing_both_revisions_blocks(self):
        audit = copy.deepcopy(self.audit)
        del audit["revision"]
        del audit["challenges"]["first"]["revision"]
        self.assertTrue(self.snapshot(audit)["errors"])

    def test_explicit_null_empty_and_invalid_revision_do_not_fall_back(self):
        for value in [None, "", "not-a-git-revision"]:
            with self.subTest(revision=value):
                audit = copy.deepcopy(self.audit)
                audit["challenges"]["first"]["revision"] = value
                self.assertTrue(self.snapshot(audit)["errors"])

    def test_unrecoverable_declared_git_blocks_even_when_current_blob_matches(self):
        audit = copy.deepcopy(self.audit)
        audit["challenges"] = {
            "missing": {
                "revision": "a" * 40,
                "source_refs": ["src/current.txt#stable_anchor"],
                "evidence_refs": ["evidence.fixture"],
            }
        }
        self.assertTrue(self.ordinary_errors(audit))
        self.assertTrue(self.snapshot(audit)["errors"])

    def test_missing_declared_original_blob_blocks(self):
        audit = copy.deepcopy(self.audit)
        audit["challenges"] = {
            "missing": {
                "revision": self.first,
                "source_refs": ["src/never-existed.txt#anchor_one"],
                "evidence_refs": ["evidence.fixture"],
            }
        }
        self.assertTrue(self.ordinary_errors(audit))
        self.assertTrue(self.snapshot(audit)["errors"])

    def test_original_anchor_missing_blocks_despite_current_anchor(self):
        audit = copy.deepcopy(self.audit)
        audit["challenges"] = {
            "bad-anchor": {
                "revision": self.first,
                "source_refs": ["src/history.txt#anchor_current"],
                "evidence_refs": ["evidence.fixture"],
            }
        }
        self.assertTrue(self.ordinary_errors(audit))
        self.assertTrue(self.snapshot(audit)["errors"])

    def test_historical_audit_blob_can_be_absent_from_current_tree(self):
        self.history.unlink()
        self.assertEqual(self.ordinary_errors(self.audit), [])
        self.assertEqual(self.snapshot(self.audit)["errors"], [])

    def test_stale_declared_source_digest_blocks(self):
        audit = copy.deepcopy(self.audit)
        audit["challenges"] = {
            "stale": {
                "revision": "source:" + "1" * 64,
                "source_refs": ["src/current.txt#stable_anchor"],
                "evidence_refs": ["evidence.fixture"],
            }
        }
        self.assertTrue(self.ordinary_errors(audit))
        self.assertTrue(self.snapshot(audit)["errors"])

    def test_non_audit_historical_behavior_still_requires_current_consumer(self):
        self.history.unlink()
        behavior = {
            "schema_version": 1,
            "id": "behavior.fixture",
            "kind": "behavior",
            "status": "verified",
            "expectation": "human_confirmed",
            "risk": "high",
            "primary_focus": "state_authority",
            "focus": ["contract_evidence"],
            "boundary": "boundary.fixture",
            "observed_at": self.first,
            "code_refs": ["src/history.txt#anchor_one"],
            "rule_refs": [],
            "evidence_refs": [],
            "finding_refs": [],
        }
        snapshot = self.snapshot(behavior=behavior)
        self.assertTrue(
            any("语义依赖未保留在候选结果" in error for error in snapshot["errors"])
        )
        self.assertIn("behavior.fixture", snapshot["obligations"])

    def prepare_local_contract(self):
        self.snapshot(self.audit)
        semantic = self.root / ".echo-semantic"
        (semantic / "README.md").write_text("正式材料入口")
        for directory in VERIFIER.REQUIRED_DIRECTORIES:
            (semantic / directory).mkdir(exist_ok=True)

    def test_local_artifacts_are_not_semantic_documents_but_other_roots_fail(self):
        self.prepare_local_contract()
        local = self.root / ".echo-semantic/local/task"
        local.mkdir(parents=True)
        (local / "not-an-object.md").write_text("unparsed local investigation")
        errors = []
        documents = VERIFIER.collect_documents(self.root / ".echo-semantic", errors)
        self.assertEqual(errors, [])
        self.assertFalse(any("local" in path.parts for path, *_ in documents))
        (self.root / ".echo-semantic/unrecognized").mkdir()
        errors = []
        VERIFIER.collect_documents(self.root / ".echo-semantic", errors)
        self.assertTrue(any("未声明的根级" in e for e in errors))

    def test_local_artifacts_cannot_be_tracked_or_formal_source_refs(self):
        self.prepare_local_contract()
        local = self.root / ".echo-semantic/local/task"
        local.mkdir(parents=True)
        (local / "receipt.md").write_text("local result")
        self.git("add", ".echo-semantic/local/task/receipt.md")
        errors = VERIFIER.validate_repository(self.root)
        self.assertTrue(any("运行态文件不能被 Git 跟踪" in e for e in errors))
        errors = []
        VERIFIER.validate_source_refs(
            self.root,
            [
                (
                    Path("evidence.local.md"),
                    "evidence",
                    {
                        "observed_at": "source:" + VERIFIER.source_digest(self.root),
                        "source_refs": [".echo-semantic/local/task/receipt.md"],
                    },
                    "",
                )
            ],
            errors,
        )
        self.assertTrue(any("本地产物不能作为正式源码引用" in e for e in errors))

    def test_local_root_symlink_or_file_is_rejected(self):
        self.prepare_local_contract()
        local = self.root / ".echo-semantic/local"
        local.write_text("not a directory")
        errors = []
        VERIFIER.collect_documents(self.root / ".echo-semantic", errors)
        self.assertTrue(errors)
        local.unlink()
        local.symlink_to(self.root / "src", target_is_directory=True)
        errors = []
        VERIFIER.collect_documents(self.root / ".echo-semantic", errors)
        self.assertTrue(any("符号链接" in e for e in errors))

    def observed_batch(self, object_id, consume):
        processes = []
        real_popen = subprocess.Popen

        def record_process(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            processes.append(process)
            return process

        def cleanup():
            for process in processes:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                for stream in [process.stdin, process.stdout, process.stderr]:
                    if stream is not None:
                        stream.close()

        self.addCleanup(cleanup)
        with mock.patch.object(
            VERIFIER.subprocess, "Popen", side_effect=record_process
        ):
            VERIFIER.consume_git_blob_batch(self.root, [object_id], consume)
        return processes

    def assert_batch_resources_closed(self, processes):
        self.assertEqual(len(processes), 1)
        process = processes[0]
        self.assertIsNotNone(process.poll())
        for stream in [process.stdin, process.stdout, process.stderr]:
            self.assertIsNotNone(stream)
            self.assertTrue(stream.closed)

    def test_batch_success_closes_pipes_without_changing_raw_bytes(self):
        payload = b"raw\xff\x00bytes\n"
        (self.root / "blob.bin").write_bytes(payload)
        self.commit("binary blob fixture")
        object_id = self.git("rev-parse", "HEAD:blob.bin")
        observed = []
        processes = self.observed_batch(
            object_id, lambda key, data: observed.append((key, data))
        )
        self.assertEqual(observed, [(object_id, payload)])
        self.assert_batch_resources_closed(processes)

    def test_batch_consumer_error_is_preserved_and_pipes_close(self):
        object_id = self.git("rev-parse", "HEAD:src/current.txt")
        failure = ValueError("consumer failed after exact blob read")
        processes = []
        real_popen = subprocess.Popen

        def record_process(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            processes.append(process)
            return process

        def consume(_key, _data):
            raise failure

        try:
            with (
                mock.patch.object(
                    VERIFIER.subprocess, "Popen", side_effect=record_process
                ),
                self.assertRaises(ValueError) as outcome,
            ):
                VERIFIER.consume_git_blob_batch(self.root, [object_id], consume)
            self.assertIs(outcome.exception, failure)
            self.assert_batch_resources_closed(processes)
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                for stream in [process.stdin, process.stdout, process.stderr]:
                    if stream is not None:
                        stream.close()

    def test_batch_missing_blob_still_errors_and_closes_pipes(self):
        object_id = "0" * 40
        processes = []
        real_popen = subprocess.Popen

        def record_process(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            processes.append(process)
            return process

        try:
            with (
                mock.patch.object(
                    VERIFIER.subprocess, "Popen", side_effect=record_process
                ),
                self.assertRaisesRegex(RuntimeError, "Git blob 批量读取响应无效"),
            ):
                VERIFIER.consume_git_blob_batch(self.root, [object_id], lambda *_: None)
            self.assert_batch_resources_closed(processes)
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                for stream in [process.stdin, process.stdout, process.stderr]:
                    if stream is not None:
                        stream.close()

    def test_batch_has_no_unraisable_resource_warning(self):
        object_id = self.git("rev-parse", "HEAD:src/current.txt")
        unraisable = []
        with mock.patch.object(sys, "unraisablehook", side_effect=unraisable.append):
            VERIFIER.consume_git_blob_batch(self.root, [object_id], lambda *_: None)
            gc.collect()
        self.assertEqual([repr(value.exc_value) for value in unraisable], [])


if __name__ == "__main__":
    unittest.main()
