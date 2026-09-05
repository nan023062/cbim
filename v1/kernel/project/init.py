"""Bootstrap a project for explicit, user-invoked CBIM Skills."""
from __future__ import annotations
import os, subprocess, sys
from pathlib import Path
from atomic_io import atomic_write_text
from . import sync as _sync

_TEMPLATES = _sync._TEMPLATES
_AGENT_NAMES = _sync.KERNEL_AGENT_NAMES
_COMMAND_NAMES = _sync.KERNEL_COMMAND_NAMES

def _print(action, path, root):
    try: rel=path.relative_to(root)
    except ValueError: rel=path
    print(f"[cbim] {action} {str(rel).replace(chr(92), '/')}")

def _ensure_dir(path, root):
    if not path.exists(): path.mkdir(parents=True,exist_ok=True); _print("created",path,root)

def _install_config(root, force=False):
    p=root/".cbim/config.json"
    if not p.exists(): p.parent.mkdir(parents=True,exist_ok=True); atomic_write_text(p,(_TEMPLATES/"config.json.tmpl").read_text(encoding="utf-8")); _print("created",p,root)

def _install_venv(root, force=False):
    v=root/".cbim/.venv"; py=v/("Scripts/python.exe" if os.name=="nt" else "bin/python")
    if py.exists(): return
    r=subprocess.run([sys.executable,"-m","venv",str(v)],capture_output=True,text=True)
    if r.returncode: raise SystemExit(f"failed to create venv: {r.stderr.strip()}")
    _print("created",v,root)

def _install_run_shim(root, force=False):
    d=root/".cbim"; d.mkdir(parents=True,exist_ok=True)
    p=d/"run"; atomic_write_text(p,'#!/bin/sh\nDIR="$(cd "$(dirname "$0")" && pwd)"\nexport PYTHONPATH="$DIR/kernel${PYTHONPATH:+:$PYTHONPATH}"\nexec "$DIR/.venv/bin/python" -m engine "$@"\n'); os.chmod(p,0o755)
    q=d/"run.cmd"; atomic_write_text(q,'@echo off\r\nsetlocal\r\nset "DIR=%~dp0"\r\nset "PYTHONPATH=%DIR%kernel;%PYTHONPATH%"\r\n"%DIR%.venv\\Scripts\\python.exe" -m engine %*\r\n')

def init_project(project_root: Path, force=False):
    root=Path(project_root).resolve(); print(f"[cbim] Initializing CBIM project at {root}")
    _install_config(root,force); _ensure_dir(root/".cbim/memory/medium",root); _ensure_dir(root/".cbim",root)
    # Registry initialization is deliberately local and does not ingest memory.
    try:
        from cbi._primitives.modules.registry import ensure_registry
        ensure_registry(root)
    except (ImportError, AttributeError):
        p=root/".cbim/index.md"; p.parent.mkdir(parents=True,exist_ok=True); p.touch(exist_ok=True)
    _install_venv(root,force); _install_run_shim(root,force)
    for action in _sync.sync_templates(root):
        print(f"[cbim] {action}")
    print("[cbim] Done! Start Claude Code in this directory.")
