"""Compatibility entry point: build from the current reviewed operations source."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("build-operations-manual.py")),run_name="__main__")
