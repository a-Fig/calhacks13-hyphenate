# Hyphenate Track

"The Hyphenated Enterprise: Autonomous Systems for Finance", Cal Hacks 13.0. Checked against the live prize page, Devpost and Hyphenate's own brief on Oct 23, 2026, 22:25 PT.

## Prizes

From the Cal Hacks prize page (hive.hackberkeley.org/prizes, data updated Oct 23, 21:55 PT), verbatim:

> Cash prizes of $8000, $5000, $3000 for the top 3 teams; expedited interview process for top 5 teams

Devpost lists three Hyphenate prizes (1st $8,000, 2nd $5,000, 3rd $3,000 in cash, 1 winner each) with the same line. The "Meet Hyphenate" email from Cal Hacks (Oct 16) adds that the prizes are per team and that in the top 5 teams "every member gets an expedited, shortened interview for internships and full-time roles".

## Judging, as posted on the prize page

Verbatim:

> Every submission is judged on the same four questions:
>
> 1. Is it real enough? Realistic data, a messy problem, and proof that it works.
> 2. Would you hire it? For which seats, and would it earn them: limited access, a clean record of its work, and knowing when to ask?
> 3. Did we see something new? A company, problem or approach we haven't seen made autonomous before.
> 4. The moment. When it catches what others missed, recovers from something going wrong, or defends a decision when questioned.
>
> Teams should bring a demo video that opens with their moment, a live demo at judging (we may ask them to try a scenario of our own), one line on the seats their system fills, and proof it works: what's real, what's simulated, and how they know.

## What judges want, in short

- A real-feeling company with messy data. Sources that disagree (bank vs ledger vs contract), history that matters (March changes June), planted mistakes.
- A system you'd actually hire for named seats. Limited access, segregation of duties (the requester can't approve), a clean record of every action, and asking a person at the right moment.
- Something new. A company, problem or approach they haven't seen made autonomous.
- One clear "moment" where it catches what others missed, recovers from an error, or defends a decision when questioned. The demo video opens with it.
- Evidence up front. Say what's real and what's simulated, and prove it works with a test set, planted errors with an answer key, or a benchmark score.
- It runs live at judging, and may be given a Hyphenate scenario on the spot.

Cal Hacks' general judging also applies. Devpost lists Application, Intentionality, Functionality, Creativity and Technical Complexity. See [hackathon-logistics.md](hackathon-logistics.md).

## Hyphenate events

| When (PT) | What | Where |
|---|---|---|
| Wed Oct 21, 18:00 | Pre-hackathon workshop on Zoom (company, culture, head recruiter, track breakdown, office hours). Already happened. | Zoom |
| Fri Oct 23, 19:00-20:00 | Hyphenate Workshop, "Beyond Agentic Harnesses: Engineering the Autonomous Enterprise" | No room on the live schedule. The Oct 16 email said the Theater. |
| Sat Oct 24, 12:00-14:00 | Invite-only lunch with founding engineers, class of 2027 only, by application | From the Oct 16 email, not on the live schedule |
| Sat Oct 24, 14:00-15:30 | Hyphenate Mixer (boba and cookies, open to everyone) | Gate 6 |
| All weekend | Hyphenate booth, track help and job chats | Venue |

The Oct 16 email gave the mixer as 14:00-16:00. The live schedule says 14:00-15:30.

Workshop description from the live schedule, verbatim:

> Beyond Agentic Harnesses: Engineering the Autonomous Enterprise
>
> Harnesses made agents capable; the frontier is making them autonomous inside the systems and teams that run a company. We've been doing it in finance, where a single economic event can ripple across a dozen systems and people, and every decision has to stand up to scrutiny long after it's made. We'll take apart how: designing the environment an autonomous system acts in, keeping state across long horizons, orchestrating agents and humans as one team, and building in permissions and traceability from day one. It's hands-on and interactive, so bring a laptop and build along. You'll leave with a blueprint for autonomous systems an enterprise team would bring on board, and a head start on our track.

## Full track brief, verbatim

Hyphenate's own brief (Google Doc "CalHacks_Hyphenate_Track", linked from the prize page). Text unchanged, formatting added.

> CALHACKS 2026 · HYPHENATE TRACK · $8,000 · $5,000 · $3,000 FOR 1ST, 2ND AND 3RD

### The Hyphenated Enterprise: Autonomous Systems for Finance

Build the system a finance team would bring on board. No finance background needed.

Agents can already take a task off someone's plate when prompted. The frontier is autonomy inside a company: systems that pick up work on their own, across the software and the people that run it, with decisions that are explainable when someone asks and accountable whenever someone looks back.

Finance is where this gets hard fastest. A single refund changes revenue, cash, a customer's balance and next quarter's forecast. Every number has to agree with every other number, and nothing moves without the right person's sign-off.

Pick a company and one corner of its finance team: a few seats that work closely together, like the accountant who applies customer payments and the person who chases the late ones. Then build the autonomous system you'd hire to fill them, and the company it works in: the software it uses, the people it answers to, and the mistakes hiding in its data. Be as imaginative as you like about who the company is (a Formula 1 team, a music festival, a three-person startup, a colony on Mars) and strict about how it works underneath.

