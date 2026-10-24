Source: https://hyphenate.ai/blog/cost-of-revenue-inference-product | Fetched: 2026-10-23

Title: What Belongs in Cost of Revenue When Inference Is the Product | Hyphenate

Author

Team Hyphenate

Co-Founder & CEO, Hyphenate

Details

Read Time: 16 min read

Date: September 1, 2026

# What Belongs in Cost of Revenue When Inference Is the Product

How AI companies classify inference cost decides the gross margin the market sees. Here is where the line sits, and where the accounting is unsettled.

Author

Team Hyphenate

Co-Founder & CEO, Hyphenate

Details

Read Time: 16 min read

Date: September 1, 2026

AI products are increasingly sold by the token, the call, and the outcome. Consumption pricing has grown fast, and every unit a customer consumes runs the model again and bills real compute. That single fact has pulled the cost side of the income statement into focus.

The industry has argued for more than a year about how AI companies recognize revenue. Far less has been said about the debit side. Yet the debit side is where the valuation math now lives. Average gross margin on AI products is projected to reach roughly 52% in 2026, according to ICONIQ's January 2026 State of AI snapshot. That is up from 41% in 2024 and 45% in 2025. That sits well below the 75% to 85% that defined a generation of software.

Inference is the reason. As AI products scale, talent's share of cost falls and model inference rises to become the dominant variable cost. The question few teams have written down is where that inference cost belongs: in cost of revenue, in research and development, or in operating expense. The answer moves the gross margin the market uses to value the company, on cash economics that do not change at all.

## First, a prerequisite question: are you the principal or the agent?

Before any cost classification, settle one thing. For each specified good or service you promise, are you the principal providing it, or an agent arranging for a model provider to supply it? The answer changes everything downstream, and it can differ across the promises in a single contract.

The determination is made per specified good or service, not once for the whole company. Most AI companies are principal on the application layer they build and agent on raw model access they pass through, inside the same contract. Where you control the service before it transfers to the customer, you are the principal for that promise. You report its revenue gross, and the model provider's inference cost sits in your cost of revenue. Where you only arrange access, you are the agent for that promise. Your revenue is the fee or commission you expect to be entitled to, not the gross amount less what you pass through. An agent is not left with nothing to classify. You still incur your own compute, orchestration, routing, guardrails, embeddings, and retrieval, and that stays in cost of revenue against the net fee. Only amounts collected on the provider's behalf net out. Net presentation usually makes gross margin percentage look worse, because a small net revenue number still carries real compute.

Control of the specified good or service is the determinant. Conclude on control first. The indicators are corroboration where control is not obvious, not a checklist to tally. They include primary responsibility for fulfillment, exposure to capacity or inventory risk, and discretion in setting price. Their relevance varies with the nature of the good or service, and they are not weighted or determinative. This is the same analysis the cluster's gross versus net article develops in depth. Settle it first. The rest of this piece assumes you are the principal for the promise in question, and therefore carry a real cost of revenue to classify.

## The classification question nobody wrote down

Start with the stakes. Traditional SaaS assumed gross margins in the 75% to 85% range. AI products carry a heavier cost structure, and inference is the line that reshaped it. On ICONIQ's cost breakdown, model inference reaches about 23% of the AI product cost stack at the general availability and scaling stages. Its share climbs as products mature.

Now watch the lever. Classify production inference as cost of revenue, and it drags on gross margin. That drag is part of why the blended benchmark sits near 52% rather than the old SaaS range. Move a meaningful slice of that inference into research and development or operating expense. The reported gross margin then drifts back up toward a number the business no longer earns. The cash burn is identical either way. Only the classification changed.

That gap is not a rounding difference. It is one gross margin story versus another, on the same company. It also breaks comparison across the industry. One company puts guardrail inference in cost of revenue. Another buries it in R&D. Cross-company "AI gross margin" numbers then stop meaning the same thing. The penalty for getting it wrong is not a fee. It is a restatement, a credibility problem with investors, or a diligence process that unwinds when the buyer recomputes margin on a consistent basis.

## The default classification framework, without false absolutes

