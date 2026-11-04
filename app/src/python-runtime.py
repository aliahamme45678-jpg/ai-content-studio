"""Use the workspace-pinned interpreter when a host launches an adapter via another Python."""
import json
import os
import sys
import subprocess
from pathlib import Path

def ensure_runtime(entry_argv):
    config = Path(os.environ.get('STUDIO_DATA_DIR') or Path(__file__).resolve().parents[1] / 'data') / 'collector-python.json'
    if not config.is_file():
        return
    target = Path(json.loads(config.read_text(encoding='utf-8-sig'))['executable']).resolve()
    if not target.is_file():
        raise RuntimeError('collector_python_not_found: ' + str(target))
    if Path(sys.executable).resolve() != target:
        print('Collector Python: ' + str(target), flush=True)
        result = subprocess.run([str(target), '-I', '-u', *entry_argv], stdout=sys.stdout, stderr=sys.stderr, stdin=sys.stdin, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        raise SystemExit(result.returncode)
