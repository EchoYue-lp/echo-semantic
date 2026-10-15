from __future__ import annotations

import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/semantic-contract/scripts/verify_semantic.py"
SPEC = importlib.util.spec_from_file_location("binary_diff_verifier", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


class BinaryDiffTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(
            prefix="semantic-binary-diff-", dir=os.environ.get("TMPDIR")
        )
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git("init", "-q")
        (self.root / "runtime.rs").write_bytes(b"// baseline\n")
        self.git("add", "runtime.rs")
        self.git(
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-qm",
            "baseline",
        )
        self.base = self.git("rev-parse", "HEAD").decode().strip()

    def git(self, *args: str) -> bytes:
        result = subprocess.run(
            ["git", "-C", str(self.root), "-c", "core.quotePath=false", *args],
            check=False,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_tracked_invalid_utf8_preserves_bytes_and_risk_tokens(self) -> None:
        content = b"// \xff opaque\n" + "pub struct RuntimeState; // 中文😀\n".encode()
        (self.root / "runtime.rs").write_bytes(content)
        raw = self.git("diff", "--unified=0", self.base, "--", "runtime.rs")
        decoded = VERIFIER.run_git(
            self.root, "diff", "--unified=0", self.base, "--", "runtime.rs"
        )
        self.assertEqual(decoded.encode("utf-8", errors="surrogateescape"), raw)
        lines = VERIFIER.added_lines(self.root, self.base, "runtime.rs")
        self.assertEqual(
            "\n".join(lines).encode("utf-8", errors="surrogateescape") + b"\n", content
        )
        signals, paths = VERIFIER.infer_signals(self.root, self.base, ["runtime.rs"])
        self.assertTrue(signals["publicApi"])
        self.assertTrue(signals["newStateAuthority"])
        self.assertEqual(paths, {"runtime.rs"})

    def test_untracked_invalid_utf8_does_not_hide_risk_tokens(self) -> None:
        (self.root / "new.rs").write_bytes(
            b"// \xff\n" + b"pub struct ChangeJournal;\n"
        )
        lines = VERIFIER.added_lines(self.root, self.base, "new.rs")
        self.assertEqual(lines[0].encode("utf-8", errors="surrogateescape"), b"// \xff")
        signals, paths = VERIFIER.infer_signals(self.root, self.base, ["new.rs"])
        self.assertTrue(signals["publicApi"])
        self.assertTrue(signals["newStateAuthority"])
        self.assertEqual(paths, {"new.rs"})

    def test_unicode_path_and_content_remain_exact(self) -> None:
        relative = "中文😀.rs"
        content = "pub fn 中文() {} // 😀\n"
        (self.root / relative).write_text(content, encoding="utf-8")
        self.git("add", relative)
        self.assertIn(relative, VERIFIER.changed_paths(self.root, self.base))
        self.assertEqual(
            VERIFIER.added_lines(self.root, self.base, relative), content.splitlines()
        )
        signals, paths = VERIFIER.infer_signals(self.root, self.base, [relative])
        self.assertTrue(signals["publicApi"])
        self.assertEqual(paths, {relative})

    def test_binary_diff_keeps_changed_path_and_protocol_obligation(self) -> None:
        relative = "contracts/packet.bin"
        path = self.root / relative
        path.parent.mkdir()
        path.write_bytes(b"\x00\xff opaque")
        self.git("add", relative)
        self.assertIn(relative, VERIFIER.changed_paths(self.root, self.base))
        signals, paths = VERIFIER.infer_signals(self.root, self.base, [relative])
        self.assertTrue(signals["newProtocol"])
        self.assertEqual(paths, {relative})

    def test_explicit_binary_mode_remains_bytes(self) -> None:
        payload = b"\x00\xff\r\n"
        (self.root / "payload.bin").write_bytes(payload)
        self.git("add", "payload.bin")
        actual = VERIFIER.run_git(self.root, "show", ":payload.bin", binary=True)
        self.assertIsInstance(actual, bytes)
        self.assertEqual(actual, payload)

    def test_git_error_still_raises(self) -> None:
        with self.assertRaises(RuntimeError) as caught:
            VERIFIER.run_git(self.root, "rev-parse", "--verify", "missing-revision")
        self.assertTrue(str(caught.exception))


if __name__ == "__main__":
    unittest.main()