There is a defensible default here, as long as it is stated as a set of conditions rather than a rule. The recurring judgment is separating production spend that serves paid customers from everything else.

  * **Production inference that serves paid customer traffic is cost of revenue.** The principle mirrors hosting. Production compute that delivers the paid product is a cost of revenue whether it runs on general cloud infrastructure or on a model provider's API.
  * **Inference for internal tools is an operating expense.** Usage by engineering, sales, or marketing is classified by the function that consumes it, not lumped with the product.
  * **Model training and pretraining are generally research and development.** Under ASC 730, research and development costs are expensed as incurred. ASC 730 has no capitalization criteria to meet. If a cost is instead software development, it leaves ASC 730 entirely for ASC 985-20 or ASC 350-40, which is a different analysis. Most companies do not pretrain.
  * **Fine-tuning depends on purpose.** Fine-tuning that improves a deployed, paid feature generally follows that feature into cost of revenue. Fine-tuning for research generally sits in R&D. Customer-specific fine-tuning sold as a paid service is generally cost of revenue.
  * **Evaluation, prompt engineering, and developer tooling generally sit in R &D or operating expense.** There is one exception the reader must not miss. Guardrail or evaluation inference that runs in the production request path, on live paid customer traffic, is cost of revenue like any other production inference.
  * **Retrieval indexing and embeddings follow the same test.** Serving paid customer traffic points to cost of revenue. Internal or research use points elsewhere.

The test is where the inference runs and whom it serves, not the label on the workload. That separation, not the name, is what an auditor will probe. It cuts both ways. Push production inference out of cost of revenue, and you overstate margin. Sweep research-stage training into cost of revenue, and you understate it. Both are classification errors.

## Capitalizing software costs: the right standard, and what just changed

Some AI teams capitalize software development costs. If you do, the first job is to apply the correct standard, because two different ones exist and they are not interchangeable.

ASC 985-20 governs software to be sold, leased, or marketed. It uses a technological-feasibility threshold. Costs before technological feasibility are research and development and are expensed. Costs after it are capitalized until general release. ASC 350-40 governs internal-use software, which includes software built to run a hosted service a customer cannot take possession of. It does not use technological feasibility at all.

### What ASU 2025-06 changed

In September 2025, the FASB issued ASU 2025-06, which removes the old project-stage model from ASC 350-40. The prior model capitalized application-development-stage costs and expensed the preliminary and post-implementation stages. The amendment replaces those stage labels with two conditions. Capitalization begins when management has authorized and committed to funding the project, and when completion is probable, and the software will perform its intended function. Where significant development uncertainty exists, for example, novel or unproven functionality not yet resolved through coding and testing, that probable-to-complete threshold is not met. The amendment is effective for fiscal years beginning after December 15, 2027, with early adoption permitted, and it does not change ASC 985-20.

The practical point for an AI company is narrow and important. Confirm which standard applies to the software in question, then apply that standard's actual criteria. Do not import ASC 985-20's technological-feasibility language into an ASC 350-40 analysis.

## Where the accounting is genuinely unsettled: model weights

Honesty is the right posture on one question. Whether a trained model's weights are "software" under either standard is not settled. The standards predate large trained models, the FASB has not addressed the question directly, and practice varies.

There are considerations on each side. Weights can look like the output of a development process that resembles internal-use software. They can also look closer to the result of research whose future benefit is uncertain. Neither reading is authoritative today. A company taking a position should document its reasoning and consult its auditor. There is no clean capitalization rule for model weights to state, because one does not exist.

## Reserved capacity and committed compute: the balance sheet questions

AI companies increasingly sign multi-year, take-or-pay compute commitments that dwarf current revenue. Two accounting questions follow.

### The prepayment question

This one is straightforward. A prepayment for compute creates an asset that is drawn down into cost of revenue as capacity is consumed. Committed-but-unused capacity then raises an expense-or-impairment question that has to be assessed against the facts. Impairment follows an order. Any impairment under other standards, inventory under ASC 330 for example, is taken first. The capitalized contract cost test under ASC 340-40 comes next. Asset-group impairment under ASC 360 and ASC 350 comes last. Testing ASC 340-40 on its own, out of that order, gets the answer wrong.

### The embedded-lease question

This one has two limbs, not one. A compute arrangement contains a lease under ASC 842 only if both are true. First, there is an identified asset. That fails if the supplier holds a substantive right to substitute the asset. A substitution right is substantive when the supplier can swap the asset throughout the period of use and benefits economically from doing so. Second, the customer controls the identified asset's use. Control means the right to direct how the asset is used, plus the right to obtain substantially all of its economic benefits.

