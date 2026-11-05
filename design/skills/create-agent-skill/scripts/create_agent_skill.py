"""Deterministic creation entry; shared mechanics live in core.src/scripts."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from create_method import main

if __name__ == "__main__":
    raise SystemExit(main("skill"))
