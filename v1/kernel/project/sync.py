"""Safe project asset synchronization for explicit CBIM Skills."""
from __future__ import annotations
import json
from pathlib import Path
from atomic_io import atomic_write_text

_PKG_DIR = Path(__file__).resolve().parent
_TEMPLATES = _PKG_DIR / "templates"
_AGENTS = _PKG_DIR / "agents"
_COMMANDS = _PKG_DIR / "commands"
SKILL_NAMES = ("cbim-knowledge", "cbim-code", "cbim-architecture", "cbim-development", "cbim-memory")
KERNEL_AGENT_NAMES = ("architect", "auditor", "hr", "programmer")
# Dashboard, scheduler and hook-log commands are intentionally not installed.
KERNEL_COMMAND_NAMES = tuple(n for n in ("cbim_help", "cbim_install", "cbim_debug") if (_COMMANDS / f"{n}.md").exists())


def _read_template(name: str) -> str:
    return (_TEMPLATES / name).read_text(encoding="utf-8")

def read_template(name: str) -> str:
    return _read_template(name)

def read_agent_md(name: str) -> str:
    return (_AGENTS / f"{name}.md").read_text(encoding="utf-8")

def _rel(path: Path, root: Path) -> str:
    try: return str(path.relative_to(root)).replace("\\", "/")
    except ValueError: return str(path)

def _sync_file(dst: Path, content: str, root: Path, dry_run: bool, preserve: bool = False) -> str:
    rel = _rel(dst, root)
    if dst.exists() and (preserve or dst.read_text(encoding="utf-8") == content):
        return f"unchanged {rel}"
    verb = "would create" if dry_run and not dst.exists() else "would update" if dry_run else "created" if not dst.exists() else "updated"
    if not dry_run:
        dst.parent.mkdir(parents=True, exist_ok=True); atomic_write_text(dst, content)
    return f"{verb} {rel}"

def sync_claude_md(project_root: Path, dry_run=False) -> str:
    return _sync_file(project_root / "CLAUDE.md", _read_template("CLAUDE.md.tmpl"), project_root, dry_run, preserve=True)

def _append_template(dst: Path, template: str, root: Path, dry_run: bool) -> str:
    entries = [x.strip() for x in template.splitlines() if x.strip()]
    if not dst.exists(): return _sync_file(dst, template, root, dry_run)
    text = dst.read_text(encoding="utf-8"); missing = [x for x in entries if x not in {l.strip() for l in text.splitlines()}]
    if not missing: return f"unchanged {_rel(dst, root)}"
    if not dry_run: atomic_write_text(dst, text + ("" if text.endswith("\n") else "\n") + "\n".join(missing) + "\n")
    return f"{'would patch' if dry_run else 'patched'} {_rel(dst, root)}"

def sync_claudeignore(project_root: Path, dry_run=False):
    return _append_template(project_root / ".claudeignore", _read_template("claudeignore.tmpl"), project_root, dry_run)

def sync_agent(project_root: Path, name: str, dry_run=False):
    return _sync_file(project_root / ".claude/agents" / name / f"{name}.md", read_agent_md(name), project_root, dry_run, preserve=True)

def sync_agents(project_root: Path, dry_run=False): return [sync_agent(project_root,n,dry_run) for n in KERNEL_AGENT_NAMES]

def sync_command(project_root: Path, name: str, dry_run=False):
    return _sync_file(project_root / ".claude/commands" / f"{name}.md", (_COMMANDS/f"{name}.md").read_text(encoding="utf-8"), project_root, dry_run, preserve=True)

def sync_commands(project_root: Path, dry_run=False): return [sync_command(project_root,n,dry_run) for n in KERNEL_COMMAND_NAMES]

def sync_skills(project_root: Path, dry_run=False):
    out=[]; src=_PKG_DIR/"skills"
    for name in SKILL_NAMES:
        p=src/name/"SKILL.md"
        if p.exists(): out.append(_sync_file(project_root/".claude/skills"/name/"SKILL.md",p.read_text(encoding="utf-8"),project_root,dry_run,preserve=True))
    return out

def _legacy_hook(entry):
    if not isinstance(entry,dict) or entry.get("type", "command") != "command": return False
    cmd=entry.get("command")
    if not isinstance(cmd,str): return False
    return any(cmd.strip() == x or cmd.strip().startswith(x+" ") for x in ("cbim hook", ".cbim/run hook")) or ".claude/hooks/cbim_" in cmd

def sync_settings(project_root: Path, dry_run=False):
    p=project_root/".claude/settings.json"
    if not p.exists(): return f"unchanged {_rel(p,project_root)}"
    try: data=json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError: return f"skipped (invalid JSON) {_rel(p,project_root)}"
    before=json.dumps(data,sort_keys=True)
    hooks=data.get("hooks")
    if isinstance(hooks,dict):
        for event,groups in list(hooks.items()):
            if not isinstance(groups,list): continue
            for g in groups:
                if isinstance(g,dict) and isinstance(g.get("hooks"),list): g["hooks"]=[e for e in g["hooks"] if not _legacy_hook(e)]
    mcp=data.get("mcpServers")
    if isinstance(mcp,dict) and mcp.get("cbim")=={"command":".cbim/run","args":["mcp"]}: del mcp["cbim"]
    after=json.dumps(data,sort_keys=True)
    if before==after:return f"unchanged {_rel(p,project_root)}"
    if not dry_run: atomic_write_text(p,json.dumps(data,indent=2,ensure_ascii=False)+"\n")
    return f"{'would clean' if dry_run else 'cleaned'} {_rel(p,project_root)}"

def sync_mcp_json(project_root: Path, dry_run=False):
    p=project_root/".mcp.json"
    if not p.exists(): return f"unchanged {_rel(p,project_root)}"
    try:data=json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:return f"skipped (invalid JSON) {_rel(p,project_root)}"
    m=data.get("mcpServers"); changed=isinstance(m,dict) and m.get("cbim")=={"command":".cbim/run","args":["mcp"]}
    if changed and not dry_run: del m["cbim"]; atomic_write_text(p,json.dumps(data,indent=2)+"\n")
    return f"{'would clean' if dry_run and changed else 'cleaned' if changed else 'unchanged'} {_rel(p,project_root)}"

def sync_gitignore(project_root: Path, dry_run=False): return _append_template(project_root/".gitignore",_read_template("gitignore_entries.txt"),project_root,dry_run)

def sync_templates(project_root: Path, dry_run=False):
    root=Path(project_root).resolve(); out=[sync_claude_md(root,dry_run),sync_claudeignore(root,dry_run)]; out+=sync_agents(root,dry_run)+sync_commands(root,dry_run)+sync_skills(root,dry_run); out += [sync_settings(root,dry_run),sync_mcp_json(root,dry_run),sync_gitignore(root,dry_run)]; return out