For most GPU and cloud arrangements, it is these two limbs that defeat lease treatment. The provider usually keeps the right to substitute hardware and to direct how the fleet runs, so the customer holds capacity, not a controlled asset. A dedicated arrangement is different. One that names specific hardware, forecloses substitution, and lets the customer direct its use can tip the other way and belong on the balance sheet. The practical step is to ask the provider for the substitution and dedication language. That language, not the size of the commitment, drives the conclusion.

## Loss-making arrangements: what US GAAP actually provides

A common overstatement needs correcting. It is true that US GAAP has no general onerous-contract provision like the one in IAS 37. A company generally does not book a loss in advance of performance simply because a customer contract is unprofitable. But US GAAP is not silent on losses, and the specific models can reach an AI cost base.

Firm purchase commitments for inventory can require loss recognition under ASC 330, where the commitment relates to inventory. Capitalized contract costs must be tested for impairment under ASC 340-40. That impairment is recognized when the carrying amount exceeds the consideration the company still expects to receive, less the remaining costs to deliver. Loss contingencies are recognized under ASC 450-20 when a loss is probable and reasonably estimable. Long-term construction- and production-type contracts carry their own loss guidance as well.

For a take-or-pay compute commitment, the relevant questions are specific. Does any portion meet a firm-purchase-commitment loss test? Are related capitalized costs impaired? Has a loss contingency become probable and estimable? The takeaway is simple. The absence of an IAS 37-style provision is not the absence of loss accounting. Each of these models should be checked against the facts.

## Reading gross margin by cohort: a management-reporting question

This is a management-reporting and unit-economics question, not a financial-reporting rule. US GAAP has no general matching principle that forces cost into the revenue period. Compute cost is expensed as incurred, and prepaid compute draws down as capacity is consumed, which is the treatment set out above. Those usually line up with the revenue, but they diverge when committed capacity expires unused. For gross margin by cohort to be meaningful to the board, the cost view has to line up with the revenue view. That is where consumption pricing creates a trap.

When revenue is recognized on consumption but compute is prepaid and amortized straight-line, the reported margin swings. It looks stronger in some periods and weaker in others than the underlying economics justify. The fix is a reporting one, not a change to the GAAP entries. For the management view, tag compute cost to the customer or cohort that generated the revenue, and present the two together in the same period. Where compute runs in a shared pool, allocate on actual usage rather than on headcount or on revenue share.

## The declining cost curve: who captures the efficiency?

There is a real open question worth putting to the board, framed as a question rather than a rule. As a system handles the same kinds of work repeatedly, the team optimizes models, caching, and prompts. The cost to produce a unit of output then tends to fall over the life of a deployment. Where does that efficiency land?

Walk three outcomes and the margin story each produces. In the first, the vendor keeps the efficiency, and gross margin expands over the contract, which holds only while competition and renewals allow it. In the second, a contractual pass-through lowers the customer's rate as unit cost falls, holding margin percentage roughly steady while margin dollars track volume. In the third, a hybrid, the vendor keeps the gains up to a threshold and then passes them through in rate-card revisions. That hybrid is the most common real-world pattern.

For each, the board needs one thing made clear. Do current margins represent steady state, or a moving cost base? The underlying cost-decline dynamics are still being characterized across the industry, so present them as observed patterns rather than settled fact.

## A five-question diagnostic for AI cost classification

Run these five questions against your own numbers. The point is not the label. It is whether each conclusion is documented and could survive an audit.

**Question**| **What a strong answer looks like**  
---|---  
Have you settled principal versus agent for each promise, and documented the conclusion?| The conclusion rests on who controls the service before transfer, reached per promise, with indicators used only as corroboration. It is in writing.  
What share of AI spend is classified as cost of revenue today, and is the methodology written down and reviewed by the auditor?| A documented methodology exists, and the auditor has seen it.  
Can you separate production paid-customer inference from internal, trial, and evaluation workloads?| Spend is split at the account or tag level, not estimated after the fact.  
For any capitalized software cost, which standard applies, and are you applying that standard's actual criteria?| The applicable standard is identified, and its own criteria are applied, not the other standard's.  
Do any compute commitments name dedicated hardware or foreclose substitution?| Each commitment has a documented embedded-lease screen, driven by the contract language.  
  
