--
description: Query project DNA modules, contracts, notes, and workflows when the user asks about CBIM architecture or project knowledge.
user-invocable: true
--

# CBIM Knowledge

Use the explicit DNA CLI to inspect project knowledge. For a module, run `dna show PATH --include-notes`; for workflow discovery, run `dna workflows-scan PATH... --keywords TERM...`. Do not infer or modify knowledge when the request is not explicit.
