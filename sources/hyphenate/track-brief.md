Source: https://hive.hackberkeley.org/api/live/prizes and https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4 | Fetched: 2026-10-23

# Hyphenate track brief (verbatim)

## Prize page entry

Source: https://hive.hackberkeley.org/prizes (data: https://hive.hackberkeley.org/api/live/prizes, entry id sponsor-row-13) | Fetched: 2026-10-23

Title: The Hyphenated Enterprise: Autonomous Systems for Finance (Hyphenate)
Sponsor: Hypenate
Details: Cash prizes of $8000, $5000, $3000 for the top 3 teams; expedited interview process for top 5 teams

Description:

Every submission is judged on the same four questions:

1. Is it real enough? Realistic data, a messy problem, and proof that it works.
2. Would you hire it? For which seats, and would it earn them: limited access, a clean record of its work, and knowing when to ask?
3. Did we see something new? A company, problem or approach we haven't seen made autonomous before.
4. The moment. When it catches what others missed, recovers from something going wrong, or defends a decision when questioned.

Teams should bring a demo video that opens with their moment, a live demo at judging (we may ask them to try a scenario of our own), one line on the seats their system fills, and proof it works: what's real, what's simulated, and how they know.

More details here: CalHacks_Hyphenate_Track

## Linked brief doc: CalHacks_Hyphenate_Track

Source: https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4 (exported via /export?format=md) | Fetched: 2026-10-23 | Embedded image data removed

![][image1]

**CALHACKS 2026 · HYPHENATE TRACK · \$8,000 · \$5,000 · \$3,000 FOR 1ST, 2ND AND 3RD**

# The Hyphenated Enterprise: Autonomous Systems for Finance

Build the system a finance team would bring on board. No finance background needed.

Agents can already take a task off someone's plate when prompted. The frontier is autonomy inside a company: systems that pick up work on their own, across the software and the people that run it, with decisions that are explainable when someone asks and accountable whenever someone looks back.

Finance is where this gets hard fastest. A single refund changes revenue, cash, a customer's balance and next quarter's forecast. Every number has to agree with every other number, and nothing moves without the right person's sign-off.

Pick a company and one corner of its finance team: a few seats that work closely together, like the accountant who applies customer payments and the person who chases the late ones. Then build the autonomous system you'd hire to fill them, and the company it works in: the software it uses, the people it answers to, and the mistakes hiding in its data. Be as imaginative as you like about who the company is (a Formula 1 team, a music festival, a three-person startup, a colony on Mars) and strict about how it works underneath.

## `What makes it hard`

The hard parts usually come from the company around the system:

* **Sources that disagree.** The bank, the ledger and the contract each tell a slightly different story. Acting well means knowing which one to trust, and saying why.

* **Time.** Finance runs for months, not minutes. What happened in March should change what the system does in June.

* **Working with others.** Approvers are busy, colleagues (human or automated) hand work over half done, and the controller sometimes says no. The system has to ask at the right moment and handle the answer.

* **Limits.** No company gives one employee access to everything, and an autonomous system shouldn't get it either. Whoever requests a payment can't be the one who approves it.

* **Explainable and accountable.** Anyone reviewing the system's work should see why it made each call, and every call should trace back to the data, rule or person behind it, no matter how long ago it was made.

## `Sample workflows`

A few of the many functions a finance team runs. Pick a corner of one, or of one that isn't listed. Each line is only an outline: the exceptions and judgment calls that make the work hard are yours to discover, by digging in or by finding the Hyphenate team at our booth or around the venue.

* **Revenue Accounting.** Contracts with bundles, ramps and mid-term amendments become revenue schedules that stay right when a deal changes, from the order to the journal entry.

* **Accounts Receivable.** Invoices go out with the right sales tax, payments come back short, late or bundled together, and someone decides who to chase, how hard, and when a dispute needs a person.

* **Cash & Treasury.** Every bank transaction matched to what it pays for, cash positioned across banks and currencies each morning, and a forecast that updates as actuals land.

* **Accounts Payable.** Bills arrive in every format, approvals stall, and a vendor's bank details change the day before a large payment.

* **Accruals.** Costs for work done but not yet billed get estimated, confirmed with vendors, and reversed when the bill finally arrives.

* **Expenses.** Prepaids, fixed assets, leases, inventory and capitalized R\&D, each spread over the periods it benefits, with depreciation and write-downs that follow policy.

* **Payroll.** Payroll runs and stock grants turned into the right entries every period, by department and entity.

