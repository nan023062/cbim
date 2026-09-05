SKILL: str = """\
# Skill: Explicit Memory Organization

This method is used only when the user explicitly asks to organize selected
memory entries. It does not read transcripts, capture conversations, trigger
background governance, or modify sources without explicit authorization.

## Method

1. Confirm the entries or directory range the user selected.
2. Read the selected entries and distinguish facts, decisions, experience, and
   obsolete material without inventing missing conclusions.
3. Propose merges or extracted knowledge and identify every file to change.
4. Apply only the authorized changes through the memory service or CLI.
5. Report saved, deleted, and index results separately. Never start another
   maintenance pass because of a threshold or because the task finished.

Memory writes use the `medium` tier. Candidates are an explicit work area, not
an automatically populated queue. Business knowledge belongs in `.dna/`, and
reusable capability belongs in Agents and Skills.
"""
