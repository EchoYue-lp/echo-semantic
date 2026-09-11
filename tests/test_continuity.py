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


if __name__ == "__main__":
    unittest.main()
