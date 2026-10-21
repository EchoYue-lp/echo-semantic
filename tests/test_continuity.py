from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "skills/semantic-contract/scripts/verify_semantic.py"


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


def source_digest(root: Path) -> str:
    paths = git(
        root, "ls-files", "--cached", "--others", "--exclude-standard"
    ).splitlines()
    digest = hashlib.sha256()
    for relative in sorted(
        path for path in paths if not path.startswith(".echo-semantic/")
    ):
        path = root / relative
        if not path.is_file():
            continue
        identity = "file:" + hashlib.sha256(path.read_bytes()).hexdigest()
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(identity.encode())
        digest.update(b"\n")
    return digest.hexdigest()


def write_baseline(root: Path, base_revision: str) -> None:
    path = root / ".echo-semantic/baseline.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        "schema_version: 1\n"
        "id: baseline.repository\n"
        "kind: baseline\n"
        "source_snapshot:\n"
        f"  base_revision: {base_revision}\n"
        f"  content_digest: {source_digest(root)}\n"
        "inventory_closure: open\n"
        "behavior_model_closure: open\n"
        "map_refs: []\n"
        "regions: []\n"
        "boundaries: []\n"
        "coverage: []\n"
        "---\n\n# Baseline\n",
        encoding="utf-8",
    )


def write_behavior(
    root: Path,
    identifier: str,
    promise: str,
    *,
    code_ref: str = "src/runtime.txt",
    code_refs: list[str] | None = None,
    evidence_refs: list[str] | None = None,
    asset_refs: list[str] | None = None,
) -> None:
    path = root / ".echo-semantic/behaviors" / f"{identifier}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        "schema_version: 1\n"
        f"id: {identifier}\n"
        "kind: behavior\n"
        "status: verified\n"
        "expectation: human_confirmed\n"
        "risk: high\n"
        "primary_focus: time_lifecycle\n"
        "focus: [contract_evidence]\n"
        "boundary: boundary.runtime\n"
        f"observed_at: source:{source_digest(root)}\n"
        f"code_refs: [{', '.join(code_refs or [code_ref])}]\n"
        "rule_refs: []\n"
        f"evidence_refs: [{', '.join(evidence_refs or [])}]\n"
        f"asset_refs: [{', '.join(asset_refs or [])}]\n"
        "finding_refs: []\n"
        "---\n\n"
        f"# {identifier}\n\n## 重要承诺\n\n{promise}\n",
        encoding="utf-8",
    )


def write_semantic_document(
    root: Path, directory: str, identifier: str, data: dict
) -> None:
    path = root / ".echo-semantic" / directory / f"{identifier}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        + json.dumps(data, ensure_ascii=False, indent=2)
        + "\n---\n\n# Continuity fixture\n",
        encoding="utf-8",
    )


def write_asset_marker(
    root: Path,
    identifier: str,
    *,
    asset_type: str = "document",
    code_refs: list[str] | None = None,
    consumer_refs: list[str] | None = None,
) -> None:
    write_semantic_document(
        root,
        "assets",
        identifier,
        {
            "schema_version": 1,
            "id": identifier,
            "kind": "asset",
            "title": identifier,
            "asset_type": asset_type,
            "status": "active",
            "risk": "low",
            "observed_at": f"source:{source_digest(root)}",
            "boundary_refs": [],
            "code_refs": code_refs or ["src/runtime.txt"],
            "consumer_refs": consumer_refs or [],
            "behavior_refs": [],
            "rule_refs": [],
            "evidence_refs": [],
            "finding_refs": [],
            "candidate_refs": [],
        },
    )


def refresh_observed_source_digests(root: Path) -> None:
    digest = source_digest(root)
    for path in (root / ".echo-semantic").glob("**/*.md"):
        text = path.read_text(encoding="utf-8")
        refreshed = re.sub(
            r"(?m)^observed_at: source:[0-9a-f]{64}$",
            f"observed_at: source:{digest}",
            text,
        )
        refreshed = re.sub(
            r'(?m)^(\s*"observed_at":\s*")source:[0-9a-f]{64}("[,]?)$',
            rf"\1source:{digest}\2",
            refreshed,
        )
        path.write_text(refreshed, encoding="utf-8")


def write_equivalence(
    root: Path,
    identifier: str,
    supports: list[str],
    *,
    before_revision: str = "0" * 40,
    scenario_status: str = "matched",
    source_ref: str = "src/runtime.txt",
) -> None:
    digest = source_digest(root)
    write_semantic_document(
        root,
        "evidence",
        identifier,
        {
            "schema_version": 1,
            "id": identifier,
            "kind": "evidence",
            "observed_at": f"source:{digest}",
            "source_refs": [source_ref],
            "supports": supports,
            "limitations": ["测试夹具只覆盖声明场景"],
            "evidence_type": "behavior_equivalence",
            "before_revision": before_revision,
            "after_revision": f"source:{digest}",
            "scenario_results": {
                "runtime": {
                    "status": scenario_status,
                    "source_refs": [source_ref],
                }
            },
            "command_results": [{"command": "fixture", "exit_code": 0}],
            "coverage": ["runtime"],
            "deleted_paths": [],
        },
    )


def write_continuity_evidence(
    root: Path,
    identifier: str,
    merge_base: str,
    predecessor_revisions: list[str],
    result_snapshot: str,
    resolutions: dict,
) -> None:
    write_semantic_document(
        root,
        "evidence",
        identifier,
        {
            "schema_version": 1,
            "id": identifier,
            "kind": "evidence",
            "observed_at": result_snapshot,
            "source_refs": ["src/runtime.txt"],
            "supports": [],
            "limitations": ["测试夹具"],
            "evidence_type": "semantic_continuity",
            "merge_base_revision": merge_base,
            "predecessor_revisions": predecessor_revisions,
            "result_snapshot": result_snapshot,
            "resolutions": resolutions,
        },
    )


class ContinuityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="echo-continuity-")
        self.repository = Path(self.temporary.name) / "repository"
        self.repository.mkdir()
        git(self.repository, "init", "-q")
        git(self.repository, "config", "user.email", "test@example.com")
        git(self.repository, "config", "user.name", "Test")
        (self.repository / "src").mkdir()
        (self.repository / "src/runtime.txt").write_text("runtime\n", encoding="utf-8")
        git(self.repository, "add", ".")
        git(
            self.repository,
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "source",
        )
        source_revision = git(self.repository, "rev-parse", "HEAD")
        write_baseline(self.repository, source_revision)
        write_behavior(self.repository, "behavior.runtime", "运行时保持可用。")
        git(self.repository, "add", ".")
        git(
            self.repository,
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "semantic baseline",
        )
        self.base = git(self.repository, "rev-parse", "HEAD")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def commit_behavior(
        self, branch: str, identifier: str, promise: str, *, message: str | None = None
    ) -> str:
        git(self.repository, "switch", "-qc", branch, self.base)
        write_behavior(self.repository, identifier, promise)
        write_baseline(self.repository, self.base)
        git(self.repository, "add", ".")
        git(
            self.repository,
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            message or identifier,
        )
        return git(self.repository, "rev-parse", "HEAD")

    def commit_current(self, message: str) -> str:
        refresh_observed_source_digests(self.repository)
        write_baseline(self.repository, self.base)
        git(self.repository, "add", ".")
        git(
            self.repository,
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            message,
        )
        return git(self.repository, "rev-parse", "HEAD")

    def merge(self, target: str, source: str, *, ours: bool = False) -> str:
        git(self.repository, "switch", target)
        args = [
            "-c",
            "commit.gpgsign=false",
            "merge",
        ]
        if ours:
            args.extend(["-s", "ours"])
        args.extend(["--no-edit", source])
        git(self.repository, *args)
        return git(self.repository, "rev-parse", "HEAD")

    def run_continuity(
        self, target: str, source: str, result: str, *, merge_base: str | None = None
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "uv",
                "run",
                str(VERIFIER),
                "--root",
                str(self.repository),
                "--continuity-merge-base",
                merge_base or self.base,
                "--continuity-predecessor",
                target,
                "--continuity-predecessor",
                source,
                "--continuity-result",
                result,
            ],
            check=False,
            capture_output=True,
            text=True,
        )

    def collect_document_errors(self) -> list[str]:
        completed = subprocess.run(
            ["uv", "run", str(VERIFIER), "--root", str(self.repository)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertIn(completed.returncode, (0, 1), completed.stderr)
        return (completed.stdout + completed.stderr).splitlines()

    def test_session_runtime_files_are_accepted_by_document_collector(self) -> None:
        semantic_root = self.repository / ".echo-semantic"
        baseline_errors = self.collect_document_errors()
        for name in ("session-snapshot.json", "stop-dedupe.json"):
            (semantic_root / name).write_text("{}\n", encoding="utf-8")
        self.assertEqual(self.collect_document_errors(), baseline_errors)

    def test_unknown_runtime_file_is_rejected_by_document_collector(self) -> None:
        path = self.repository / ".echo-semantic/unknown-runtime.json"
        path.write_text("{}\n", encoding="utf-8")
        errors = self.collect_document_errors()
        self.assertTrue(
            any(
                path.name in error and "合同未声明的根级条目" in error
                for error in errors
            ),
            errors,
        )

    def test_session_runtime_symlinks_are_rejected_by_document_collector(self) -> None:
        for name in ("session-snapshot.json", "stop-dedupe.json"):
            with self.subTest(name=name):
                path = self.repository / ".echo-semantic" / name
                path.symlink_to("README.md")
                try:
                    errors = self.collect_document_errors()
                    self.assertTrue(
                        any(
                            name in error and "不能使用符号链接" in error
                            for error in errors
                        ),
                        errors,
                    )
                finally:
                    path.unlink()

    def test_merge_result_missing_one_parent_obligation_is_blocked(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.timeout", "运行时必须保留超时语义。"
        )
        source = self.commit_behavior(
            "source", "behavior.compaction", "运行时必须保留压缩语义。"
        )
        git(self.repository, "switch", "target")
        git(
            self.repository,
            "-c",
            "commit.gpgsign=false",
            "merge",
            "-s",
            "ours",
            "--no-edit",
            "source",
        )
        result = git(self.repository, "rev-parse", "HEAD")

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        report = json.loads(completed.stdout)
        self.assertTrue(
            any(
                item["obligation"] == "behavior.compaction"
                and item["status"] == "missing"
                for item in report["results"]
            )
        )

    def test_merge_result_preserves_union_of_parent_obligations(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.timeout", "运行时必须保留超时语义。"
        )
        source = self.commit_behavior(
            "source", "behavior.compaction", "运行时必须保留压缩语义。"
        )
        result = self.merge("target", "source")

        completed = self.run_continuity(target, source, result)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertTrue(report["passed"])
        statuses = {item["obligation"]: item["status"] for item in report["results"]}
        self.assertEqual(statuses["behavior.timeout"], "preserved")
        self.assertEqual(statuses["behavior.compaction"], "preserved")

    def test_squash_candidate_without_parent_links_preserves_or_loses_union(
        self,
    ) -> None:
        target = self.commit_behavior(
            "target", "behavior.timeout", "运行时必须保留超时语义。"
        )
        source = self.commit_behavior(
            "source", "behavior.compaction", "运行时必须保留压缩语义。"
        )
        git(self.repository, "switch", "-qc", "squash-result", self.base)
        git(
            self.repository,
            "restore",
            "--source",
            target,
            "--",
            ".echo-semantic/behaviors/behavior.timeout.md",
        )
        git(
            self.repository,
            "restore",
            "--source",
            source,
            "--",
            ".echo-semantic/behaviors/behavior.compaction.md",
        )
        result = self.commit_current("squash semantic union")
        self.assertNotEqual(
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(self.repository),
                    "merge-base",
                    "--is-ancestor",
                    target,
                    result,
                ],
                check=False,
            ).returncode,
            0,
        )
        self.assertNotEqual(
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(self.repository),
                    "merge-base",
                    "--is-ancestor",
                    source,
                    result,
                ],
                check=False,
            ).returncode,
            0,
        )

        preserved = self.run_continuity(target, source, result)
        self.assertEqual(preserved.returncode, 0, preserved.stdout)
        (self.repository / ".echo-semantic/behaviors/behavior.compaction.md").unlink()
        lost_result = self.commit_current("squash candidate loses compaction")
        lost = self.run_continuity(target, source, lost_result)
        self.assertNotEqual(lost.returncode, 0)
        self.assertIn('"obligation": "behavior.compaction"', lost.stdout)

    def test_rebase_or_cherry_pick_candidate_can_be_non_parent_result(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.timeout", "运行时必须保留超时语义。"
        )
        source = self.commit_behavior(
            "source", "behavior.compaction", "运行时必须保留压缩语义。"
        )
        git(self.repository, "switch", "-qc", "rebased-result", target)
        git(
            self.repository,
            "restore",
            "--source",
            source,
            "--",
            ".echo-semantic/behaviors/behavior.compaction.md",
        )
        result = self.commit_current("rebase source semantics onto target")
        self.assertNotEqual(
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(self.repository),
                    "merge-base",
                    "--is-ancestor",
                    source,
                    result,
                ],
                check=False,
            ).returncode,
            0,
        )

        completed = self.run_continuity(target, source, result)
        self.assertEqual(completed.returncode, 0, completed.stdout)

    def test_pr_merge_ref_is_resolved_as_candidate_result(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.timeout", "运行时必须保留超时语义。"
        )
        source = self.commit_behavior(
            "source", "behavior.compaction", "运行时必须保留压缩语义。"
        )
        result = self.merge("target", "source")
        git(self.repository, "update-ref", "refs/pull/1/merge", result)

        completed = self.run_continuity(target, source, "refs/pull/1/merge")
        self.assertEqual(completed.returncode, 0, completed.stdout)
        report = json.loads(completed.stdout)
        self.assertEqual(report["result_revision"], result)

    def test_same_obligation_changed_differently_is_conflicted(self) -> None:
        target = self.commit_behavior("target", "behavior.shared", "目标分支行为。")
        source = self.commit_behavior("source", "behavior.shared", "来源分支行为。")
        result = self.merge("target", "source", ours=True)

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        report = json.loads(completed.stdout)
        item = next(
            value
            for value in report["results"]
            if value["obligation"] == "behavior.shared"
        )
        self.assertEqual(item["status"], "conflicted")

    def test_conflict_resolution_requires_decision_and_equivalence(self) -> None:
        target = self.commit_behavior("target", "behavior.shared", "目标分支行为。")
        source = self.commit_behavior("source", "behavior.shared", "来源分支行为。")
        initial_result = self.merge("target", "source", ours=True)
        initial = json.loads(self.run_continuity(target, source, initial_result).stdout)
        shared = next(
            item
            for item in initial["results"]
            if item["obligation"] == "behavior.shared"
        )
        decision_path = self.repository / "docs/adr/resolve-shared.md"
        decision_path.parent.mkdir(parents=True)
        predecessor_text = "\n".join(initial["predecessor_revisions"])
        decision_path.write_text(
            "# 冲突决策\n\n## 状态\n已批准\n\n## 背景\n"
            "behavior.shared 在两个分支定义不同。\n\n## 候选方案\n选择目标或来源。\n\n"
            "## 决策\n采用目标分支 behavior.shared，理由是目标契约已经确认。\n\n"
            f"前置 revisions：\n{predecessor_text}\n\n"
            "## 影响\n兼容影响是来源行为不再保留；回滚策略为 revert fixture。\n",
            encoding="utf-8",
        )
        equivalence_refs = []
        for index, revision in enumerate(initial["predecessor_revisions"], start=1):
            reference = f"evidence.shared-equivalence-{index}"
            write_equivalence(
                self.repository,
                reference,
                ["behavior.shared"],
                before_revision=revision,
            )
            equivalence_refs.append(reference)
        decision_digest = hashlib.sha256(decision_path.read_bytes()).hexdigest()
        snapshot = f"source:{source_digest(self.repository)}"
        write_continuity_evidence(
            self.repository,
            "evidence.continuity-conflict",
            self.base,
            initial["predecessor_revisions"],
            snapshot,
            {
                "behavior.shared": {
                    "disposition": "resolved_conflict",
                    "predecessor_fingerprints": shared["predecessor_fingerprints"],
                    "replacement_ref": "behavior.shared",
                    "evidence_refs": equivalence_refs,
                    "decision_authorities": [
                        {
                            "kind": "adr",
                            "path": "docs/adr/resolve-shared.md",
                            "content_digest": decision_digest,
                        }
                    ],
                    "compatibility_impact": "采用目标分支行为。",
                    "rollback_ref": "revert conflict fixture",
                }
            },
        )
        result = self.commit_current("resolve semantic conflict")

        completed = self.run_continuity(target, source, result)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        resolved = next(
            item
            for item in report["results"]
            if item["obligation"] == "behavior.shared"
        )
        self.assertEqual(resolved["status"], "replaced")
        self.assertEqual(
            resolved["resolution"]["evidence_ref"],
            "evidence.continuity-conflict",
        )
        self.assertEqual(resolved["resolution"]["replacement_ref"], "behavior.shared")

    def test_conflict_cannot_be_hidden_as_self_replacement(self) -> None:
        target = self.commit_behavior("target", "behavior.shared", "目标分支行为。")
        source = self.commit_behavior("source", "behavior.shared", "来源分支行为。")
        initial_result = self.merge("target", "source", ours=True)
        initial = json.loads(self.run_continuity(target, source, initial_result).stdout)
        shared = next(
            item
            for item in initial["results"]
            if item["obligation"] == "behavior.shared"
        )
        write_equivalence(
            self.repository, "evidence.self-replacement", ["behavior.shared"]
        )
        snapshot = f"source:{source_digest(self.repository)}"
        write_continuity_evidence(
            self.repository,
            "evidence.continuity-self-replacement",
            self.base,
            initial["predecessor_revisions"],
            snapshot,
            {
                "behavior.shared": {
                    "disposition": "replaced",
                    "predecessor_fingerprints": shared["predecessor_fingerprints"],
                    "replacement_ref": "behavior.shared",
                    "evidence_refs": ["evidence.self-replacement"],
                    "decision_authorities": [],
                    "compatibility_impact": "试图静默选择目标分支。",
                    "rollback_ref": "revert invalid fixture",
                }
            },
        )
        result = self.commit_current("invalid self replacement")

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("不允许使用原义务作为自身替代", completed.stdout)
        self.assertIn("resolved_conflict", completed.stdout)

    def test_one_parent_change_is_preserved_over_unchanged_base(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.runtime", "目标分支更新后的运行时行为。"
        )
        git(self.repository, "switch", "-qc", "source", self.base)
        write_asset_marker(self.repository, "asset.source-marker")
        source = self.commit_current("unchanged source marker")
        result = self.merge("target", "source")

        completed = self.run_continuity(target, source, result)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_parent_removal_conflicts_with_other_parent_retention(self) -> None:
        git(self.repository, "switch", "-qc", "target", self.base)
        (self.repository / ".echo-semantic/behaviors/behavior.runtime.md").unlink()
        target = self.commit_current("remove runtime behavior")
        git(self.repository, "switch", "-qc", "source", self.base)
        write_asset_marker(self.repository, "asset.source-marker")
        source = self.commit_current("retain runtime behavior")
        result = self.merge("target", "source", ours=True)

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        report = json.loads(completed.stdout)
        runtime = next(
            item
            for item in report["results"]
            if item["obligation"] == "behavior.runtime"
        )
        self.assertEqual(runtime["status"], "conflicted")

    def test_older_ancestor_cannot_replace_real_merge_base(self) -> None:
        write_behavior(
            self.repository,
            "behavior.legacy",
            "共同基准仍保留旧行为。",
        )
        common = self.commit_current("add legacy behavior to common base")
        git(self.repository, "switch", "-qc", "target", common)
        write_behavior(
            self.repository,
            "behavior.legacy",
            "目标分支修改后的旧行为。",
        )
        target = self.commit_current("modify legacy behavior")
        git(self.repository, "switch", "-qc", "source", common)
        (self.repository / ".echo-semantic/behaviors/behavior.legacy.md").unlink()
        write_asset_marker(self.repository, "asset.source-marker")
        source = self.commit_current("remove legacy behavior")
        result = self.merge("target", "source", ours=True)

        actual = self.run_continuity(target, source, result, merge_base=common)
        self.assertNotEqual(actual.returncode, 0)
        actual_report = json.loads(actual.stdout)
        actual_legacy = next(
            item
            for item in actual_report["results"]
            if item["obligation"] == "behavior.legacy"
        )
        self.assertEqual(actual_legacy["status"], "conflicted")

        older = self.run_continuity(target, source, result, merge_base=self.base)
        self.assertNotEqual(older.returncode, 0)
        self.assertIn("不是前置版本的真实共同基准", older.stdout)

    def test_same_unapproved_removal_in_both_parents_is_blocked(self) -> None:
        git(self.repository, "switch", "-qc", "target", self.base)
        (self.repository / ".echo-semantic/behaviors/behavior.runtime.md").unlink()
        write_asset_marker(self.repository, "asset.target-marker")
        target = self.commit_current("target removes runtime behavior")
        git(self.repository, "switch", "-qc", "source", self.base)
        (self.repository / ".echo-semantic/behaviors/behavior.runtime.md").unlink()
        write_asset_marker(self.repository, "asset.source-marker")
        source = self.commit_current("source removes runtime behavior")
        result = self.merge("target", "source")

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        report = json.loads(completed.stdout)
        runtime = next(
            item
            for item in report["results"]
            if item["obligation"] == "behavior.runtime"
        )
        self.assertEqual(runtime["status"], "conflicted")

    def test_identical_parent_change_is_preserved(self) -> None:
        target = self.commit_behavior(
            "target",
            "behavior.shared",
            "两个分支共同确认的行为。",
            message="target shared behavior",
        )
        git(self.repository, "switch", "target")
        write_asset_marker(self.repository, "asset.target-marker")
        target = self.commit_current("target marker")
        source = self.commit_behavior(
            "source",
            "behavior.shared",
            "两个分支共同确认的行为。",
            message="source shared behavior",
        )
        write_asset_marker(self.repository, "asset.source-marker")
        source = self.commit_current("source marker")
        result = self.merge("target", "source")

        completed = self.run_continuity(target, source, result)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_single_predecessor_code_move_keeps_semantic_identity(self) -> None:
        git(self.repository, "switch", "-qc", "move", self.base)
        write_equivalence(self.repository, "evidence.runtime", ["behavior.runtime"])
        write_behavior(
            self.repository,
            "behavior.runtime",
            "运行时保持可用。",
            evidence_refs=["evidence.runtime"],
        )
        predecessor = self.commit_current("add stable runtime evidence")
        git(self.repository, "mv", "src/runtime.txt", "src/runtime-moved.txt")
        write_equivalence(
            self.repository,
            "evidence.runtime",
            ["behavior.runtime"],
            source_ref="src/runtime-moved.txt",
        )
        write_behavior(
            self.repository,
            "behavior.runtime",
            "运行时保持可用。",
            code_ref="src/runtime-moved.txt",
            evidence_refs=["evidence.runtime"],
        )
        result = self.commit_current("move implementation")

        completed = subprocess.run(
            [
                "uv",
                "run",
                str(VERIFIER),
                "--root",
                str(self.repository),
                "--continuity-merge-base",
                predecessor,
                "--continuity-predecessor",
                predecessor,
                "--continuity-result",
                result,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_same_role_code_and_consumer_reference_reduction_is_blocked(self) -> None:
        git(self.repository, "switch", "-qc", "reference-count", self.base)
        for relative in (
            "src/secondary.txt",
            "src/consumer-a.txt",
            "src/consumer-b.txt",
        ):
            (self.repository / relative).write_text(relative + "\n", encoding="utf-8")
        write_asset_marker(
            self.repository,
            "asset.runtime",
            consumer_refs=["src/consumer-a.txt", "src/consumer-b.txt"],
        )
        write_behavior(
            self.repository,
            "behavior.runtime",
            "运行时保持可用。",
            code_refs=["src/runtime.txt", "src/secondary.txt"],
            asset_refs=["asset.runtime"],
        )
        predecessor = self.commit_current("add parallel implementation references")

        (self.repository / "src/secondary.txt").unlink()
        (self.repository / "src/consumer-b.txt").unlink()
        write_asset_marker(
            self.repository,
            "asset.runtime",
            consumer_refs=["src/consumer-a.txt"],
        )
        write_behavior(
            self.repository,
            "behavior.runtime",
            "运行时保持可用。",
            code_refs=["src/runtime.txt"],
            asset_refs=["asset.runtime"],
        )
        result = self.commit_current("drop one implementation and consumer")

        completed = subprocess.run(
            [
                "uv",
                "run",
                str(VERIFIER),
                "--root",
                str(self.repository),
                "--continuity-merge-base",
                predecessor,
                "--continuity-predecessor",
                predecessor,
                "--continuity-result",
                result,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        report = json.loads(completed.stdout)
        statuses = {item["obligation"]: item["status"] for item in report["results"]}
        self.assertEqual(statuses["behavior.runtime"], "conflicted")
        self.assertEqual(statuses["asset.runtime"], "conflicted")

    def test_merge_result_cannot_restore_old_implementation_blob(self) -> None:
        git(self.repository, "switch", "-qc", "target", self.base)
        (self.repository / "src/runtime.txt").write_text(
            "runtime timeout v2\n", encoding="utf-8"
        )
        target = self.commit_current("update timeout implementation")
        git(self.repository, "switch", "-qc", "source", self.base)
        write_asset_marker(self.repository, "asset.source-marker")
        source = self.commit_current("source marker")
        self.merge("target", "source", ours=True)
        (self.repository / "src/runtime.txt").write_text("runtime\n", encoding="utf-8")
        result = self.commit_current("accidentally restore old implementation")

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        report = json.loads(completed.stdout)
        behavior = next(
            item
            for item in report["results"]
            if item["obligation"] == "behavior.runtime"
        )
        self.assertEqual(behavior["status"], "conflicted")

    def test_merge_result_cannot_drop_executable_mode(self) -> None:
        git(self.repository, "switch", "-qc", "target", self.base)
        runtime_path = self.repository / "src/runtime.txt"
        runtime_path.chmod(0o755)
        target = self.commit_current("make runtime executable")
        git(self.repository, "switch", "-qc", "source", self.base)
        write_asset_marker(self.repository, "asset.source-marker")
        source = self.commit_current("source marker")
        self.merge("target", "source", ours=True)
        runtime_path.chmod(0o644)
        result = self.commit_current("accidentally drop executable mode")

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        report = json.loads(completed.stdout)
        behavior = next(
            item
            for item in report["results"]
            if item["obligation"] == "behavior.runtime"
        )
        self.assertEqual(behavior["status"], "conflicted")

    def test_legacy_source_digest_revision_remains_readable(self) -> None:
        completed = subprocess.run(
            [
                "uv",
                "run",
                str(VERIFIER),
                "--root",
                str(self.repository),
                "--continuity-merge-base",
                self.base,
                "--continuity-predecessor",
                self.base,
                "--continuity-result",
                self.base,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout)

    def test_large_snapshot_uses_batched_blob_reads_and_revision_cache(self) -> None:
        git(self.repository, "switch", "-qc", "large-snapshot", self.base)
        fixtures = self.repository / "fixtures"
        fixtures.mkdir()
        for index in range(300):
            (fixtures / f"file-{index:03d}.txt").write_text(
                f"fixture {index}\n", encoding="utf-8"
            )
        revision = self.commit_current("add large snapshot fixture")
        trace_path = self.repository / ".git/continuity-git-trace.log"
        environment = os.environ.copy()
        environment["GIT_TRACE"] = str(trace_path)

        completed = subprocess.run(
            [
                "uv",
                "run",
                str(VERIFIER),
                "--root",
                str(self.repository),
                "--continuity-merge-base",
                revision,
                "--continuity-predecessor",
                revision,
                "--continuity-result",
                revision,
            ],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout)
        trace = trace_path.read_text(encoding="utf-8")
        self.assertNotIn("cat-file blob", trace)
        batch_count = trace.count("cat-file --batch")
        self.assertGreater(batch_count, 0)
        self.assertLessEqual(batch_count, 3)

    def test_test_file_cannot_move_out_of_runner_role(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.timeout", "运行时必须保留超时语义。"
        )
        git(self.repository, "switch", "-qc", "source", self.base)
        test_path = self.repository / "src/test_runtime.py"
        test_path.write_text("def test_runtime(): pass\n", encoding="utf-8")
        write_equivalence(
            self.repository,
            "evidence.runtime",
            ["behavior.compaction"],
            source_ref="src/test_runtime.py",
        )
        write_behavior(
            self.repository,
            "behavior.compaction",
            "运行时必须保留压缩语义。",
            evidence_refs=["evidence.runtime"],
        )
        source = self.commit_current("add discoverable test evidence")
        self.merge("target", "source", ours=True)
        git(
            self.repository,
            "restore",
            "--source",
            source,
            "--",
            ".echo-semantic/behaviors/behavior.compaction.md",
            ".echo-semantic/evidence/evidence.runtime.md",
            "src/test_runtime.py",
        )
        (self.repository / "src/test_runtime.py").rename(
            self.repository / "src/runtime.py"
        )
        write_equivalence(
            self.repository,
            "evidence.runtime",
            ["behavior.compaction"],
            source_ref="src/runtime.py",
        )
        result = self.commit_current("move test outside runner naming")

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        report = json.loads(completed.stdout)
        evidence = next(
            item
            for item in report["results"]
            if item["obligation"] == "evidence.runtime"
        )
        self.assertEqual(evidence["status"], "conflicted")

    def test_test_consumer_asset_cannot_override_actual_path_role(self) -> None:
        git(self.repository, "switch", "-qc", "asset-role", self.base)
        (self.repository / "tests").mkdir()
        (self.repository / "tests/check.txt").write_text(
            "asset check\n", encoding="utf-8"
        )
        write_asset_marker(
            self.repository,
            "asset.test-consumer",
            asset_type="test_consumer",
            code_refs=["tests/check.txt"],
        )
        write_behavior(
            self.repository,
            "behavior.runtime",
            "运行时保持可用。",
            asset_refs=["asset.test-consumer"],
        )
        predecessor = self.commit_current("add test consumer asset")

        (self.repository / "docs").mkdir()
        (self.repository / "tests/check.txt").rename(self.repository / "docs/check.txt")
        write_asset_marker(
            self.repository,
            "asset.test-consumer",
            asset_type="test_consumer",
            code_refs=["docs/check.txt"],
        )
        result = self.commit_current("move test consumer into docs")

        completed = subprocess.run(
            [
                "uv",
                "run",
                str(VERIFIER),
                "--root",
                str(self.repository),
                "--continuity-merge-base",
                predecessor,
                "--continuity-predecessor",
                predecessor,
                "--continuity-result",
                result,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        report = json.loads(completed.stdout)
        asset = next(
            item
            for item in report["results"]
            if item["obligation"] == "asset.test-consumer"
        )
        self.assertEqual(asset["status"], "conflicted")

    def test_missing_unresolved_frontier_is_blocked(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.timeout", "运行时必须保留超时语义。"
        )
        git(self.repository, "switch", "-qc", "source", self.base)
        write_semantic_document(
            self.repository,
            "discovery",
            "discovery.dynamic",
            {
                "schema_version": 1,
                "id": "discovery.dynamic",
                "kind": "discovery",
                "source_snapshot": {
                    "base_revision": self.base,
                    "content_digest": source_digest(self.repository),
                },
                "scope": "runtime",
                "inspected_paths": ["src/runtime.txt"],
                "candidate_refs": [],
                "unresolved": ["dynamic-runtime-handler"],
            },
        )
        source = self.commit_current("dynamic unknown")
        result = self.merge("target", "source", ours=True)

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("#unresolved:dynamic-runtime-handler", completed.stdout)

    def test_open_finding_cannot_disappear_with_parent_branch(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.timeout", "运行时必须保留超时语义。"
        )
        git(self.repository, "switch", "-qc", "source", self.base)
        write_semantic_document(
            self.repository,
            "findings",
            "finding.runtime-risk",
            {
                "schema_version": 1,
                "id": "finding.runtime-risk",
                "kind": "finding",
                "type": "evidence_gap",
                "status": "open",
                "severity": "high",
                "primary_focus": "time_lifecycle",
                "focus": ["contract_evidence"],
                "boundary_ref": "boundary.runtime",
                "behavior_refs": ["behavior.runtime"],
                "rule_refs": [],
                "evidence_refs": [],
                "audit_refs": [],
                "decision_refs": [],
                "repair_evidence_refs": [],
                "verification_evidence_refs": [],
                "rereview_audit_refs": [],
                "discovered_at": f"source:{source_digest(self.repository)}",
            },
        )
        source = self.commit_current("open runtime finding")
        result = self.merge("target", "source", ours=True)

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn('"obligation": "finding.runtime-risk"', completed.stdout)

    def test_missing_referenced_test_evidence_is_blocked(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.timeout", "运行时必须保留超时语义。"
        )
        git(self.repository, "switch", "-qc", "source", self.base)
        (self.repository / "tests").mkdir()
        (self.repository / "tests/runtime.txt").write_text(
            "runtime evidence\n", encoding="utf-8"
        )
        write_equivalence(
            self.repository,
            "evidence.runtime",
            ["behavior.compaction"],
            source_ref="tests/runtime.txt",
        )
        write_behavior(
            self.repository,
            "behavior.compaction",
            "运行时必须保留压缩语义。",
            evidence_refs=["evidence.runtime"],
        )
        source = self.commit_current("behavior and test evidence")
        self.merge("target", "source", ours=True)
        git(
            self.repository,
            "restore",
            "--source",
            source,
            "--",
            ".echo-semantic/behaviors/behavior.compaction.md",
            ".echo-semantic/evidence/evidence.runtime.md",
            "tests/runtime.txt",
        )
        (self.repository / "tests/runtime.txt").unlink()
        result = self.commit_current("drop referenced test dependency")

        completed = self.run_continuity(target, source, result)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("语义依赖未保留在候选结果", completed.stdout)
        dependency = (
            "evidence.runtime#source:"
            + hashlib.sha256(b"runtime evidence\n").hexdigest()
        )
        report = json.loads(completed.stdout)
        item = next(
            value for value in report["results"] if value["obligation"] == dependency
        )
        self.assertEqual(item["status"], "missing")

        (self.repository / "docs").mkdir()
        (self.repository / "docs/runtime.txt").write_text(
            "runtime evidence\n", encoding="utf-8"
        )
        write_equivalence(
            self.repository,
            "evidence.runtime",
            ["behavior.compaction"],
            source_ref="docs/runtime.txt",
        )
        role_changed_result = self.commit_current("move test evidence into docs")
        role_changed = self.run_continuity(target, source, role_changed_result)
        self.assertNotEqual(role_changed.returncode, 0)
        role_report = json.loads(role_changed.stdout)
        role_item = next(
            value
            for value in role_report["results"]
            if value["obligation"] == dependency
        )
        self.assertEqual(role_item["status"], "conflicted")

        (self.repository / "docs/runtime.txt").unlink()
        (self.repository / "tests/runtime.txt").write_text(
            "changed runtime evidence\n", encoding="utf-8"
        )
        write_equivalence(
            self.repository,
            "evidence.runtime",
            ["behavior.compaction"],
            source_ref="tests/runtime.txt",
        )
        changed_result = self.commit_current("rewrite referenced test dependency")
        changed = self.run_continuity(target, source, changed_result)
        self.assertNotEqual(changed.returncode, 0)
        changed_report = json.loads(changed.stdout)
        changed_item = next(
            value
            for value in changed_report["results"]
            if value["obligation"] == dependency
        )
        self.assertEqual(changed_item["status"], "missing")

    def test_behavior_cannot_hide_missing_code_behind_historical_observation(
        self,
    ) -> None:
        git(self.repository, "switch", "-qc", "historical-code", self.base)
        (self.repository / "src/runtime.txt").unlink()
        write_baseline(self.repository, self.base)
        behavior_path = self.repository / ".echo-semantic/behaviors/behavior.runtime.md"
        behavior_text = behavior_path.read_text(encoding="utf-8")
        behavior_path.write_text(
            re.sub(
                r"(?m)^observed_at: source:[0-9a-f]{64}$",
                f"observed_at: {self.base}",
                behavior_text,
            ),
            encoding="utf-8",
        )
        git(self.repository, "add", ".")
        git(
            self.repository,
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "hide missing code behind historical observation",
        )
        result = git(self.repository, "rev-parse", "HEAD")

        completed = subprocess.run(
            [
                "uv",
                "run",
                str(VERIFIER),
                "--root",
                str(self.repository),
                "--continuity-merge-base",
                self.base,
                "--continuity-predecessor",
                self.base,
                "--continuity-result",
                result,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("语义依赖未保留在候选结果", completed.stdout)

    def test_historical_continuity_evidence_does_not_collide_with_current(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.canonical", "统一运行时行为。"
        )
        source = self.commit_behavior("source", "behavior.legacy", "旧运行时行为。")
        initial_result = self.merge("target", "source", ours=True)
        initial = json.loads(self.run_continuity(target, source, initial_result).stdout)
        legacy = next(
            item
            for item in initial["results"]
            if item["obligation"] == "behavior.legacy"
        )
        legacy_before = next(
            revision
            for revision, fingerprint in legacy["predecessor_fingerprints"].items()
            if fingerprint != "absent"
        )

        def resolution(evidence_ref: str) -> dict:
            return {
                "behavior.legacy": {
                    "disposition": "replaced",
                    "predecessor_fingerprints": legacy["predecessor_fingerprints"],
                    "replacement_ref": "behavior.canonical",
                    "evidence_refs": [evidence_ref],
                    "decision_authorities": [],
                    "compatibility_impact": "调用方迁移到 canonical 行为。",
                    "rollback_ref": "revert replacement fixture",
                }
            }

        write_equivalence(
            self.repository,
            "evidence.legacy-equivalence-first",
            ["behavior.legacy", "behavior.canonical"],
            before_revision=legacy_before,
        )
        first_snapshot = f"source:{source_digest(self.repository)}"
        write_continuity_evidence(
            self.repository,
            "evidence.continuity-replacement-first",
            self.base,
            initial["predecessor_revisions"],
            first_snapshot,
            resolution("evidence.legacy-equivalence-first"),
        )
        first_result = self.commit_current("first continuity replacement")
        first = self.run_continuity(target, source, first_result)
        self.assertEqual(first.returncode, 0, first.stderr)

        (self.repository / "notes").mkdir()
        (self.repository / "notes/revision.txt").write_text(
            "second result snapshot\n", encoding="utf-8"
        )
        write_equivalence(
            self.repository,
            "evidence.legacy-equivalence-second",
            ["behavior.legacy", "behavior.canonical"],
            before_revision=legacy_before,
        )
        second_snapshot = f"source:{source_digest(self.repository)}"
        write_continuity_evidence(
            self.repository,
            "evidence.continuity-replacement-second",
            self.base,
            initial["predecessor_revisions"],
            second_snapshot,
            resolution("evidence.legacy-equivalence-second"),
        )
        second_result = self.commit_current("second continuity replacement")

        second = self.run_continuity(target, source, second_result)
        self.assertEqual(second.returncode, 0, second.stderr)
        second_report = json.loads(second.stdout)
        legacy_result = next(
            item
            for item in second_report["results"]
            if item["obligation"] == "behavior.legacy"
        )
        self.assertEqual(
            legacy_result["resolution"]["evidence_ref"],
            "evidence.continuity-replacement-second",
        )

    def test_replacement_with_bound_continuity_evidence_passes(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.canonical", "统一运行时行为。"
        )
        source = self.commit_behavior("source", "behavior.legacy", "旧运行时行为。")
        initial_result = self.merge("target", "source", ours=True)
        initial = json.loads(self.run_continuity(target, source, initial_result).stdout)
        legacy = next(
            item
            for item in initial["results"]
            if item["obligation"] == "behavior.legacy"
        )
        legacy_before = next(
            revision
            for revision, fingerprint in legacy["predecessor_fingerprints"].items()
            if fingerprint != "absent"
        )
        write_equivalence(
            self.repository,
            "evidence.legacy-equivalence",
            ["behavior.legacy", "behavior.canonical"],
            before_revision=legacy_before,
        )
        snapshot = f"source:{source_digest(self.repository)}"
        write_continuity_evidence(
            self.repository,
            "evidence.continuity-replacement",
            self.base,
            initial["predecessor_revisions"],
            snapshot,
            {
                "behavior.legacy": {
                    "disposition": "replaced",
                    "predecessor_fingerprints": legacy["predecessor_fingerprints"],
                    "replacement_ref": "behavior.canonical",
                    "evidence_refs": ["evidence.legacy-equivalence"],
                    "decision_authorities": [],
                    "compatibility_impact": "调用方迁移到 canonical 行为。",
                    "rollback_ref": "revert replacement fixture",
                }
            },
        )
        result = self.commit_current("continuity replacement")

        completed = self.run_continuity(target, source, result)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        item = next(
            value
            for value in report["results"]
            if value["obligation"] == "behavior.legacy"
        )
        self.assertEqual(item["status"], "replaced")
        self.assertEqual(
            item["resolution"]["evidence_refs"],
            ["evidence.legacy-equivalence"],
        )
        self.assertEqual(item["resolution"]["replacement_ref"], "behavior.canonical")

        write_equivalence(
            self.repository,
            "evidence.legacy-equivalence",
            ["behavior.canonical"],
            before_revision=legacy_before,
        )
        invalid_result = self.commit_current("break replacement evidence")
        invalid = self.run_continuity(target, source, invalid_result)
        self.assertNotEqual(invalid.returncode, 0)
        self.assertIn("未覆盖原义务与替代义务", invalid.stdout)

        for status in ("failed", "unknown"):
            write_equivalence(
                self.repository,
                "evidence.legacy-equivalence",
                ["behavior.legacy", "behavior.canonical"],
                before_revision=legacy_before,
                scenario_status=status,
            )
            invalid_result = self.commit_current(f"{status} equivalence scenario")
            invalid = self.run_continuity(target, source, invalid_result)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIn("等价 Evidence 存在未匹配场景", invalid.stdout)

    def test_replacement_rejects_noncanonical_obligation_kinds(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.canonical", "统一运行时行为。"
        )
        source = self.commit_behavior("source", "behavior.legacy", "旧运行时行为。")
        initial_result = self.merge("target", "source", ours=True)
        initial = json.loads(self.run_continuity(target, source, initial_result).stdout)
        legacy = next(
            item
            for item in initial["results"]
            if item["obligation"] == "behavior.legacy"
        )
        legacy_before = next(
            revision
            for revision, fingerprint in legacy["predecessor_fingerprints"].items()
            if fingerprint != "absent"
        )
        write_equivalence(
            self.repository,
            "evidence.illegal-target",
            ["behavior.legacy", "evidence.illegal-target"],
            before_revision=legacy_before,
        )
        write_behavior(
            self.repository,
            "behavior.canonical",
            "统一运行时行为。",
            evidence_refs=["evidence.illegal-target"],
        )
        write_semantic_document(
            self.repository,
            "findings",
            "finding.illegal-target",
            {
                "schema_version": 1,
                "id": "finding.illegal-target",
                "kind": "finding",
                "type": "evidence_gap",
                "status": "open",
                "severity": "high",
                "primary_focus": "contract_evidence",
                "focus": ["contract_evidence"],
                "boundary_ref": "boundary.runtime",
                "behavior_refs": [],
                "rule_refs": [],
                "evidence_refs": [],
                "audit_refs": [],
                "decision_refs": [],
                "repair_evidence_refs": [],
                "verification_evidence_refs": [],
                "rereview_audit_refs": [],
                "discovered_at": f"source:{source_digest(self.repository)}",
            },
        )
        write_semantic_document(
            self.repository,
            "discovery",
            "discovery.illegal-target",
            {
                "schema_version": 1,
                "id": "discovery.illegal-target",
                "kind": "discovery",
                "source_snapshot": {
                    "base_revision": self.base,
                    "content_digest": source_digest(self.repository),
                },
                "scope": "runtime",
                "inspected_paths": ["src/runtime.txt"],
                "candidate_refs": [],
                "unresolved": ["illegal-target"],
            },
        )
        replacements = (
            ("evidence.illegal-target", "evidence.illegal-target"),
            ("finding.illegal-target", "evidence.finding-illegal"),
            (
                "discovery.illegal-target#unresolved:illegal-target",
                "evidence.discovery-illegal",
            ),
        )
        for index, (replacement, evidence_ref) in enumerate(replacements, start=1):
            if evidence_ref != "evidence.illegal-target":
                write_equivalence(
                    self.repository,
                    evidence_ref,
                    ["behavior.legacy", replacement],
                    before_revision=legacy_before,
                )
            snapshot = f"source:{source_digest(self.repository)}"
            write_continuity_evidence(
                self.repository,
                "evidence.continuity-invalid-kind",
                self.base,
                initial["predecessor_revisions"],
                snapshot,
                {
                    "behavior.legacy": {
                        "disposition": "replaced",
                        "predecessor_fingerprints": legacy["predecessor_fingerprints"],
                        "replacement_ref": replacement,
                        "evidence_refs": [evidence_ref],
                        "decision_authorities": [],
                        "compatibility_impact": "非法替代目标测试。",
                        "rollback_ref": "revert invalid replacement fixture",
                    }
                },
            )
            result = self.commit_current(f"invalid replacement kind {index}")
            completed = self.run_continuity(target, source, result)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("replacement_ref 类型无效", completed.stdout)

    def test_retirement_requires_bound_human_decision(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.canonical", "统一运行时行为。"
        )
        source = self.commit_behavior("source", "behavior.legacy", "旧运行时行为。")
        initial_result = self.merge("target", "source", ours=True)
        initial = json.loads(self.run_continuity(target, source, initial_result).stdout)
        legacy = next(
            item
            for item in initial["results"]
            if item["obligation"] == "behavior.legacy"
        )
        decision_path = self.repository / "docs/adr/retire-legacy.md"
        decision_path.parent.mkdir(parents=True)
        predecessor_text = "\n".join(initial["predecessor_revisions"])
        decision_path.write_text(
            "# 退役决策\n\n## 状态\n已批准\n\n## 背景\n"
            "behavior.legacy 已无产品入口。\n\n## 候选方案\n保留或退役。\n\n"
            "## 决策\n退役 behavior.legacy，理由是旧入口已经关闭。\n\n"
            f"前置 revisions：\n{predecessor_text}\n\n"
            "## 影响\n兼容影响由 canonical 行为承接；回滚策略为 revert fixture。\n",
            encoding="utf-8",
        )
        decision_digest = hashlib.sha256(decision_path.read_bytes()).hexdigest()
        snapshot = f"source:{source_digest(self.repository)}"
        resolution = {
            "behavior.legacy": {
                "disposition": "retired",
                "predecessor_fingerprints": legacy["predecessor_fingerprints"],
                "evidence_refs": [],
                "decision_authorities": [
                    {
                        "kind": "adr",
                        "path": "docs/adr/retire-legacy.md",
                        "content_digest": decision_digest,
                    }
                ],
                "compatibility_impact": "旧入口不再提供。",
                "rollback_ref": "revert retirement fixture",
            }
        }
        write_continuity_evidence(
            self.repository,
            "evidence.continuity-retirement",
            self.base,
            initial["predecessor_revisions"],
            snapshot,
            resolution,
        )
        result = self.commit_current("continuity retirement")

        completed = self.run_continuity(target, source, result)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        retired = next(
            item
            for item in report["results"]
            if item["obligation"] == "behavior.legacy"
        )
        self.assertEqual(retired["status"], "retired")
        self.assertEqual(
            retired["resolution"]["decision_authorities"][0]["path"],
            "docs/adr/retire-legacy.md",
        )

        decision_path.write_text(
            decision_path.read_text(encoding="utf-8") + "\n未同步的变更。\n",
            encoding="utf-8",
        )
        changed_snapshot = f"source:{source_digest(self.repository)}"
        write_continuity_evidence(
            self.repository,
            "evidence.continuity-retirement",
            self.base,
            initial["predecessor_revisions"],
            changed_snapshot,
            resolution,
        )
        invalid_result = self.commit_current("stale retirement authority")
        invalid = self.run_continuity(target, source, invalid_result)
        self.assertNotEqual(invalid.returncode, 0)
        self.assertIn("摘要不匹配", invalid.stdout)

        decision_path.write_text("behavior.legacy\n", encoding="utf-8")
        resolution["behavior.legacy"]["decision_authorities"][0]["content_digest"] = (
            hashlib.sha256(decision_path.read_bytes()).hexdigest()
        )
        fake_snapshot = f"source:{source_digest(self.repository)}"
        write_continuity_evidence(
            self.repository,
            "evidence.continuity-retirement",
            self.base,
            initial["predecessor_revisions"],
            fake_snapshot,
            resolution,
        )
        fake_result = self.commit_current("fake retirement authority")
        fake = self.run_continuity(target, source, fake_result)
        self.assertNotEqual(fake.returncode, 0)
        self.assertIn("缺少正式 design/ADR 章节", fake.stdout)
        self.assertIn("缺少明确批准状态", fake.stdout)

        decision_path.write_text(
            "# 退役决策\n\n## 状态\n拒绝\n\n## 背景\n"
            "曾讨论已批准的其它方案，但 behavior.legacy 不在其中。\n\n"
            "## 候选方案\n保留或退役。\n\n"
            "## 决策\n不批准 behavior.legacy 退役，理由是仍需产品确认。\n\n"
            f"前置 revisions：\n{predecessor_text}\n\n"
            "## 影响\n兼容影响尚未接受；回滚策略为 revert fixture。\n",
            encoding="utf-8",
        )
        resolution["behavior.legacy"]["decision_authorities"][0]["content_digest"] = (
            hashlib.sha256(decision_path.read_bytes()).hexdigest()
        )
        rejected_snapshot = f"source:{source_digest(self.repository)}"
        write_continuity_evidence(
            self.repository,
            "evidence.continuity-retirement",
            self.base,
            initial["predecessor_revisions"],
            rejected_snapshot,
            resolution,
        )
        rejected_result = self.commit_current("rejected retirement authority")
        rejected = self.run_continuity(target, source, rejected_result)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("批准状态被明确否定", rejected.stdout)

        for index, status in enumerate(
            (
                "已批准后撤销",
                "approved then withdrawn",
                "已批准，等待最终确认",
                "已批准但取消实施",
            ),
            start=1,
        ):
            decision_path.write_text(
                f"# 退役决策\n\n## 状态\n{status}\n\n## 背景\n"
                "behavior.legacy 已无产品入口。\n\n## 候选方案\n保留或退役。\n\n"
                "## 决策\n退役 behavior.legacy，理由是旧入口已经关闭。\n\n"
                f"前置 revisions：\n{predecessor_text}\n\n"
                "## 影响\n兼容影响由 canonical 行为承接；回滚策略为 revert fixture。\n",
                encoding="utf-8",
            )
            resolution["behavior.legacy"]["decision_authorities"][0][
                "content_digest"
            ] = hashlib.sha256(decision_path.read_bytes()).hexdigest()
            ambiguous_snapshot = f"source:{source_digest(self.repository)}"
            write_continuity_evidence(
                self.repository,
                "evidence.continuity-retirement",
                self.base,
                initial["predecessor_revisions"],
                ambiguous_snapshot,
                resolution,
            )
            ambiguous_result = self.commit_current(
                f"ambiguous retirement authority {index}"
            )
            ambiguous = self.run_continuity(target, source, ambiguous_result)
            self.assertNotEqual(ambiguous.returncode, 0)
            self.assertIn("状态章节必须只包含一个明确允许值", ambiguous.stdout)

    def test_unrecoverable_revision_and_partial_cli_fail_closed(self) -> None:
        missing = subprocess.run(
            [
                "uv",
                "run",
                str(VERIFIER),
                "--root",
                str(self.repository),
                "--continuity-merge-base",
                self.base,
                "--continuity-predecessor",
                "f" * 40,
                "--continuity-result",
                self.base,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(missing.returncode, 0)
        self.assertTrue(json.loads(missing.stdout)["errors"])

        partial = subprocess.run(
            [
                "uv",
                "run",
                str(VERIFIER),
                "--root",
                str(self.repository),
                "--continuity-result",
                self.base,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(partial.returncode, 0)
        self.assertIn("必须同时提供", partial.stderr)

    def test_report_is_deterministic_and_can_be_written(self) -> None:
        target = self.commit_behavior(
            "target", "behavior.timeout", "运行时必须保留超时语义。"
        )
        source = self.commit_behavior(
            "source", "behavior.compaction", "运行时必须保留压缩语义。"
        )
        result = self.merge("target", "source")
        report_path = self.repository / "continuity-report.json"
        command = [
            "uv",
            "run",
            str(VERIFIER),
            "--root",
            str(self.repository),
            "--continuity-merge-base",
            self.base,
            "--continuity-predecessor",
            source,
            "--continuity-predecessor",
            target,
            "--continuity-result",
            result,
            "--continuity-report",
            str(report_path),
        ]
        first = subprocess.run(command, check=False, capture_output=True, text=True)
        second = subprocess.run(command, check=False, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(first.stdout, second.stdout)
        self.assertEqual(first.stdout, report_path.read_text(encoding="utf-8"))


class HistoricalStorageMigrationTests(unittest.TestCase):
    setUp = ContinuityTests.setUp
    tearDown = ContinuityTests.tearDown
    commit_current = ContinuityTests.commit_current

    def verifier(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location("storage_verifier", VERIFIER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def fixture(
        self,
        path="docs/archive.log",
        *,
        declared=False,
        anchor=None,
        extra_reference=False,
    ):
        root = self.repository
        original = root / path
        original.parent.mkdir(parents=True, exist_ok=True)
        original.write_text("original_anchor\nimmutable receipt\n")
        if extra_reference:
            (root / "docs/second.log").write_bytes(original.read_bytes())
        historical = self.commit_current("原历史原件")
        original.unlink()
        if extra_reference:
            (root / "docs/second.log").unlink()
        evidence = {
            "schema_version": 1,
            "id": "evidence.original",
            "kind": "evidence",
            "observed_at": historical,
            "source_refs": [path + ("#" + anchor if anchor else "")],
            "supports": ["behavior.runtime"],
            "limitations": ["原有限范围保持"],
        }
        if extra_reference:
            evidence["source_refs"].append("docs/second.log")
        if declared:
            evidence["asset_type"] = "test_consumer"
        write_semantic_document(root, "evidence", "evidence.original", evidence)
        write_behavior(
            root,
            "behavior.runtime",
            "运行时保持可用。",
            evidence_refs=["evidence.original"],
        )
        parent = self.commit_current("历史证据不在当前树")
        module = self.verifier()
        snapshot = module.continuity_snapshot(root, parent)
        issue = snapshot["current_reference_issues"][0]
        dependency = issue["source_dependency"]
        self.assertIn(dependency, snapshot["obligations"])
        index = root / "docs/index.md"
        index.parent.mkdir(parents=True, exist_ok=True)
        index.write_text("历史原件 " + historical + ":" + path + "\n")
        adr = root / "docs/adr/0001-storage.md"
        adr.parent.mkdir(parents=True, exist_ok=True)
        ids = ["evidence.original", dependency]
        adr.write_text(
            "# 存储迁移\n\n## 状态\n\n已批准\n\n## 背景\n\n原历史副本迁移。\n\n"
            "## 候选方案\n\n保留原件或精确索引。\n\n## 决策\n\n"
            + "\n".join(ids + [issue["issue_id"], parent])
            + "\n理由：只改变存储。\n\n## 影响\n\n兼容：原义务不变。回滚：恢复原路径。\n"
        )
        write_asset_marker(root, "asset.locator", code_refs=["docs/index.md"])
        evidence["asset_refs"] = ["asset.locator"]
        digest = source_digest(root)
        evidence.update(observed_at="source:" + digest, source_refs=["docs/index.md"])
        write_semantic_document(root, "evidence", "evidence.original", evidence)
        write_equivalence(
            root,
            "evidence.storage-equivalence",
            ids + ["asset.locator"],
            before_revision=parent,
            source_ref="docs/index.md",
        )
        migration = {
            key: issue[key]
            for key in [
                "issue_id",
                "snapshot_revision",
                "owner",
                "owner_fingerprint",
                "raw_reference",
                "observed_revision",
                "historical_content_sha256",
                "historical_git_mode",
                "source_role",
            ]
        }
        migration.update(
            replacement_ref="asset.locator",
            equivalence_evidence_ref="evidence.storage-equivalence",
            scenario="runtime",
        )
        resolutions = {}
        for identifier in ids:
            resolutions[identifier] = {
                "disposition": "resolved_conflict"
                if identifier == "evidence.original"
                else "replaced",
                "predecessor_fingerprints": {
                    parent: snapshot["obligations"][identifier]["fingerprint"]
                },
                "replacement_ref": "asset.locator",
                "evidence_refs": ["evidence.storage-equivalence"],
                "decision_authorities": [
                    {
                        "kind": "adr",
                        "path": "docs/adr/0001-storage.md",
                        "content_digest": hashlib.sha256(adr.read_bytes()).hexdigest(),
                    }
                ],
                "compatibility_impact": "原行为及失败范围保留，只迁移文稿存储。",
                "rollback_ref": historical,
            }
        resolutions[dependency]["historical_reference_migrations"] = [migration]
        write_continuity_evidence(
            root,
            "evidence.storage-continuity",
            parent,
            [parent],
            "source:" + digest,
            resolutions,
        )
        result = self.commit_current("精确历史存储迁移")
        return module, parent, result, resolutions, dependency, issue

    def compare(self, module, parent, result):
        return module.compare_continuity(self.repository, parent, [parent], result)

    def rewrite(self, module, parent, resolutions):
        write_continuity_evidence(
            self.repository,
            "evidence.storage-continuity",
            parent,
            [parent],
            "source:" + source_digest(self.repository),
            resolutions,
        )
        return self.commit_current("单变量迁移反例")

    def test_exact_documentation_migration_preserves_diagnostics_and_passes(self):
        module, parent, result, _, _, issue = self.fixture()
        report = self.compare(module, parent, result)
        self.assertTrue(report["passed"], report)
        self.assertEqual(report["errors"], [])
        self.assertTrue(report["snapshot_diagnostics"])
        resolved = report["resolved_historical_reference_migrations"]
        self.assertEqual(
            {row["issue"]["issue_id"] for row in resolved}, {issue["issue_id"]}
        )
        self.assertEqual(
            {role for row in resolved for role in row["snapshot_roles"]},
            {"merge_base", "predecessor"},
        )
        self.assertTrue(
            all(row["status"] in {"preserved", "replaced"} for row in report["results"])
        )

    def test_each_identity_or_resolution_failure_remains_blocked(self):
        import copy

        module, parent, _, valid, dep, _ = self.fixture()
        changes = {
            "missing_mapping": lambda r: r[dep].pop("historical_reference_migrations"),
            "wrong_owner": lambda r: r[dep]["historical_reference_migrations"][
                0
            ].update(owner="evidence.other"),
            "wrong_parent_fp": lambda r: r[dep]["predecessor_fingerprints"].update(
                {parent: "f" * 64}
            ),
            "wrong_issue_id": lambda r: r[dep]["historical_reference_migrations"][
                0
            ].update(issue_id="f" * 64),
            "wrong_blob": lambda r: r[dep]["historical_reference_migrations"][0].update(
                historical_content_sha256="f" * 64
            ),
            "wrong_mode": lambda r: r[dep]["historical_reference_migrations"][0].update(
                historical_git_mode="100755"
            ),
            "wrong_role": lambda r: r[dep]["historical_reference_migrations"][0].update(
                source_role="test_consumer"
            ),
            "wrong_revision": lambda r: r[dep]["historical_reference_migrations"][
                0
            ].update(observed_revision="f" * 40),
            "missing_adr": lambda r: r[dep].update(decision_authorities=[]),
            "wrong_adr_sha": lambda r: r[dep]["decision_authorities"][0].update(
                content_digest="f" * 64
            ),
            "duplicate_mapping": lambda r: r[dep][
                "historical_reference_migrations"
            ].append(copy.deepcopy(r[dep]["historical_reference_migrations"][0])),
            "unknown_typo": lambda r: r[dep]["historical_reference_migrations"][
                0
            ].update(source_rol="documentation"),
            "self_replacement": lambda r: r[dep].update(replacement_ref=dep),
            "wrong_replacement_kind": lambda r: r[dep].update(
                replacement_ref="evidence.original"
            ),
            "wrong_scenario": lambda r: r[dep]["historical_reference_migrations"][
                0
            ].update(scenario="not-matched"),
        }
        for name, change in changes.items():
            with self.subTest(name=name):
                altered = copy.deepcopy(valid)
                change(altered)
                result = self.rewrite(module, parent, altered)
                self.assertFalse(self.compare(module, parent, result)["passed"], name)

    def test_test_consumer_cannot_get_documentation_exception(self):
        module, parent, result, _, _, _ = self.fixture("docs/tests/archive.xml")
        self.assertFalse(self.compare(module, parent, result)["passed"])

    def test_declared_consumer_cannot_get_documentation_exception(self):
        module, parent, result, _, _, _ = self.fixture(declared=True)
        self.assertFalse(self.compare(module, parent, result)["passed"])

    def test_result_current_missing_is_always_fatal(self):
        module, parent, _, _, _, _ = self.fixture()
        (self.repository / "docs/index.md").unlink()
        result = self.commit_current("结果当前依赖丢失")
        report = self.compare(module, parent, result)
        self.assertFalse(report["passed"])
        self.assertTrue(report["errors"])

    def test_nonexistent_historical_anchor_is_fatal_not_migratable(self):
        module, parent, _, _, _, _ = self.fixture()
        data = json.loads(
            (self.repository / ".echo-semantic/evidence/evidence.original.md")
            .read_text()[4:]
            .split("\n---\n", 1)[0]
        )
        data.update(observed_at=parent, source_refs=["src/runtime.txt#never_existed"])
        write_semantic_document(self.repository, "evidence", "evidence.original", data)
        revision = self.commit_current("原锚本不存在")
        snapshot = module.continuity_snapshot(self.repository, revision)
        self.assertTrue(any("源码引用锚点不存在" in e for e in snapshot["errors"]))
        self.assertFalse(
            any(
                issue["raw_reference"].endswith("never_existed")
                for issue in snapshot["current_reference_issues"]
            )
        )

    def test_same_blob_two_references_require_two_specific_mappings(self):
        module, parent, result, _, _, _ = self.fixture(extra_reference=True)
        snapshot = module.continuity_snapshot(self.repository, parent)
        self.assertEqual(len(snapshot["current_reference_issues"]), 2)
        self.assertEqual(
            len({i["issue_id"] for i in snapshot["current_reference_issues"]}), 2
        )
        self.assertEqual(
            len({i["source_dependency"] for i in snapshot["current_reference_issues"]}),
            1,
        )
        report = self.compare(module, parent, result)
        self.assertFalse(report["passed"])
        self.assertEqual(len(report["resolved_historical_reference_migrations"]), 1)
        self.assertTrue(any("second.log" in e for e in report["errors"]))

    def refresh_migration_materials(
        self, parent, resolutions, *, extra_equivalence=None
    ):
        root = self.repository
        digest = source_digest(root)
        path = root / ".echo-semantic/evidence/evidence.storage-equivalence.md"
        eq = json.loads(path.read_text()[4:].split("\n---\n", 1)[0])
        eq.update(observed_at="source:" + digest, after_revision="source:" + digest)
        write_semantic_document(root, "evidence", eq["id"], eq)
        if extra_equivalence is not None:
            extra = dict(eq)
            extra.update(
                id="evidence.second-equivalence", before_revision=extra_equivalence
            )
            write_semantic_document(root, "evidence", extra["id"], extra)
        adr = root / "docs/adr/0001-storage.md"
        for resolution in resolutions.values():
            resolution["decision_authorities"][0]["content_digest"] = hashlib.sha256(
                adr.read_bytes()
            ).hexdigest()
        write_continuity_evidence(
            root,
            "evidence.storage-continuity",
            parent,
            sorted(next(iter(resolutions.values()))["predecessor_fingerprints"]),
            "source:" + digest,
            resolutions,
        )
        return self.commit_current("完整精确迁移材料")

    def test_same_blob_two_exact_reference_mappings_can_both_pass(self):
        import copy

        module, parent, _, resolutions, dependency, _ = self.fixture(
            extra_reference=True
        )
        issues = module.continuity_snapshot(self.repository, parent)[
            "current_reference_issues"
        ]
        mapping = copy.deepcopy(
            resolutions[dependency]["historical_reference_migrations"][0]
        )
        second = next(i for i in issues if i["issue_id"] != mapping["issue_id"])
        for key in mapping:
            if key in second:
                mapping[key] = second[key]
        resolutions[dependency]["historical_reference_migrations"].append(mapping)
        adr = self.repository / "docs/adr/0001-storage.md"
        adr.write_text(adr.read_text() + "\n" + second["issue_id"] + "\n")
        result = self.refresh_migration_materials(parent, resolutions)
        report = self.compare(module, parent, result)
        self.assertTrue(report["passed"], report)
        self.assertEqual(len(report["resolved_historical_reference_migrations"]), 2)

    def test_strong_consumer_requires_actual_same_role_not_approved_doc_locator(self):
        import copy

        module, parent, _, valid, dependency, _issue = self.fixture("tests/archive.py")
        root = self.repository
        locator = root / "tests/current_test.py"
        locator.write_text("current_test_anchor\n")
        # 当前canonical真实test consumer由asset的实际引用承接，不以declared标记代role。
        assetpath = root / ".echo-semantic/assets/asset.locator.md"
        asset = json.loads(assetpath.read_text()[4:].split("\n---\n", 1)[0])
        asset["code_refs"] = ["tests/current_test.py#current_test_anchor"]
        write_semantic_document(root, "assets", asset["id"], asset)
        eqpath = root / ".echo-semantic/evidence/evidence.storage-equivalence.md"
        eq = json.loads(eqpath.read_text()[4:].split("\n---\n", 1)[0])
        eq["scenario_results"]["runtime"]["source_refs"] = [
            "tests/current_test.py#current_test_anchor"
        ]
        write_semantic_document(root, "evidence", eq["id"], eq)
        mapping = valid[dependency].pop("historical_reference_migrations")[0]
        mapping.update(
            replacement_source_ref="tests/current_test.py#current_test_anchor",
            replacement_content_sha256=hashlib.sha256(locator.read_bytes()).hexdigest(),
            replacement_git_mode="100644",
        )
        valid[dependency]["current_reference_replacements"] = [mapping]
        adr = root / "docs/adr/0001-storage.md"
        adr.write_text(
            adr.read_text() + "\ntests/current_test.py#current_test_anchor\n"
        )
        result = self.refresh_migration_materials(parent, valid)
        report = self.compare(module, parent, result)
        self.assertTrue(report["passed"], report)
        changed = copy.deepcopy(valid)
        changed[dependency]["current_reference_replacements"][0].update(
            replacement_source_ref="docs/index.md",
            replacement_content_sha256=hashlib.sha256(
                (root / "docs/index.md").read_bytes()
            ).hexdigest(),
        )
        asset["code_refs"] = ["docs/index.md"]
        write_semantic_document(root, "assets", asset["id"], asset)
        eq["scenario_results"]["runtime"]["source_refs"] = ["docs/index.md"]
        write_semantic_document(root, "evidence", eq["id"], eq)
        adr.write_text(adr.read_text() + "\ndocs/index.md\n")
        result = self.refresh_migration_materials(parent, changed)
        report = self.compare(module, parent, result)
        self.assertFalse(report["passed"])
        self.assertTrue(any("角色" in e for e in report["errors"]))

    def test_collision_retains_aggregate_and_every_qualified_variant(self):
        module, _, _, _, _, _ = self.fixture()
        root = self.repository
        paths = ["src/same.txt#one", "docs/same.txt#two"]
        for raw in paths:
            path = root / raw.split("#")[0]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("one two\n")
        observed = self.commit_current("同SHA两真实role和anchor")
        data = {
            "schema_version": 1,
            "id": "evidence.same",
            "kind": "evidence",
            "observed_at": observed,
            "source_refs": paths,
            "supports": [],
            "limitations": [],
        }
        write_semantic_document(root, "evidence", data["id"], data)
        write_behavior(
            root,
            "behavior.same",
            "两个真实consumer均需保全",
            evidence_refs=[data["id"]],
        )
        revision = self.commit_current("歧义不得择一")
        snapshot = module.continuity_snapshot(root, revision)
        group = snapshot["source_dependency_collisions"][0]
        self.assertEqual(len(group["variants"]), 2)
        self.assertIn(group["dependency_id"], snapshot["obligations"])
        for variant in group["variants"]:
            self.assertIn(variant["obligation"], snapshot["obligations"])
            self.assertEqual(
                snapshot["obligations"][variant["obligation"]]["fingerprint"],
                variant["fingerprint"],
            )
        report = module.compare_continuity(root, revision, [revision], revision)
        self.assertFalse(report["passed"])
        self.assertTrue(report["errors"])

    def collision_fixture(self, extra_reference=False):
        module, _, _, _, _, _ = self.fixture()
        root = self.repository
        original_refs = ["src/same.txt#one", "docs/same.txt#two"]
        if extra_reference:
            original_refs.append("src/another.txt#one")
        for raw in original_refs:
            path = root / raw.split("#")[0]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("one two\n")
        observed = self.commit_current("碰撞原全部consumer")
        data = {
            "schema_version": 1,
            "id": "evidence.same",
            "kind": "evidence",
            "observed_at": observed,
            "source_refs": original_refs,
            "supports": [],
            "limitations": [],
        }
        write_semantic_document(root, "evidence", data["id"], data)
        write_behavior(
            root,
            "behavior.same",
            "两个真实consumer均需保全",
            evidence_refs=[data["id"]],
        )
        parent = self.commit_current("真实碰撞父")
        snapshot = module.continuity_snapshot(root, parent)
        group = next(
            g
            for g in snapshot["source_dependency_collisions"]
            if g["owner"] == "evidence.same"
        )
        ids = [group["dependency_id"], *[v["obligation"] for v in group["variants"]]]
        for raw in original_refs:
            (root / raw.split("#")[0]).unlink()
        replacement_refs = {
            "production_source": "src/new.txt#new_anchor",
            "documentation": "docs/new.md#new_anchor",
        }
        for raw in replacement_refs.values():
            (root / raw.split("#")[0]).write_text(
                "new_anchor same behavior " + raw + "\n"
            )
        write_asset_marker(
            root, "asset.collision", code_refs=list(replacement_refs.values())
        )
        data.update(
            observed_at="source:" + source_digest(root),
            source_refs=list(replacement_refs.values()),
            asset_refs=["asset.collision"],
        )
        write_semantic_document(root, "evidence", data["id"], data)
        # 原fixture控制材料不参与本次新的parent组。
        adr = root / "docs/adr/0002-collision.md"
        adr.write_text(
            "# 碰撞迁移\n\n## 状态\n\n已批准\n\n## 背景\n\n完整保全。\n\n## 候选方案\n\n不能择一。\n\n## 决策\n\n"
            + "\n".join(
                [
                    group["collision_id"],
                    group["owner"],
                    parent,
                    *ids,
                    *replacement_refs.values(),
                ]
            )
            + "\n理由：全部consumer等价承接。\n\n## 影响\n\n兼容：原语义保留。回滚：恢复原refs。\n"
        )
        write_equivalence(
            root,
            "evidence.collision-equivalence",
            ids + ["asset.collision", "evidence.same"],
            before_revision=parent,
            source_ref="src/new.txt#new_anchor",
        )
        eqpath = root / ".echo-semantic/evidence/evidence.collision-equivalence.md"
        eq = json.loads(eqpath.read_text()[4:].split("\n---\n", 1)[0])
        eq["scenario_results"]["runtime"]["source_refs"] = list(
            replacement_refs.values()
        )
        write_semantic_document(root, "evidence", eq["id"], eq)
        digest = source_digest(root)
        resolutions = {}
        for identifier in ["evidence.same", *ids]:
            resolutions[identifier] = {
                "disposition": "resolved_conflict"
                if identifier in {"evidence.same", group["dependency_id"]}
                else "replaced",
                "predecessor_fingerprints": {
                    parent: snapshot["obligations"][identifier]["fingerprint"]
                },
                "replacement_ref": "asset.collision",
                "evidence_refs": [eq["id"]],
                "decision_authorities": [
                    {
                        "kind": "adr",
                        "path": "docs/adr/0002-collision.md",
                        "content_digest": hashlib.sha256(adr.read_bytes()).hexdigest(),
                    }
                ],
                "compatibility_impact": "保全部原角色行为",
                "rollback_ref": parent,
            }
        for variant in group["variants"]:
            raw = replacement_refs[variant["source_role"]]
            mappings = []
            for ref in variant["references"]:
                mappings.append(
                    {
                        "snapshot_revision": parent,
                        "collision_id": group["collision_id"],
                        "variant_obligation": variant["obligation"],
                        "variant_fingerprint": variant["fingerprint"],
                        "raw_reference": ref["raw_reference"],
                        "source_role": variant["source_role"],
                        "replacement_ref": "asset.collision",
                        "replacement_source_ref": raw,
                        "replacement_content_sha256": hashlib.sha256(
                            (root / raw.split("#")[0]).read_bytes()
                        ).hexdigest(),
                        "replacement_git_mode": "100644",
                        "equivalence_evidence_ref": eq["id"],
                        "scenario": "runtime",
                    }
                )
            resolutions[variant["obligation"]][
                "source_dependency_variant_replacements"
            ] = mappings
        write_continuity_evidence(
            root,
            "evidence.collision-continuity",
            parent,
            [parent],
            "source:" + digest,
            resolutions,
        )
        result = self.commit_current("完整碰撞迁移")
        return module, parent, result, resolutions, group

    def rewrite_collision(self, parent, resolutions):
        write_continuity_evidence(
            self.repository,
            "evidence.collision-continuity",
            parent,
            [parent],
            "source:" + source_digest(self.repository),
            resolutions,
        )
        return self.commit_current("碰撞精确单变量反例")

    def test_complete_collision_replacements_pass_but_each_missing_variant_blocks(self):
        import copy

        module, parent, result, valid, group = self.collision_fixture()
        report = self.compare(module, parent, result)
        self.assertTrue(report["passed"], report)
        self.assertEqual(len(report["resolved_source_dependency_collisions"]), 1)
        for variant in group["variants"]:
            with self.subTest(variant=variant["obligation"]):
                altered = copy.deepcopy(valid)
                altered.pop(variant["obligation"])
                result = self.rewrite_collision(parent, altered)
                self.assertFalse(self.compare(module, parent, result)["passed"])

    def test_approved_equivalence_cannot_replace_production_variant_with_doc_locator(
        self,
    ):
        module, parent, _, valid, group = self.collision_fixture()
        variant = next(
            v for v in group["variants"] if v["source_role"] == "production_source"
        )
        mapping = valid[variant["obligation"]][
            "source_dependency_variant_replacements"
        ][0]
        mapping["replacement_source_ref"] = "docs/new.md#new_anchor"
        mapping["replacement_content_sha256"] = hashlib.sha256(
            (self.repository / "docs/new.md").read_bytes()
        ).hexdigest()
        result = self.rewrite_collision(parent, valid)
        report = self.compare(module, parent, result)
        self.assertFalse(report["passed"])
        self.assertTrue(any("角色" in e for e in report["errors"]))

    def test_collision_every_raw_reference_is_required(self):
        import copy

        module, parent, result, valid, group = self.collision_fixture(
            extra_reference=True
        )
        self.assertTrue(self.compare(module, parent, result)["passed"])
        variant = next(v for v in group["variants"] if len(v["references"]) == 2)
        altered = copy.deepcopy(valid)
        altered[variant["obligation"]]["source_dependency_variant_replacements"].pop()
        report = self.compare(module, parent, self.rewrite_collision(parent, altered))
        self.assertFalse(report["passed"])
        self.assertTrue(any("每个原rawref" in e for e in report["errors"]))

    def test_collision_bound_fields_and_authority_cannot_be_forged(self):
        import copy

        module, parent, _, valid, group = self.collision_fixture()
        variant_id = group["variants"][0]["obligation"]
        variants = {
            "wrong_fp": lambda r: r[variant_id][
                "source_dependency_variant_replacements"
            ][0].update(variant_fingerprint="f" * 64),
            "wrong_current_sha": lambda r: r[variant_id][
                "source_dependency_variant_replacements"
            ][0].update(replacement_content_sha256="f" * 64),
            "wrong_current_mode": lambda r: r[variant_id][
                "source_dependency_variant_replacements"
            ][0].update(replacement_git_mode="100755"),
            "wrong_anchor": lambda r: r[variant_id][
                "source_dependency_variant_replacements"
            ][0].update(replacement_source_ref="src/new.txt#missing_anchor"),
            "wrong_scenario": lambda r: r[variant_id][
                "source_dependency_variant_replacements"
            ][0].update(scenario="not_matched"),
            "missing_adr": lambda r: r[variant_id].update(decision_authorities=[]),
            "wrong_parent": lambda r: r[variant_id]["predecessor_fingerprints"].update(
                {parent: "f" * 64}
            ),
            "unknown_field": lambda r: r[variant_id][
                "source_dependency_variant_replacements"
            ][0].update(source_rol="documentation"),
        }
        for name, alter in variants.items():
            with self.subTest(name=name):
                changed = copy.deepcopy(valid)
                alter(changed)
                result = self.rewrite_collision(parent, changed)
                self.assertFalse(self.compare(module, parent, result)["passed"], name)

    def test_noncollision_missing_dependency_cannot_use_aggregate_conflict_exception(
        self,
    ):
        module, parent, _, valid, dependency, _ = self.fixture()
        valid[dependency]["disposition"] = "resolved_conflict"
        result = self.rewrite(module, parent, valid)
        report = self.compare(module, parent, result)
        row = next(r for r in report["results"] if r["obligation"] == dependency)
        self.assertEqual(row["status"], "unknown")
        self.assertTrue(
            any("disposition 不能处理" in reason for reason in row["reasons"])
        )
        self.assertFalse(report["passed"])

    def test_collision_mapping_cannot_be_copied_to_preserved_or_absent_resolution(self):
        import copy

        module, parent, _, valid, group = self.collision_fixture()
        for unrelated in ["behavior.runtime", "behavior.never-existed"]:
            with self.subTest(unrelated=unrelated):
                altered = copy.deepcopy(valid)
                variant_id = group["variants"][0]["obligation"]
                altered[unrelated] = copy.deepcopy(altered[variant_id])
                parent_obligation = module.continuity_snapshot(self.repository, parent)[
                    "obligations"
                ].get(unrelated)
                altered[unrelated]["predecessor_fingerprints"] = {
                    parent: parent_obligation["fingerprint"]
                    if parent_obligation is not None
                    else "absent"
                }
                report = self.compare(
                    module, parent, self.rewrite_collision(parent, altered)
                )
                self.assertFalse(report["passed"], unrelated)
                self.assertTrue(any("碰撞映射" in e for e in report["errors"]))

    def test_normal_single_variant_identity_and_fingerprint_match_original_formula(
        self,
    ):
        module, parent, _, _, dependency, _ = self.fixture()
        snapshot = module.continuity_snapshot(self.repository, parent)
        expected = hashlib.sha256(
            json.dumps(
                {
                    "content_digest": dependency.split("#source:")[1],
                    "anchor": None,
                    "git_mode": "100644",
                    "role": "documentation",
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        self.assertEqual(snapshot["obligations"][dependency]["fingerprint"], expected)
        self.assertFalse(snapshot["source_dependency_collisions"])
        self.assertFalse(any("#variant:" in k for k in snapshot["obligations"]))

    def test_two_real_parents_need_both_fingerprints_and_equivalence(self):
        import copy

        module, parent, _, resolutions, dependency, _ = self.fixture()
        root = self.repository
        # 第二真实父只改变旧Evidence语义范围，源树和历史raw保持相同。
        original = json.loads(
            git(
                root, "show", parent + ":.echo-semantic/evidence/evidence.original.md"
            ).split("\n---\n", 1)[0][4:]
        )
        original["limitations"].append("第二父的额外原限制仍须保留")
        oldtree = git(root, "rev-parse", "HEAD")
        git(root, "switch", "-qc", "second-historical-parent", parent)
        write_semantic_document(root, "evidence", "evidence.original", original)
        second = self.commit_current("第二真实历史父")
        second_snapshot = module.continuity_snapshot(root, second)
        git(root, "checkout", "--detach", oldtree)
        first_snapshot = module.continuity_snapshot(root, parent)
        for identifier, resolution in resolutions.items():
            resolution["predecessor_fingerprints"] = {
                r: snap["obligations"][identifier]["fingerprint"]
                for r, snap in [(parent, first_snapshot), (second, second_snapshot)]
            }
            resolution["evidence_refs"].append("evidence.second-equivalence")
        issue = second_snapshot["current_reference_issues"][0]
        mapping = copy.deepcopy(
            resolutions[dependency]["historical_reference_migrations"][0]
        )
        for key in mapping:
            if key in issue:
                mapping[key] = issue[key]
        mapping["equivalence_evidence_ref"] = "evidence.second-equivalence"
        resolutions[dependency]["historical_reference_migrations"].append(mapping)
        adr = root / "docs/adr/0001-storage.md"
        adr.write_text(
            adr.read_text() + "\n" + second + "\n" + issue["issue_id"] + "\n"
        )
        result = self.refresh_migration_materials(
            parent, resolutions, extra_equivalence=second
        )
        report = module.compare_continuity(root, parent, [parent, second], result)
        self.assertTrue(report["passed"], report)
        for resolution in resolutions.values():
            resolution["evidence_refs"].remove("evidence.second-equivalence")
        result = self.refresh_migration_materials(parent, resolutions)
        report = module.compare_continuity(root, parent, [parent, second], result)
        self.assertFalse(report["passed"])
        self.assertTrue(
            any(
                "全部不同父版本指纹" in reason
                for row in report["results"]
                for reason in row["reasons"]
            )
        )

    def test_current_reference_collision_same_sha_different_anchor_mode_or_role(self):
        module, _parent, _, _, _, _ = self.fixture()
        root = self.repository
        for case, refs in [
            ("anchor", ["docs/left.log#one", "docs/right.log#two"]),
            ("mode", ["docs/left.log", "docs/right.log"]),
            ("role", ["docs/left.log", "docs/tests/right.log"]),
        ]:
            with self.subTest(case=case):
                paths = [r.split("#", 1)[0] for r in refs]
                for relative in paths:
                    path = root / relative
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("one two\n")
                if case == "mode":
                    (root / paths[1]).chmod(0o755)
                observed = self.commit_current("相同内容异引用 " + case)
                evidence = {
                    "schema_version": 1,
                    "id": "evidence.collision",
                    "kind": "evidence",
                    "observed_at": observed,
                    "source_refs": refs,
                    "supports": [],
                    "limitations": [],
                }
                write_semantic_document(
                    root, "evidence", "evidence.collision", evidence
                )
                write_behavior(
                    root,
                    "behavior.collision",
                    "碰撞不得静默覆盖",
                    evidence_refs=["evidence.collision"],
                )
                revision = self.commit_current("当前相同SHA异引用 " + case)
                snapshot = module.continuity_snapshot(root, revision)
                self.assertTrue(
                    any("源码依赖身份冲突" in e for e in snapshot["errors"])
                )
                for relative in paths:
                    (root / relative).unlink()
                revision = self.commit_current("历史同SHA异引用 " + case)
                snapshot = module.continuity_snapshot(root, revision)
                self.assertTrue(
                    any("源码依赖身份冲突" in e for e in snapshot["errors"])
                )

    def test_same_cached_snapshot_as_result_remains_fatal(self):
        module, parent, _, _, _, _ = self.fixture()
        report = self.compare(module, parent, parent)
        self.assertFalse(report["passed"])
        self.assertEqual(len(report["snapshot_diagnostics"]), 3)
        self.assertEqual(
            {r["snapshot_role"] for r in report["snapshot_diagnostics"]},
            {"merge_base", "predecessor", "result"},
        )
        self.assertTrue(report["errors"])

    def test_control_evidence_current_references_cannot_use_historical_escape(self):
        module, parent, _, valid, _, _ = self.fixture()
        root = self.repository
        path = root / ".echo-semantic/evidence/evidence.storage-equivalence.md"
        data = json.loads(path.read_text()[4:].split("\n---\n", 1)[0])
        historical = json.loads(
            git(root, "show", parent + ":.echo-semantic/evidence/evidence.original.md")[
                4:
            ].split("\n---\n", 1)[0]
        )["observed_at"]
        data.update(observed_at=historical, source_refs=["docs/archive.log"])
        write_semantic_document(root, "evidence", data["id"], data)
        result = self.rewrite(module, parent, valid)
        report = self.compare(module, parent, result)
        self.assertFalse(report["passed"])
        self.assertTrue(
            any(
                "采用的迁移控制Evidence当前引用缺失" in reason
                for row in report["results"]
                for reason in row["reasons"]
            )
        )

    def test_unused_historical_control_evidence_retains_historical_observation(self):
        module, parent, _, valid, _, _ = self.fixture()
        root = self.repository
        historical = json.loads(
            git(root, "show", parent + ":.echo-semantic/evidence/evidence.original.md")[
                4:
            ].split("\n---\n", 1)[0]
        )["observed_at"]
        for original_id in [
            "evidence.storage-equivalence",
            "evidence.storage-continuity",
        ]:
            path = root / ".echo-semantic/evidence" / (original_id + ".md")
            data = json.loads(path.read_text()[4:].split("\n---\n", 1)[0])
            data.update(
                id=original_id + "-historical",
                observed_at=historical,
                source_refs=["docs/archive.log"],
            )
            if data["evidence_type"] == "behavior_equivalence":
                data["scenario_results"]["runtime"]["source_refs"] = [
                    "docs/archive.log"
                ]
            if data["evidence_type"] == "semantic_continuity":
                data["result_snapshot"] = "source:" + "1" * 64
                for resolution in data["resolutions"].values():
                    resolution.pop("historical_reference_migrations", None)
            write_semantic_document(root, "evidence", data["id"], data)
        result = self.rewrite(module, parent, valid)
        report = self.compare(module, parent, result)
        self.assertTrue(report["passed"], report)

    def test_preserved_fastpath_still_validates_attached_migration(self):
        import copy

        module, parent, _, valid, dependency, _ = self.fixture()
        altered = copy.deepcopy(valid)
        # 原behavior保持同指纹，不能因preserved跳过其非法storage mapping。
        altered["behavior.runtime"] = copy.deepcopy(altered[dependency])
        altered.pop(dependency)
        altered["behavior.runtime"]["predecessor_fingerprints"] = {
            parent: module.continuity_snapshot(self.repository, parent)["obligations"][
                "behavior.runtime"
            ]["fingerprint"]
        }
        result = self.rewrite(module, parent, altered)
        report = self.compare(module, parent, result)
        row = next(
            r for r in report["results"] if r["obligation"] == "behavior.runtime"
        )
        self.assertEqual(row["status"], "preserved")
        self.assertFalse(report["passed"])
        self.assertTrue(any("未绑定原依赖义务" in e for e in report["errors"]))

    def test_wrong_after_digest_unmatched_equivalence_and_unapproved_adr_block(self):
        import copy

        module, parent, _, valid, _, _ = self.fixture()
        root = self.repository
        eqpath = root / ".echo-semantic/evidence/evidence.storage-equivalence.md"
        original_eq = json.loads(eqpath.read_text()[4:].split("\n---\n", 1)[0])
        for field, value in [
            ("after_revision", "source:" + "f" * 64),
            (
                "scenario_results",
                {"runtime": {"status": "failed", "source_refs": ["docs/index.md"]}},
            ),
        ]:
            with self.subTest(field=field):
                data = copy.deepcopy(original_eq)
                data[field] = value
                write_semantic_document(root, "evidence", data["id"], data)
                result = self.rewrite(module, parent, valid)
                self.assertFalse(self.compare(module, parent, result)["passed"])
        write_semantic_document(root, "evidence", original_eq["id"], original_eq)
        adr = root / "docs/adr/0001-storage.md"
        adr.write_text(adr.read_text().replace("已批准", "未批准"))
        altered = copy.deepcopy(valid)
        for resolution in altered.values():
            resolution["decision_authorities"][0]["content_digest"] = hashlib.sha256(
                adr.read_bytes()
            ).hexdigest()
        result = self.rewrite(module, parent, altered)
        self.assertFalse(self.compare(module, parent, result)["passed"])


if __name__ == "__main__":
    unittest.main()
