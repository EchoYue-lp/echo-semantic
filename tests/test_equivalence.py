from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/semantic-contract/scripts/verify_semantic.py"


class EquivalenceTests(unittest.TestCase):
    def test_verifier_self_test_covers_equivalence_evidence(self) -> None:
        result = subprocess.run(
            ["uv", "run", str(SCRIPT), "--self-test"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("语义治理校验器自测通过", result.stdout)


if __name__ == "__main__":
    unittest.main()