### What makes it hard

The hard parts usually come from the company around the system:

- Sources that disagree. The bank, the ledger and the contract each tell a slightly different story. Acting well means knowing which one to trust, and saying why.
- Time. Finance runs for months, not minutes. What happened in March should change what the system does in June.
- Working with others. Approvers are busy, colleagues (human or automated) hand work over half done, and the controller sometimes says no. The system has to ask at the right moment and handle the answer.
- Limits. No company gives one employee access to everything, and an autonomous system shouldn't get it either. Whoever requests a payment can't be the one who approves it.
- Explainable and accountable. Anyone reviewing the system's work should see why it made each call, and every call should trace back to the data, rule or person behind it, no matter how long ago it was made.

### Sample workflows

A few of the many functions a finance team runs. Pick a corner of one, or of one that isn't listed. Each line is only an outline: the exceptions and judgment calls that make the work hard are yours to discover, by digging in or by finding the Hyphenate team at our booth or around the venue.

- Revenue Accounting. Contracts with bundles, ramps and mid-term amendments become revenue schedules that stay right when a deal changes, from the order to the journal entry.
- Accounts Receivable. Invoices go out with the right sales tax, payments come back short, late or bundled together, and someone decides who to chase, how hard, and when a dispute needs a person.
- Cash & Treasury. Every bank transaction matched to what it pays for, cash positioned across banks and currencies each morning, and a forecast that updates as actuals land.
- Accounts Payable. Bills arrive in every format, approvals stall, and a vendor's bank details change the day before a large payment.
- Accruals. Costs for work done but not yet billed get estimated, confirmed with vendors, and reversed when the bill finally arrives.
- Expenses. Prepaids, fixed assets, leases, inventory and capitalized R&D, each spread over the periods it benefits, with depreciation and write-downs that follow policy.
- Payroll. Payroll runs and stock grants turned into the right entries every period, by department and entity.
- Close & Consolidation. Reconciliations, flux, controls and sign-offs that finalize a month, subsidiaries that roll up cleanly, and auditors' requests answered with evidence from the books.
- FP&A. Budgets, forecasts and budget against actuals, with every variance traced to what drove it, plus margin and pricing analysis the business can act on.
- Reporting. Financial statements, management reports, SaaS metrics and board packs, all tied back to one ledger built from every source system.

### How we judge

Every submission gets the same four questions.

**Is it real enough?**  
Realistic data, a messy problem, and proof that it works.

**Would you hire it?**  
For which seats, and would it earn them: limited access, a clean record of its work, and knowing when to ask?

**Did we see something new?**  
A company, problem or approach we haven't seen made autonomous before.

**The moment**  
When it catches what others missed, recovers from something going wrong, or defends a decision when questioned.

### What to submit

Judges see hundreds of projects, so put the evidence up front. Along with your code, bring:

- A demo video that opens with your moment.
- A live demo at judging, running for real. We may ask you to try a scenario of our own.
- One line on the seats your system would fill.
- Proof it works: what's real, what's simulated, and how you know, whether that's a test set, planted errors with an answer key, or a benchmark score.

### Workshops

**Beyond Agentic Harnesses: Engineering the Autonomous Enterprise**

Online on October 21 [time], and in person on October 23 at 7 pm, an hour after hacking starts. Come for a head start on the problems above.

### Places to start

See it for real. The platform video and product pages on hyphenate.ai show what an autonomous finance system looks like inside a working finance team.

Your system can only show what its world lets it. These free references are a starting point: borrow a schema, run a sandbox as it is, or start from a dataset, and build the rest of the company yourself.

- Sandboxes. Stripe, Increase, Lago, Odoo, ERPNext
- Ledgers. Formance Ledger, Blnk, TigerBeetle, Beancount and Fava
- Mocks. Mockoon, Prism, stripe-mock
- Data. SEC EDGAR, public GitHub repositories
- Benchmarks. AccountingBench, APEX-Accounting, Finance Agent Benchmark, DABstep, BenchRec, Invoice Sandbox Benchmark
- People. A model can play the approver, the colleague or the auditor.
- Models and frameworks. Use whatever you like.

### Key concepts

- Double-entry bookkeeping. Every transaction is recorded as a debit in one account and a matching credit in another, so the books always balance.
- General ledger. The company's master record: every entry, sorted into accounts.
- Chart of accounts. The list of accounts a company sorts its entries into.
- Journal entry. A dated record that moves amounts between accounts, with a reason attached.
- Subledger. The detailed records for one area, such as customers, vendors or assets, which roll up into the general ledger.
- System of record. The source a company treats as the truth for a given piece of data.
- Reconciliation. Confirming that two records of the same thing agree, and explaining any difference.
- Period close. Finalizing the books for a month or quarter, after which that period's entries are locked.
- Materiality. How large a difference has to be before it matters.
- Internal controls. The checks a company puts in place so that mistakes and fraud get caught.
- Segregation of duties. No single person, or system, can both start and approve the same action.
- Audit trail. A record of who did what, when and why.
- Controller. The person who owns the accuracy of the books and signs off on them.

Hyphenate builds autonomous finance. If this is the kind of problem you'd like to work on full time, come talk to us.

hyphenate.ai