* **Close & Consolidation.** Reconciliations, flux, controls and sign-offs that finalize a month, subsidiaries that roll up cleanly, and auditors' requests answered with evidence from the books.

* **FP\&A.** Budgets, forecasts and budget against actuals, with every variance traced to what drove it, plus margin and pricing analysis the business can act on.

* **Reporting.** Financial statements, management reports, SaaS metrics and board packs, all tied back to one ledger built from every source system.

## `How we judge`

Every submission gets the same four questions.

| Is it real enough? Realistic data, a messy problem, and proof that it works. | Would you hire it? For which seats, and would it earn them: limited access, a clean record of its work, and knowing when to ask? |
| :---- | :---- |
| Did we see something new? A company, problem or approach we haven't seen made autonomous before. | The moment When it catches what others missed, recovers from something going wrong, or defends a decision when questioned. |

## `What to submit`

Judges see hundreds of projects, so put the evidence up front. Along with your code, bring:

* **A demo video** that opens with your moment.

* **A live demo** at judging, running for real. We may ask you to try a scenario of our own.

* **One line** on the seats your system would fill.

* **Proof it works:** what's real, what's simulated, and how you know, whether that's a test set, planted errors with an answer key, or a benchmark score.

## `Workshops`

| Beyond Agentic Harnesses: Engineering the Autonomous Enterprise Online on October 21 \[time\], and in person on October 23 at 7 pm, an hour after hacking starts. Come for a head start on the problems above. |
| :---- |

## `Places to start`

**See it for real.** The platform video and product pages on [hyphenate.ai](https://hyphenate.ai/) show what an autonomous finance system looks like inside a working finance team.

Your system can only show what its world lets it. These free references are a starting point: borrow a schema, run a sandbox as it is, or start from a dataset, and build the rest of the company yourself.

**Sandboxes.** [Stripe](https://docs.stripe.com/sandboxes), [Increase](https://increase.com/documentation/sandbox), [Lago](https://getlago.com/docs/guide/lago-self-hosted/docker), [Odoo](https://hub.docker.com/_/odoo), [ERPNext](https://github.com/frappe/frappe_docker)

**Ledgers.** [Formance Ledger](https://github.com/formancehq/ledger), [Blnk](https://docs.blnkfinance.com/home/install), [TigerBeetle](https://docs.tigerbeetle.com/start/), [Beancount and Fava](https://github.com/beancount/fava)

**Mocks.** [Mockoon](https://github.com/mockoon/mockoon/blob/main/packages/cli/README.md), [Prism](https://github.com/stoplightio/prism), [stripe-mock](https://github.com/stripe/stripe-mock)

**Data.** [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), public GitHub repositories

**Benchmarks.** [AccountingBench](https://x.com/yunyu_l/status/1946261507723173935), [APEX-Accounting](https://huggingface.co/datasets/mercor/apex-accounting), [Finance Agent Benchmark](https://huggingface.co/datasets/vals-ai/finance_agent_benchmark), [DABstep](https://huggingface.co/datasets/adyen/DABstep), [BenchRec](https://www.kaggle.com/datasets/benchmarkteam/benchrec-real-world-cash-reconciliation-dataset), [Invoice Sandbox Benchmark](https://github.com/ciru-ai/invoice-sandbox-benchmark)

**People.** A model can play the approver, the colleague or the auditor.

**Models and frameworks.** Use whatever you like.

## `Key concepts`

* **Double-entry bookkeeping.** Every transaction is recorded as a debit in one account and a matching credit in another, so the books always balance.

* **General ledger.** The company's master record: every entry, sorted into accounts.

* **Chart of accounts.** The list of accounts a company sorts its entries into.

* **Journal entry.** A dated record that moves amounts between accounts, with a reason attached.

* **Subledger.** The detailed records for one area, such as customers, vendors or assets, which roll up into the general ledger.

* **System of record.** The source a company treats as the truth for a given piece of data.

* **Reconciliation.** Confirming that two records of the same thing agree, and explaining any difference.

* **Period close.** Finalizing the books for a month or quarter, after which that period's entries are locked.

* **Materiality.** How large a difference has to be before it matters.

* **Internal controls.** The checks a company puts in place so that mistakes and fraud get caught.

* **Segregation of duties.** No single person, or system, can both start and approve the same action.

* **Audit trail.** A record of who did what, when and why.

* **Controller.** The person who owns the accuracy of the books and signs off on them.

Hyphenate builds autonomous finance. If this is the kind of problem you'd like to work on full time, come talk to us.
