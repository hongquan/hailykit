# OWASP Agentic Top 10 Checklist (ASI:2026)

**Source:** OWASP Top 10 for Agentic Applications (ASI:2026) — announced Agentic Security Summit / Black Hat Europe 2025  
**Inject when:** agentic code detected in diff (LLM SDK imports, `@tool`, MCP tool schemas) OR `--agentic` flag set  
**Fidelity split:** statically detectable risks get check items; runtime-only risks get testing guidance

---

## Statically Detectable Risks

### ASI02:2026 — Agentic Tool/Function Misuse *(HIGH static signal)*

Check tool definitions (function schemas, `@tool`-decorated functions, MCP `tools` arrays):

- [ ] **Input validation:** Tool inputs validate and sanitize data from LLM responses before execution — no raw LLM output passed directly to a tool that performs writes, queries, or external calls
- [ ] **Scope restriction:** Tool descriptions do not imply unrestricted scope (e.g., "execute any SQL" without an allowlist of permitted operations)
- [ ] **Allowlist enforcement:** Sensitive tool categories (filesystem write, shell exec, network request) have an explicit allowlist of permitted operations — not just a description-level hint
- [ ] **Output escaping:** Tool results returned to the LLM context are sanitized before being used as inputs to subsequent tool calls

### ASI03:2026 — Identity and Privilege Abuse *(MEDIUM static signal)*

Check agent credential configuration and privilege patterns:

- [ ] **Credential scoping:** API keys, tokens, or credentials used by the agent are scoped to minimum required permissions — not reusing admin/root credentials for automated agent actions
- [ ] **Session isolation:** Agent state, credentials, and context are isolated per user session — no shared mutable state that could leak privilege across users or tasks
- [ ] **Pre-action identity check:** Privileged tool calls (admin endpoints, impersonation, elevated DB operations) verify the identity of the requesting entity before execution
- [ ] **No hardcoded identity assumptions:** Agent code does not assume a fixed privilege level (e.g., always runs as service account with write access to all resources)

### ASI04:2026 — Supply Chain Vulnerabilities *(MEDIUM static signal)*

Check new LLM/agent package additions in manifest files (`package.json`, `requirements.txt`, `go.mod`, etc.):

- [ ] **Version pinning:** New LLM SDK or agent library is pinned to an exact version or hash — not a range (`^`, `~`, `>=`)
- [ ] **Credential handling:** Model provider API keys or credentials are not stored in source files — referenced via env vars or secret managers
- [ ] **Integrity verification:** If model weights or embeddings are downloaded at runtime, the download URL is pinned and integrity is verified (checksum or signed URL)

### ASI05:2026 — Excessive Permissions / Code Execution *(HIGH static signal)*

Check `exec()`, `subprocess`, shell commands, and tool definitions granting code execution or broad filesystem access:

- [ ] **Execution sandboxing:** Code execution tools (`exec`, `subprocess`, shell) run inside a sandbox (container, restricted user, seccomp) — not directly on the host process
- [ ] **Least privilege:** Tool permission scope matches the task requirement — no broad filesystem read/write when only a specific path is needed
- [ ] **Execution confirmation:** Agent-triggered code execution that has side effects outside the repo (deploy, send email, mutate external DB) has a human-in-the-loop confirmation step before execution

### ASI07:2026 — Insecure Inter-Agent Communication *(MEDIUM static signal)*

Check code where agents invoke, coordinate with, or pass messages to other agents:

- [ ] **Output sanitization at handoff:** Agent outputs are not passed as raw input to downstream agents — intermediate results are validated or sanitized at handoff boundaries
- [ ] **Message authentication:** Agent-to-agent calls include authentication or trust verification — not accepting unauthenticated instructions from an upstream agent as trusted commands
- [ ] **Recursion guard:** Agent chains that can call themselves or form cycles have explicit depth or call-count limits
- [ ] **Context isolation:** Shared state objects are not accessible across unrelated task contexts — no global agent memory that any task can read/write without ownership check

---

## Runtime-Only Risks *(guidance — no static check items)*

These risks cannot be reliably detected by static code analysis. Review the diff for architectural signals; use the recommended runtime tools to test.

**ASI01:2026 — Agent Goal Hijacking**  
Agent diverted from its intended goal via malicious instructions in inputs or context. Static code cannot detect crafted goal-overriding inputs.  
→ Test with Promptfoo (goal hijacking suite) or DeepTeam adversarial prompt testing.

**ASI06:2026 — Memory and Context Poisoning**  
Malicious content injected into agent memory or context window to influence future behavior. Requires tracing actual context window contents at runtime.  
→ Enable LLM gateway logging; audit content written to persistent memory; test with DeepTeam memory poisoning suite.

**ASI08:2026 — Cascading Failures**  
One agent failure propagates through a multi-agent system causing broader disruption. Architectural review: verify error handling at agent boundaries.  
→ Verify each agent fails safely (returns error, not corrupt output); test failure injection in agent chains; confirm circuit-breaker patterns exist for downstream agents.

**ASI09:2026 — Human-Agent Trust Exploitation**  
Agent manipulates human trust relationships — e.g., impersonating a trusted role or escalating authority through social engineering. Requires behavioral observation.  
→ Review agent-facing UX for impersonation signals; test with prompts that request the agent to act as a more privileged entity.

**ASI10:2026 — Rogue Agents**  
Agent operates outside its authorized scope or intent. Policy/design review: check task scope limiting in agent configuration.  
→ Test with scope-exceeding prompts in a sandbox; verify the agent refuses or escalates rather than acting outside its defined task boundaries.