## A CFO's action plan for AI cost classification

**This week:** Settle principal versus agent for each promise in the core AI offering, or confirm the existing conclusion, because everything downstream depends on it. Separately, split production and development provider accounts so paid-customer inference is not commingled with internal and test usage. Output: a per-promise principal or agent conclusion and a clean account split. Decision gate: if any promise's status is unclear, stop and resolve it before classifying anything.

  * **Weeks 1 to 4:** Tag every AI spend line by workload. The categories are production paid-customer inference, internal tools, training, fine-tuning, evaluation, and retrieval. Map each to the framework, with attention to production-path evaluation and guardrail inference that belongs in cost of revenue. Output: a tagged spend map. Decision gate: any untagged spend over your materiality threshold is not ready to report.
  * **Weeks 5 to 8:** Write the classification methodology into a memo the auditor can review. Include the principal-versus-agent conclusion, the standard applied to any capitalized software, and the embedded-lease screen for compute commitments. Flag model-weight treatment as an open area with your documented position. Output: a reviewable methodology memo. Decision gate: no capitalized software cost proceeds without its standard named.
  * **Weeks 9 to 12:** Stand up a cost-per-unit metric, whether cost per token, per resolution, or per call, alongside revenue per unit. Begin tracking the unit-cost trend. Output: a unit-economics view for the board. Decision gate: if margin cannot be explained as steady state or a declining cost base, the board sees the uncertainty, not a smoothed number.

## Where this leaves the finance team

When the revenue side runs on its own, from recognition through close, the finance team gets its attention back for exactly this kind of work. The classification memo, the principal-versus-agent conclusion, the embedded-lease screen, and the margin analysis the board keeps asking about all need judgment, not data assembly. Hyphenate runs the recognition and close workflows. The CFO can then spend that judgment on the gross margin questions that decide how the company is valued. The numbers no longer have to be built by hand.

See where the classification line falls on your own numbers. [Book a walkthrough.](https://hyphenate.ai/book-demo)

[](https://hyphenate.ai/guide/usage-based-rev-rec)

## Frequently asked questions

### Is AI inference cost of goods sold or an operating expense?

Production inference that serves paid customer traffic is generally cost of revenue. The same principle treats production hosting compute as a cost of delivering the product. Inference for internal tools is an operating expense, classified by the function that uses it. The determining test is where the inference runs and whom it serves, not the workload's label.

### Are you the principal or the agent when reselling model inference?

It depends on whether you control the specified good or service before it transfers to your customer, assessed per promise, not per company. Where you control it, you are the principal, revenue is gross, and the provider's inference cost is your cost of revenue. Where you only arrange access, you are the agent, and your revenue is the fee you expect to be entitled to. Even then, you carry your own compute, orchestration, routing, guardrails, retrieval, and cost of revenue against that fee. Only amounts collected on the provider's behalf net out.

### Does ASC 350-40 use technological feasibility to capitalize software?

No. Technological feasibility belongs to ASC 985-20, which governs software to be sold, leased, or marketed. ASC 350-40 governs internal-use software and never used that threshold. ASU 2025-06, issued in September 2025, further removed the old project-stage model from ASC 350-40 and replaced it with an authorization-and-probable-completion test.

### Can a committed GPU or compute contract be an embedded lease?

It can, but only if two conditions are met. There must be an identified asset, which fails when the supplier can substantively substitute the hardware. And the customer must control the asset's use, meaning it can direct that use and obtain substantially all the economic benefits. Most shared cloud and GPU arrangements fail one or both, while a dedicated, no-substitution arrangement can qualify.

### Does US GAAP require a loss on an unprofitable AI contract?

Not through a general onerous-contract provision, which US GAAP does not have. It does have specific models that can apply. Those include inventory firm-purchase-commitment losses, impairment of capitalized contract costs, and loss contingencies when a loss is probable and estimable. Each is assessed against the facts rather than applied automatically.

### Should training and fine-tuning be classified differently from inference?

Usually, yes. Model training and pretraining are generally research and development, expensed as incurred under ASC 730. Fine-tuning follows its purpose, so fine-tuning that improves a paid feature generally goes to cost of revenue, while research fine-tuning stays in R&D. Production inference that serves paid customers is the clearest cost-of-revenue case.

From The Blog

Related Articles

Loading posts...
