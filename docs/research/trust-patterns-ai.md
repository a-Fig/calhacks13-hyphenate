# Making AI agent work auditable: current techniques and products

Researched 2026-10-24 by a Sonnet research agent.

Evidence tags: **[read]** = I read the primary page today. **[snippet]** = only a search-result summary or trade press; treat as unverified. **[memory]** = from my own knowledge, not checked today. Vendor claims are vendor claims. Section 3 is my proposal, not a finding.

## 1. Bottom line

- **Do not make the model's reasoning text the audit record.** Anthropic measured that Claude 3.7 Sonnet mentioned a planted hint in its chain of thought only ~25% of the time (DeepSeek R1 ~39%), and reward hacks were verbalized under 2% of the time in most scenarios ([Anthropic, 2025-04-03](https://www.anthropic.com/research/reasoning-models-dont-say-think)) [read]. The API's thinking text "is never the raw chain of thought", and on the newest models (incl. Sonnet 5.5) `display` defaults to `"omitted"` ([thinking docs](https://platform.claude.com/docs/en/build-with-claude/thinking)) [read]. "How it reasoned" must be rebuilt from checkable artifacts: sources and spans, tool calls, assumptions, deterministic computations, and an explicitly labelled rationale.
- **Your architecture already has the hard part.** "LLMs interpret; code computes", assumptions as data, and hash-keyed pure check runs (ARCHITECTURE §3, §8) mean most of the trail can be *recomputed*, not merely logged. That beats every product I found, which log LLM calls but do not link a number to its inputs.
- **Tracing products solve a different problem.** OTel GenAI, Langfuse, Phoenix, Braintrust and LangSmith record LLM runs (timing, messages, tool calls). None model "this p50 came from this formula, this assumption and this paragraph of the ECR." Borrow their vocabulary and UI patterns; build the business-lineage layer yourselves in SpacetimeDB.
- **Finance vendors all converge on: evidence + reasoning + confidence + human final authority.** Nobody publishes a schema. Hyphenate's own copy says "Every action it takes carries its own evidence: what it did, why, and based on what" and "When it's confident, it acts. When it isn't, it escalates... and remembers the answer" ([their blog](../../sources/hyphenate/site/blog/what-we-mean-by-autonomous-finance.md)). The judges will recognise that; the differentiator available to us is number-level lineage plus replay.
- **Enforce autonomy in code at the write boundary, not in prompts.** Claude Code, AWS AgentCore (Cedar) and OPA all follow that pattern, and it maps cleanly onto SpacetimeDB, where tables are written only through reducers.
- **Strongest honest caveat:** LLM confidence is poorly calibrated; derive "ask vs act" from checkable signals plus consistency sampling, and measure the false-approve rate on planted errors. Without that number, "configurable autonomy" is a claim, not evidence.

## 2. Techniques and products

### 2.1 Tracing and observability
- **OpenTelemetry GenAI semantic conventions** (repo moved to [open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai); spec read 2026-10-24) [read]. Everything in the agent spans is status **Development**, so names can still change. Operations: `create_agent`, `invoke_agent` (client and internal variants), invoke workflow, `plan`, `execute_tool`, plus skill-load and command spans. `execute_tool` requires `gen_ai.tool.name`; `gen_ai.tool.call.id` when the provider supplies one; `gen_ai.tool.call.arguments` and `.result` are **Opt-In** with a "may contain sensitive information" warning. `invoke_agent` carries `gen_ai.input.messages`, `output.messages`, `system_instructions`, `tool.definitions`, all Opt-In. A `plan` span parents the LLM call that made the plan; tool spans are siblings under `invoke_agent`. Gives hierarchy, IDs, timing. Does not give sources-with-spans or number lineage.
- **OpenInference / Arize Phoenix** ([spec](https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md)) [read]. Span kinds LLM, EMBEDDING, CHAIN, RETRIEVER, RERANKER, TOOL, AGENT, GUARDRAIL, EVALUATOR, PROMPT, DECISION. Retriever spans carry documents with ids and scores. Useful pattern: `annotation.*` (name, label, score, explanation, `annotator_kind` = HUMAN / LLM / CODE) attached to any span or trace. That is exactly the shape of a verification result. Phoenix is OTLP-based and open source ([docs](https://arize.com/docs/phoenix/tracing/llm-traces)) [read, partial].
- **Langfuse** ([observation types](https://langfuse.com/docs/observability/features/observation-types)) [read]: event, span, generation, agent, tool, chain, retriever, evaluator, embedding, guardrail. Has a trace timeline view, a beta agent graph view with Aggregated / Expanded toggle, and public share links per trace ([agent graphs](https://langfuse.com/docs/observability/features/agent-graphs), [snippet]).
- **LangSmith** ([concepts](https://docs.langchain.com/langsmith/observability-concepts)) [read]: run = span, trace = runs under one ID (hard cap 25,000 runs per trace), threads group multi-turn traces, feedback = tag + score bound to a run ID.
- **Braintrust** ([traces](https://www.braintrust.dev/docs/guides/traces)) [read]: span types eval, task, llm, function, tool, score. Score spans hold the judge's reasoning. Input, output, metadata, metrics, scores per span.
- **How Anthropic did it** ([multi-agent research system, 2025-06-13](https://www.anthropic.com/engineering/multi-agent-research-system)) [read]: "full production tracing" to diagnose failures; a separate CitationAgent assigns citation locations; one LLM judge with a rubric (factual accuracy, citation accuracy, completeness, source quality, tool efficiency), and "human evaluation catches what automation misses".
- **Sub-agent gotcha** ([Agent SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents)) [read]: intermediate tool calls and results stay inside the subagent and only its final message returns to the parent. Messages from inside a subagent carry `parent_tool_use_id` (and `agent_id` in the TS SDK >= 0.3.292). If you only log the parent, you lose #25's "researchers it spawned and what they found". Record the child stream separately.

### 2.2 Provenance and lineage
- **W3C PROV-DM** (Recommendation, 2013-04-30) [read]: Entity, Activity, Agent; relations `used`, `wasGeneratedBy`, `wasDerivedFrom`, `wasAttributedTo`, `wasAssociatedWith`, `actedOnBehalfOf` (delegation), `wasInformedBy`. Use as vocabulary. `actedOnBehalfOf` is the right word for "agent acts under a seat a person configured".
- **OpenLineage** ([object model](https://openlineage.io/docs/spec/object-model)) [read]: Run (client UUID, UUIDv7 recommended) of a Job reading and writing Datasets; extensible *facets* (schema, version, data-quality, `parent` run). Pattern worth copying: facets as optional typed extras so the core stays small. Column-level lineage is not on that page [read: absent]; our `QuantityInput` edges play that role.
- **C2PA** (spec 2.x; [snippet] via secondary summaries): a signed manifest holds hashed assertions, an "ingredients" chain, and a hard binding to the content hash; validators report well-formed / valid / trusted. Built for media files, so not adoptable as-is. The transferable idea is a signed hash over a bundle of assertions plus ingredient links.

### 2.3 Grounded citations
- **Anthropic Citations** ([docs](https://platform.claude.com/docs/en/build-with-claude/citations)) [read]. Enable per document with `citations: {enabled: true}`. Location types: `char_location` (plain text, 0-indexed, exclusive end, sentence-chunked), `page_location` (PDF, 1-indexed pages), `content_block_location` (custom content, no extra chunking, finest control). `cited_text` is returned by the API, does not count toward output tokens, and the docs say citations are "guaranteed to contain valid pointers to the provided documents". Valid pointer is not the same as the claim being supported. **Citations cannot be combined with structured outputs.** GA, all active models.
- **Search-result blocks** ([docs](https://platform.claude.com/docs/en/build-with-claude/search-results)) [read]: `{type: "search_result", source, title, content: [text blocks]}`, returnable from your own tool results, giving `search_result_location` citations with `start_block_index` / `end_block_index` and `cited_text`. Within one `tool_result`, if any block is a search result, all must be. Split content into small blocks for finer citations. This is the natural fit for an agent that queries PLM/ERP through tools.
- **Does the span really support the claim?** ALCE ([Gao et al., EMNLP 2023](https://arxiv.org/pdf/2305.14627)) [snippet] scored citation recall and precision with an NLI model; its metrics agreed with humans 85.1% (recall) and 77.6% (precision), and even the best models lacked full citation support in about half of ELI5 generations. Two lessons: auto-checking entailment is useful but imperfect, and citation support is not free. For *quotes*, verification is trivial and exact: the cited string must appear at the cited offsets in the hashed source.

### 2.4 Structured reasoning records
- **Toulmin model** [memory]: claim, grounds (data), warrant (why the data supports the claim), backing, qualifier (how sure), rebuttal (what would defeat it). Maps almost 1:1 onto our fields: claim, evidence, rule/assumption, confidence, "what would change this".
- **GSN Community Standard v3** (SCSC Assurance Case Working Group, 2021-05-04) ([SCSC](https://scsc.uk/gsn-standard), [snippet]): goals (claims), strategies (decomposition logic), solutions (evidence), context, assumptions, justifications. Originated at York for safety cases. I did not find a primary source tying GSN to a specific aircraft certification regime; EASA's ML guidance (Concept Paper, Level 1/2, Issue 02 proposed) frames "learning assurance" and "AI explainability" ([EASA](https://www.easa.europa.eu/en/downloads/137631/en), [snippet]). A tool-supported ontology exists ([OntoGSN, arXiv 2506.11023, 2025](https://arxiv.org/abs/2506.11023)) [read abstract]. Recommendation: render a decision as a GSN-*lite* tree for the aircraft audience; don't attempt a full assurance-case argument with confidence arguments.

### 2.5 Calibrated uncertainty and abstention
- Verbalized confidence from black-box LLMs skews overconfident; consistency across sampled answers and better aggregation reduce this; nothing wins consistently, and hard professional-knowledge tasks stay hard ([Xiong et al., ICLR 2024](https://arxiv.org/abs/2306.13063)) [read abstract].
- **KnowNo** ([Ren et al., CoRL 2023](https://arxiv.org/pdf/2307.01928)) [snippet]: conformal prediction over candidate actions; if the calibrated set has more than one option, ask for help. Gives a statistical guarantee on success rate with minimal asking. We lack the data to do this properly in a day, but the *shape* (calibrate a threshold on labelled cases, report the guarantee) is what "knowing when to ask" should mean.
- Abstention survey ([Wen et al., TACL 13, 2025](https://arxiv.org/pdf/2407.18418)) [snippet]: query-, model-, and values-based views of when to decline.
- Anthropic's data on autonomy in practice ([measuring agent autonomy](https://www.anthropic.com/research/measuring-agent-autonomy)) [snippet for numbers]: users auto-approve more as they gain experience (~20% of sessions for new users, >40% after ~750), and on complex tasks Claude asked for clarification more often than humans interrupted. Supports #24: autonomy grows with demonstrated reliability, so make it a setting.

### 2.6 Verification patterns
- **Recompute** (pure function of hashed inputs): strongest and cheapest; yours by design (§8).
- **Mechanical checks:** quote-in-source; every number in narration must match an allowed computed `Quantity` ("number lint"); schema/unit checks.
- **Independent verifier agent:** given only the claim and the cited span, blind to the author's conclusion, different prompt (ideally different model family), answers supports / contradicts / insufficient. Record it as an annotation (OpenInference-style, `annotator_kind=LLM`).
- **LLM-as-judge risks:** position bias, verbosity bias (contested), self-preference bias tied to low perplexity, authority and bandwagon biases ([survey, arXiv 2411.15594](https://arxiv.org/pdf/2411.15594); [self-preference, arXiv 2410.21819](https://arxiv.org/pdf/2410.21819); [survey, arXiv 2412.05579](https://arxiv.org/pdf/2412.05579)) [snippet]. Mitigate: judge narrow entailment questions, swap order, use a different model than the author, never let a judge be the only gate on money-relevant claims.
- **Spot checks and planted errors:** the Hyphenate brief asks for "planted errors with an answer key" as proof. The same set measures verifier and gate quality.

### 2.7 Finance audit expectations
- **COSO, *Achieving Effective Internal Control Over Generative AI*, 2026-02-23** ([Deloitte summary](https://dart.deloitte.com/USDART/home/publications/deloitte/heads-up/2026/coso-internal-controls-generative-ai)) [read, secondary]: extends the 2013 framework (5 components, 17 principles); log model and version, prompts, key inputs and outputs, approvals; heightened human oversight for outputs touching journal entries, reconciliations, estimates; govern prompts/config with change control; monitor drift and override percentage; keep a use-case inventory with owners and escalation paths. It does not set agent-specific expectations (per that summary).
- **PCAOB AS 2201 benchmarking** [snippet, paragraph numbers unconfirmed; PCAOB site returned 403]: auditors may rely on a baseline for a *fully automated* application control only if general controls over program changes, access and operations are effective and the control has not changed since baseline. The premise is deterministic behaviour. **My inference:** an LLM step breaks that premise, so keep the money path in deterministic code (already your principle) and give each LLM step per-instance evidence. Prompt and model version are the "program change" an ITGC would govern.
- **Scope caveat:** an ECR cost forecast is a planning estimate, not ICFR. Posting to a ledger would be. Judges will still read the trail through a SOX lens.
- **Vendors** (all vendor claims):
  - BlackLine Finance Control Console, preview announced 2026-06-25: audit trails, "explainable decision records", policy management, human-in-the-loop exception management, across BlackLine, partner, customer-built and third-party agents ([ERP Today](https://erp.today/blackline-cfo-finance-ai-control-room-governance/)) [read]. Verity Prepare reconciliation recommendations reportedly include reasoning, confidence scoring and an audit trail, with humans final ([earnings-call summaries, snippet]). Tamper-evidence and per-agent permission settings were not mentioned in what I read.
  - Workiva, 2026-07-29: Tie-Out Agent gives an AI-generated explanation per flagged variance and a "fully documented audit trail"; Benchmarking Agent insights are "traceable back to the source filing" ([press coverage, snippet]; release page returned 403).
  - FloQast: "auditable AI Agents", ISO 42001, "preparers to reviewers"; no public detail on what is logged ([Channel Insider, 2025](https://www.channelinsider.com/news-and-trends/floqast-ai-agents-accounting/)) [read].
  - Hyphenate: "Audit-Ready Agents", "Every figure traces back to its source", a Kiteworks controller saying the agent entry is reviewed by a manager like a staff entry ([platform](../../sources/hyphenate/site/platform.md), [controller](../../sources/hyphenate/site/controller.md)). No public schema.

### 2.8 Policy and permissioning
- **Cedar** ([docs](https://docs.cedarpolicy.com/overview/terminology.html)) [read]: request = principal, action, resource, context; `permit` / `forbid` with `when` / `unless`; schema validation of policies; the response lists the "determining policies". **AWS Bedrock AgentCore Policy** applies Cedar at the Gateway, outside the agent's code: principal from the OAuth token, action from the tool name, tool arguments in context, forbid wins, every decision logged ([docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy.html), [snippet]).
- **OPA decision logs** ([docs](https://www.openpolicyagent.org/docs/management-decision-logs)) [read]: `decision_id`, `path`, `input`, `result`, bundle `revision` (which policy version decided), timestamp, `trace_id`/`span_id`; a masking policy erases sensitive fields before export.
- **Claude Code permissions** ([docs](https://code.claude.com/docs/en/permissions)) [read]: rules evaluated deny, then ask, then allow, first match wins; "enforced by Claude Code, not by the model"; admin-managed settings; `PreToolUse` hooks for custom logic.
- **Microsoft Entra Agent ID** [snippet]: agent identities with accountable owner and sponsor, blueprints that child agents inherit permissions from, disable-the-blueprint kill switch, Conditional Access, and a What-If API to simulate a policy before enforcing it.
- **Anthropic's agent framework** ([2025-08-04](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents)) [read]: human control before high-stakes actions, persistent grants for routine tasks, per-connector access, transparency via an inspectable plan.

### 2.9 UI patterns worth copying
- **Trace tree + timeline + graph:** Langfuse (timeline, agent graph, public trace links), LangSmith run tree, Phoenix, Braintrust span tree. Good for the "Process" view; too low-level to be the primary surface for finance readers.
- **Inline citation with highlighted source span:** the Anthropic Citations output (`cited_text` plus location) is the data you need; the pattern of clicking a claim and landing on the highlighted passage is common in AI search products [memory].
- **PR checks page:** a check with summary, annotations on specific lines and a "Details" link [memory]. This is the closest precedent for your model, since an ECR is a PR (ARCHITECTURE §2).
- **Diff views:** BOM diff and forecast diff already planned; add "since the decision" diffs (see 3.4).
- I did not find a public finance-agent product whose evidence-panel UI I could inspect today.

## 3. Proposed audit trail design (my proposal)

### 3.1 Principles
1. Record artifacts, not narration: hashes, spans, values, rule IDs. Rationale text is stored but tagged `agent_stated`.
2. Everything immutable and content-addressed; "no matter how long ago" means pinning model id, prompt hash, code version, policy version, source snapshot and its as-of date. LLM outputs are stored, never re-derived (matches §8).
3. Enforcement happens in reducers (the only write path), so the trail cannot say "allowed" for something that wasn't.
4. Vocabulary: PROV (used / wasGeneratedBy / actedOnBehalfOf), spans shaped like OTel (`kind` = invoke_agent / execute_tool / plan / code / verify / policy / human).

### 3.2 What gets recorded (tables; names provisional, extend ARCHITECTURE §4)
| Table | Key fields | Purpose |
|---|---|---|
| `AuditStep` | step_id (deterministic hash), run_id (= CheckRun), parent_step_id, seq, kind, actor_kind (agent/subagent/code/human), actor_id, model_id, prompt_hash, input_hash, output_hash, status, started/ended, summary | The trace tree. Sub-agents get their own steps linked via parent (from `parent_tool_use_id`) |
| `SourceSnapshot` | content_hash (PK), system (PLM/ERP/doc/history), locator (ECR id, part no, revision), fetched_at, as_of, text | Content-addressed copy of what the agent saw. Large/binary bodies live outside the DB, only hash + locator inside (all data is in RAM, §9) |
| `Evidence` | evidence_id, step_id, content_hash, locator_kind (char / page / block / row-field), start, end, quote, verified, verify_method | A span the agent relied on. `verified` = code confirmed `text[start:end] == quote` |
| `ToolCall` | step_id, tool, args_json + hash, result hash/ref, error, duration | Plain tool record; raw args/results behind a "show raw" toggle (privacy; OTel flags these as sensitive) |
| `AssumptionUse` | step_id, assumption_id, version, value_hash | Which assumption versions were used. `Assumption` rows already carry source (given / default / agent_estimated) and rationale; add `evidence_id` or `person` as basis |
| `Quantity` | quantity_id, check_run, name, unit, value or p10/p50/p90, formula_id, code_version | Every computed number (links to `CostLine`, `TimelineResult`, `RiskMetric`) |
| `QuantityInput` | quantity_id, input_kind (quantity / assumption / source_field / change), input_ref, input_hash, role | The lineage edges. A number's full derivation is a walk over these |
| `Claim` | claim_id, step_id, text, kind (fact / inference / estimate / recommendation), confidence_label, basis_json | One atomic statement the decision rests on |
| `ClaimLink` | claim_id, ref_kind (evidence / quantity / assumption / claim), ref_id, relation (supports / contradicts / context), warrant_text | Toulmin data and warrant; GSN solution and strategy |
| `Verification` | verification_id, target_kind/id, method (recompute / quote_match / number_lint / nli / llm_judge / human), verifier_actor, result, detail | Independent checks; `annotator_kind`-style |
| `PolicyCheck` | policy_check_id, step_id, principal (seat), action, resource, context_json (amounts, p90s, confidence), policy_id + version hash, effect (allow / require_approval / deny), determining_rules[], reason | Cedar / OPA-shaped record of why an action was allowed or blocked |
| `Decision` | decision_id, run_id, subject (ECR), outcome (auto_approve / recommend_approve / recommend_reject / escalate), confidence_label, confidence_signals_json, rationale (agent_stated), policy_check_id, run_root_hash | The thing a person clicks on |
| `Approval` | decision_id, approver (person or `policy_auto`), at, comment | Who stands behind it; policy forbids approver == author within a run |
| `Policy`, `AutonomyConfig` | seat, action, mode (act / recommend / block), limits_json, version, set_by | Autonomy as data (#24); every change is itself an audited row |

Tamper evidence without append contention: each step stores `this_hash = sha256(canonical(step) + input_hash + output_hash)`; closing a run stores `run_root_hash = sha256(sorted step hashes)` on the `Decision`. Optionally sign it later. Hash in the worker; I did not verify whether a TypeScript module can compute SHA-256, so the reducer only stores and compares.

### 3.3 How each step writes it
- A TypeScript `recorder.step(kind, fn)` wrapper in workers: canonical-JSON hashes inputs and outputs, writes `AuditStep`, attaches `Evidence` / `ToolCall` / `Quantity`. Reuse the canonical-JSON + hash code already needed for check-run keys (§8).
- **Agent evidence capture.** For S0 and gap-filling (structured output needed), give the model a `cite` tool or a schema field `{source_id, quote}`; code locates the quote in the snapshot (exact, then whitespace-normalised), stores offsets, and fails the step if not found. This works where the Citations API cannot (incompatible with structured outputs). Use the Citations API or search-result blocks for free-text answers, e.g. the S5 narration and a "why?" chat, and store `cited_text` plus indices as `Evidence`.
- **Traced numbers.** Compute functions return `{value, inputs[]}` (a small `Traced<T>` type) instead of bare numbers; the recorder flushes these to `Quantity` / `QuantityInput`. S5 receives Quantities, and a **number lint** rejects any figure in narration that is not an allowed Quantity.
- **Policy gate.** `evaluatePolicy(seat, action, resource, context)` is a pure function over `AutonomyConfig` (default deny, deny beats allow, returns determining rules), same shape as Cedar so it can be swapped. Write a `PolicyCheck` row first. The `approve_ecr` reducer refuses an agent caller unless an `allow` check exists for the same `input_hash`. Gate on **upper-tail** values (e.g. p90 cost delta and p90 slip below limit), not p50.
- **Confidence** is a bundle of signals, not a model self-rating: share of variance from `agent_estimated` assumptions (from S5 sensitivity), unverified or low-confidence S0 changes, conflict flags, width of p10 to p90 vs the limit, and agreement across N=3 sampled extractions (consistency reduces overconfidence per Xiong et al.). Verbalized confidence is one input at most.
- **Escalation is a first-class outcome:** it names the question, the person or role, what answer unblocks it, and, when answered, becomes an `Assumption` with `source=person` (no asking twice).
- **Hooks:** if using the Agent SDK, `PreToolUse` / `PostToolUse` hooks are the natural place to write `ToolCall` and `PolicyCheck`; tool-level allow/deny comes from the same config. I confirmed the hook mechanism exists but not its exact payloads.

### 3.4 How a person browses it
Every number and the decision itself has a "Why?" link opening a drawer; every object has a URL, so a lunch-break reader can follow links.
- **Decision**: outcome, confidence signals, who or what approved, policy that allowed it, stale badge if the base hash has moved since.
- **Numbers**: click a p50, see formula, inputs, each input clickable to an assumption (with source tag, rationale, owner, history) or a source field. Amber = `agent_estimated`.
- **Evidence**: source opened at the highlighted span with system, revision and as-of date; red if quote unverified.
- **Reasoning**: GSN-lite tree: decision goal, strategy (the rule or policy), claims with warrants, solutions (evidence, recompute, verifications); "what would change this" shown per claim.
- **Process**: trace tree of steps including sub-agents with timing and tool calls; raw payloads on demand.
- **Policy**: rule(s) and version, who configured the autonomy, approval chain.
- **Replay**: "Recompute from hashed inputs" re-runs the pure checks and shows identical / differs. A diff view compares two runs' lineage.
- **Admin page** (#24): seat x action matrix showing mode and limits, last-30-day counts of auto / recommended / escalated / overridden, and "simulate this policy on past decisions" (Entra What-If idea).

### 3.5 Fit with SpacetimeDB (from the docs read in ARCHITECTURE §9; nothing here has been run)
- Tables public and subscribed by indexed `run_id` / `pr_id` (B-tree index); writes only via narrow reducers (`record_step`, `record_evidence`, `record_quantity`, `record_policy_check`, `record_decision`). No update or delete reducers, so append-only by construction (anyone with database owner access could still alter data, which is a limit of the guarantee).
- Reducers are transactional and may re-execute: make IDs deterministic hashes so writes are idempotent.
- Subscriptions have no aggregates and only two-table joins, so lineage walks happen client-side from `QuantityInput` rows fetched by `check_run`. Fetch heavy payloads lazily (`WHERE hash = ...`) on click.
- Keep source bodies, PDFs and raw payloads out of RAM-resident tables where possible. Max row size: not found in the pages I read.
- Live updates give a good demo: evidence and verification rows appear while the agent runs.
- Privacy: audit rows contain ECR content and tool arguments; ARCHITECTURE §9 already flags possible export-control limits on hosted Maincloud.

## 4. Realistic in about a day versus later

**In a day (priority order; time guesses are mine):**
1. `Traced<T>` lineage for S2/S3/S4 outputs plus `Quantity` / `QuantityInput` rows, and the click-through number view (3 to 4 h).
2. Quote-and-verify evidence for S0 and gap-filling, plus `SourceSnapshot` hashes (2 h).
3. `AutonomyConfig`, `evaluatePolicy`, `PolicyCheck`, reducer gate on auto-approve, simple admin matrix (3 h).
4. `Decision` with confidence signals, escalate outcome, `Approval`; GSN-lite tree rendered from `Claim` / `ClaimLink` as nested list (3 h).
5. "Why?" drawer with Decision, Numbers, Evidence, Process and Policy tabs, deep links (4 to 6 h; the largest item, so cut tabs before cutting 1 to 3).
6. Replay-by-hash button (about 1 h, since checks are already pure) and number lint on S5 (1 h).
7. Planted-error set (answer key) and a measured false-approve / false-escalate rate at the chosen thresholds. Needed for "proof it works" anyway.

**If time remains:** blind verifier agent on S0 changes and `agent_estimated` assumptions (about 2 h); N=3 consistency sampling; per-run root hash shown in the UI.

**Later:** conformal calibration of the auto-approve threshold on a real labelled history; Cedar or OPA behind the same interface; signed or externally anchored run hashes; PROV-JSON and OpenLineage export; OTel export to Langfuse or Phoenix for developer debugging; Entra-style agent identities and owners; override-rate and drift monitoring (COSO); retention, redaction and export-control handling; SOX-style evidence packs; NLI entailment checks at scale.

**Not worth it for the hackathon:** full GSN assurance cases with confidence arguments, C2PA, a vendor tracing product as the user-facing trail.
