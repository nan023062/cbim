"""
agent.py — Agent resource.

Agents live at <project>/.claude/agents/<name>/<name>.md with an optional
sibling `skills/` directory holding per-agent skill markdown files. The
class is a thin wrapper around the engine primitives in cbi/_primitives/agents.py
plus the shared frontmatter/body sub-objects.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator

from ._base import Resource
from ._body import Body
from ._frontmatter import Frontmatter
from ._io import atomic_write_text
from .skill import Skill
from .._primitives import agents as _agents_eng
from .._primitives import skills as _skills_eng
from services._fm import parse_frontmatter, strip_frontmatter


class AgentFrontmatter(Frontmatter):
    _SCHEMA = ("name", "description", "model", "tools")


def _skill_name_from_rec(rec: dict) -> str:
    """Recover the skill name from a `_primitives.skills.load_agent_skill` record.

    Primitive records carry `form` + `path`; the name is not stored explicitly
    because it is unambiguously derivable from the path shape:
      * form == "file" -> path is `<skill>.md`,        name == path.stem
      * form == "dir"  -> path is `<skill>/skill.md`,  name == path.parent.name
    """
    return rec["path"].parent.name if rec["form"] == "dir" else rec["path"].stem


class SkillCollection:
    """View over `<agent_dir>/skills/`, supporting both file-form (`<name>.md`)
    and dir-form (`<name>/skill.md` + `<name>/assets/`) skills.

    Disk-shape detection (which form a given skill uses) is delegated to
    `cbi._primitives.skills`; this class never inspects `<name>.md` vs
    `<name>/skill.md` directly.
    """

    def __init__(self, agent_dir: Path):
        self._agent_dir = agent_dir
        self._agents_dir = agent_dir.parent
        self._agent_name = agent_dir.name
        # Retained for backward-compat introspection; not used for form
        # detection (primitives handle that).
        self._dir = agent_dir / "skills"

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def list(self) -> list[str]:
        recs = _skills_eng.list_agent_skills(self._agents_dir, self._agent_name)
        return [_skill_name_from_rec(r) for r in recs]

    def get(self, name: str) -> Skill:
        rec = _skills_eng.load_agent_skill(self._agents_dir, self._agent_name, name)
        if rec is None:
            raise FileNotFoundError(
                f"skill not found: {self._agent_name}/{name}"
            )
        return Skill.load(rec["path"])

    def __contains__(self, name: str) -> bool:
        # `load_agent_skill` returns None when neither form exists and raises
        # `AmbiguousSkillError` when both exist; letting the error propagate
        # is intentional (ambiguity is a real state the caller must resolve,
        # not something to silently paper over).
        return _skills_eng.load_agent_skill(
            self._agents_dir, self._agent_name, name
        ) is not None

    def __iter__(self) -> Iterator[Skill]:
        for rec in _skills_eng.list_agent_skills(self._agents_dir, self._agent_name):
            yield Skill.load(rec["path"])

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def add(self, name: str, content: str, *, as_dir: bool = False) -> Skill:
        """Create a new skill.

        `as_dir=False` (default) creates the legacy single-file shape
        (`<name>.md`). `as_dir=True` creates the directory shape
        (`<name>/skill.md`), which is required if the skill will later gain
        `assets/`. The primitives layer refuses to create over an existing
        skill in either form (`FileExistsError`).
        """
        path = _skills_eng.create_agent_skill(
            self._agents_dir,
            self._agent_name,
            name,
            content,
            as_dir=as_dir,
        )
        return Skill.load(path)

    def remove(self, name: str) -> None:
        try:
            _skills_eng.delete_agent_skill(
                self._agents_dir, self._agent_name, name
            )
        except FileNotFoundError:
            # Match the pre-primitive behaviour: silent no-op when absent.
            pass


class Agent(Resource):
    """A single agent: its frontmatter, body, and skill catalog."""

    def __init__(
        self,
        agent_dir: Path,
        *,
        frontmatter: AgentFrontmatter,
        body: Body,
    ):
        self._agent_dir = agent_dir.resolve()
        self._path = (self._agent_dir / f"{self._agent_dir.name}.md").resolve()
        self._id = self._agent_dir.name
        self._dirty = False
        self.frontmatter = frontmatter
        self.body = body
        self.skills = SkillCollection(self._agent_dir)
        frontmatter._on_change = self._mark_dirty
        body._on_change = self._mark_dirty

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _agents_dir(root: Path | None) -> Path:
        if root is None:
            from context import project_root
            root = project_root()
        return root / ".claude" / "agents"

    # ------------------------------------------------------------------
    # Classmethods
    # ------------------------------------------------------------------

    @classmethod
    def load(cls, name: str, *, root: Path | None = None) -> "Agent":
        agents_dir = cls._agents_dir(root)
        agent_dir = agents_dir / name
        md = agent_dir / f"{name}.md"
        if not md.is_file():
            raise FileNotFoundError(f"agent not found: {name} ({md})")
        raw = md.read_text(encoding="utf-8")
        return cls(
            agent_dir,
            frontmatter=AgentFrontmatter(parse_frontmatter(raw)),
            body=Body(strip_frontmatter(raw)),
        )

    @classmethod
    def create(
        cls,
        name: str,
        *,
        description: str = "",
        model: str = "claude-sonnet-4-6",
        tools: str = "Read, Write, Edit, Glob, Grep, Bash",
        root: Path | None = None,
    ) -> "Agent":
        agents_dir = cls._agents_dir(root)
        # Reuse the engine primitive for scaffolding (creates dir, skills/,
        # and the .md file with a templated body).
        _agents_eng.scaffold_agent(agents_dir, name, description, model)
        agent = cls.load(name, root=root)
        # If caller asked for a non-default tools string, persist it.
        if tools != "Read, Write, Edit, Glob, Grep, Bash":
            agent.frontmatter.set("tools", tools)
            agent.save()
        return agent

    @classmethod
    def exists(cls, name: str, *, root: Path | None = None) -> bool:
        return (cls._agents_dir(root) / name / f"{name}.md").is_file()

    @classmethod
    def list_all(cls, *, root: Path | None = None) -> list["Agent"]:
        agents_dir = cls._agents_dir(root)
        if not agents_dir.exists():
            return []
        out: list[Agent] = []
        for d in sorted(agents_dir.iterdir()):
            if not d.is_dir():
                continue
            md = d / f"{d.name}.md"
            if not md.is_file():
                continue
            try:
                out.append(cls.load(d.name, root=root))
            except FileNotFoundError:
                continue
        return out

    # ------------------------------------------------------------------
    # Save / Archive
    # ------------------------------------------------------------------

    def save(self) -> None:
        fm = self.frontmatter.render()
        body = self.body.read()
        # Body in the on-disk file conventionally starts after one blank line.
        if body and not body.startswith("\n"):
            text = fm + "\n" + body
        else:
            text = fm + body
        if not text.endswith("\n"):
            text += "\n"
        atomic_write_text(self._path, text)
        self._mark_clean()

    def archive(self) -> Path:
        return _agents_eng.archive_agent(self._agent_dir)

    def delete(self, *, force: bool = False) -> None:
        if not force:
            raise RuntimeError(
                "Agent.delete removes the entire agent directory; pass force=True"
            )
        import shutil
        shutil.rmtree(self._agent_dir)
