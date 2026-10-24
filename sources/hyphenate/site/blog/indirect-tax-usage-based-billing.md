Source: https://hyphenate.ai/blog/indirect-tax-usage-based-billing | Fetched: 2026-10-23

Title: The Tax Liability Accumulating While Nobody Is Looking | Hyphenate

Author

Team Hyphenate

Co-Founder & CEO, Hyphenate

Details

Read Time: 12 min read

Date: September 7, 2026

# The Tax Liability Accumulating While Nobody Is Looking

Most AI companies sell for months before anyone asks whether inference is taxable. Here is the exposure and how to scope it without guessing.

Author

Team Hyphenate

Co-Founder & CEO, Hyphenate

Details

Read Time: 12 min read

Date: September 7, 2026

Most AI companies sell for months, sometimes well past a year, before anyone inside asks a basic question. Is the product taxable? By the time it comes up, the unrecorded liability has been compounding since the first invoice. It does not go away because nobody was looking.

Consumption pricing is what makes this urgent now. Token, credit, and outcome-based billing does not map cleanly onto categories that most states wrote for tangible goods and, later, for subscription software. The same product can be taxable in one state and exempt in the next. A company that is not collecting is often making an implicit election simply by staying quiet.

The ground is moving under the question too. In the last two years, Louisiana, Maryland, Washington, Maine, and Utah have each widened sales tax to reach more digital and technology services. The list runs from data processing and custom software to streaming and digital subscriptions. The direction is expansion, not retreat, and AI billing models sit squarely in the path.

This is not a tax manual. It is a CFO-level read on the shape of the exposure and the steps to scope it. It treats classification as the state-specific, overlapping question it actually is.

## Why "is our product taxable" has no single answer

States do not share one taxonomy. Some tax software as a service. Some tax it as a data processing service. Some tax it as an information service. Some do not tax it at all.

These categories are not mutually exclusive from one state to the next. In Texas, for example, software as a service is taxed as a data processing service. So "is it SaaS or data processing" is the wrong question there, because it is both. Under the state's data processing rule, 20% of the charge is exempt, and the remaining 80% is taxable.

The consequence is practical. Classification is a state-by-state determination, not one global label, and a decision tree that treats these categories as universal branches will produce wrong answers. A few states have started to address AI-specific offerings directly. Most have not. Where a state is silent, non-collection is itself a position the state can later challenge, so silence is not the same as exemption.

Your task is not to find one label for the product. It is to build a classification per state, for the states that matter most.

## A classification you build state by state

Run the same short method for each of your top revenue states, starting with the states where the most revenue lands.

First, identify how the state characterizes cloud-delivered software and services. The options are software as a service, a data processing service, an information service, a digital automated service, or a non-taxable service. Second, determine whether your specific offering, whether that is API access, token consumption, or agent execution, fits that characterization. Third, note the taxable base, because some states tax the full charge and others tax a defined portion. Fourth, where the state has no AI-specific guidance, record it as an open position rather than an assumed exemption.

The reason the method matters is visible the moment you line up a few states side by side.

**State**| **Typical treatment of cloud-delivered software and services**| **Taxable base**  
---|---|---  
Texas| Taxed as a data processing service| 80% of the charge  
Washington| Taxed, including as a digital automated service| Full charge  
California| Treated as a non-taxable service| None  
Florida| Treated as a non-taxable service| None  
  
Four states, four answers, one product. This is why the label has to be built per state, and why a national default of either taxable or exempt is wrong. Treatments also change, so the table is a snapshot to verify at the time of filing, not a permanent map.

## Prepaid credits, the taxable event, and the escheatment trap

When a customer buys a credit pack, the taxable event may be the sale of the credits or the later consumption. It depends on whether the state treats the credits as a stored-value instrument or as advance payment for a taxable service. The characterization drives the rate applied, if rates move between purchase and use, and the sourcing, if the customer's location changes.

There is a second, quieter exposure in the same place. Even the unused balance is not free revenue. A company may recognize the portion customers are not expected to redeem, called breakage. It books that amount in proportion to actual usage, not in a lump at sale. And if a state's unclaimed-property law requires the unused balance to be remitted, that amount stays a liability owed to the state. It is never breakage revenue. Booking escheatable balances as breakage overstates revenue and understates the liability at the same time.

You can spot the exposure in how expired credits are treated in the ledger. Check whether any state remittance obligation has been assessed at all. Dormancy periods vary by state, commonly three to five years, and some states exempt these balances entirely. The practical step: **get a written position** on credit-pack characterization and escheatment exposure for your top revenue states, because the two questions interact.

## Economic nexus, stated precisely

Since the 2018 Wayfair decision, every state that imposes a sales tax has an economic nexus law. The thresholds are not uniform, and the transaction-count prong is receding. Most states use a $100,000 sales threshold. California and Texas sit at $500,000. Alabama and Mississippi sit at $250,000. New York is the outlier, requiring both a $500,000 sales test and more than 100 transactions at the same time.

The 200-transaction count that once rode alongside the dollar test has been repealed in more than half the states. Roughly 16 to 18 still apply a transaction threshold as of 2026, and the number keeps falling. That still matters for a high-volume, low-dollar billing model. In a state that retains the count, a self-serve product with many small charges can cross the transaction threshold first. It crosses well before the dollar threshold, creating a registration obligation on modest revenue. The measurement window matters as much as the number. Most states look at the current or prior calendar year. A sale that tips you over in one month can backdate the obligation to earlier in the year.

The practical step: **pull a state-by-state report** of both sales and transaction counts. Compare each state to its actual current threshold, not to a single assumed number.

## When the marketplace owes the tax, not you

Every state that imposes a sales tax now has a marketplace-facilitator law. Under it, the marketplace, not the seller, collects and remits tax on facilitated sales. Many AI companies sell through cloud marketplaces. For those sales, the marketplace may carry the collection obligation, which can materially reduce direct exposure in the states where those sales occur.

This is one of the first questions to ask, because it changes the shape of the liability. It does not erase it. Direct sales, registrations, and filings remain the seller's responsibility even where a marketplace collects. Record marketplace-collected tax separately from tax you owe, so the same dollar is never remitted twice. The practical step: **determine what share of revenue** flows through cloud marketplaces versus direct billing. Confirm in writing which party collects on the marketplace channel.

## Bundled invoices and the true-object test

When one invoice combines a potentially exempt platform subscription with potentially taxable usage, treatment depends on the state. Some apply a true-object test, where taxability follows the primary purpose of the transaction. Others tax line items separately. In a true-object state, a single taxable component can make the whole invoice taxable.

The exposure is easy to spot: any invoice that mixes a flat platform fee with metered usage on one line. The practical fix is a billing change. **Separate taxable and exempt components** onto distinct line items, supported by contract language that reflects the separation.

## Exemption certificates when there is no sales conversation

Product-led companies onboard thousands of customers through self-serve flows with no contract review. Yet in a state where the service is taxable, the company must either collect tax or hold a valid exemption certificate. Most self-serve checkouts capture neither.

The practical minimum: **add an exemption-certificate step** to the checkout flow for taxable states, and retain certificates centrally in an audit-ready format.

## Cross-border: VAT, GST, and withholding

Most jurisdictions with a value-added or goods-and-services tax apply it on a destination basis to electronically supplied services. The company may need to charge and remit in the customer's jurisdiction. For business customers, reverse-charge mechanisms often shift the accounting to the customer, so a non-resident seller frequently charges nothing and needs no local registration there. Consumer sales are different. They may require local registration or a simplified scheme, such as the EU One Stop Shop or a UK registration.

There is a separate risk worth naming. Some jurisdictions treat cross-border fees for software, cloud access, or technical services as royalties or fees for technical services, which can carry withholding tax. Whether it applies, and at what rate, depends on the destination country's domestic law and any applicable tax treaty. This is one to scope with advisors, not to answer with a default assumption.

Three requirements anchor the work: **destination determination** with adequate location evidence, correct business-versus-consumer classification, and use of the simplified registration schemes where they are available. Location generally needs two non-contradictory pieces of evidence, such as billing address and payment details.

## When exposure surfaces: reserves and voluntary disclosure

When historical exposure comes to light, it is a liability, not a footnote. Where a past-due obligation is probable and can be reasonably estimated, it belongs on the books as an accrual. It should not sit off the books until a state notices. Public companies carry this under loss-contingency accounting.

On remediation, there are three paths. The company can begin prospective compliance and accept retroactive-assessment risk. It can pursue a voluntary disclosure agreement to limit the look-back and reduce penalties. Or it can register and file retroactively. Voluntary disclosure agreements are commonly the first tool. They typically cap the look-back at three to four years and waive penalties, though interest usually still applies. One caution matters here. That limited look-back generally is not available where a company collected tax but never remitted it. That is a more dangerous position than never collecting at all.

The practical recommendation: the CFO does not need to become a multistate tax expert. Engage a firm that specializes in multistate indirect tax, and authorize voluntary disclosure filings in the priority states.

## A CFO's plan for scoping indirect tax exposure

**This week.** Pull a state-by-state report of sales and transaction counts, and compare each state to its actual 2026 threshold. Separately, determine what share of revenue runs through cloud marketplaces, since that channel may already be collecting.

**Weeks 1 to 4.** For the top revenue states, build a per-state classification of the product. The buckets are software as a service, data processing, information service, digital automated service, or non-taxable. Note the taxable base in each, and flag states with no AI-specific guidance as open positions.

**Weeks 5 to 8.** Get written positions on credit-pack characterization and escheatment exposure for the priority states. Confirm marketplace-facilitator collection responsibility in writing for the marketplace channel.

**Weeks 9 to 12.** Engage a multistate indirect tax firm to evaluate voluntary disclosure eligibility for states with historical exposure. Add exemption-certificate capture to the self-serve flow. Separate taxable and exempt components on bundled invoices.

Each phase produces an artifact and a decision gate before the next: a nexus map, a per-state classification, written positions, and a remediation plan. Nothing moves to remediation until the map and the classifications are in hand.

The pattern here is not unique to tax. It is what happens to any obligation that has no owner while the team is buried producing the numbers. The exposure does not announce itself. It compounds in the gap between how the product is billed and how it should be taxed. Then it surfaces on someone else's schedule, usually a state's.

When recognition, cash application, and the close run on their own, the finance team recovers the capacity to scope quiet exposures like indirect tax.

[See Hyphenate on your own numbers](https://hyphenate.ai/book-demo) right away.

[](https://hyphenate.ai/guide/usage-based-rev-rec)

## Frequently asked questions

## Is SaaS or AI software taxable for US sales tax?

It depends on the state. There is no federal sales tax. States classify cloud-delivered software differently: as a data processing service, a digital product, an information service, or a non-taxable service. As of 2026, roughly two dozen jurisdictions tax some form of software as a service. The same product can be taxable in one state and exempt in another, so taxability is determined state by state.

## How is SaaS taxed in Texas?

Texas taxes software as a service as a data processing service. Under the state's data processing rule, 20% of the charge is exempt, and the remaining 80% is taxable at the applicable state and local rate. The classification means the question in Texas is not whether the product is SaaS or data processing. It is treated as both.

## What triggers economic nexus for a high-volume AI billing model?

Economic nexus is triggered when in-state sales, and in some states a separate transaction count, cross a threshold. Most states use $100,000 in sales, and a few sit higher. A minority still count transactions. A self-serve product with many small charges can cross a transaction-count threshold well before the dollar threshold, creating a registration obligation on modest revenue.

## Do cloud marketplace sales shift the sales tax obligation?

They may. Every state with a sales tax has a marketplace-facilitator law that can move collection and remittance to the marketplace for facilitated sales. If a share of revenue flows through a cloud marketplace, that channel may already be collecting. The seller still owns direct sales, registrations, and filings, so confirm in writing which party collects on each channel.

## Can unused prepaid credits be recognized as revenue if they must be escheated?

No. If a state's unclaimed-property law requires unused credits to be remitted to the state, that amount is a liability owed to the state, not revenue. Recognizing escheatable balances as breakage overstates revenue and understates the liability. Amounts the company expects to keep can be recognized as breakage, in proportion to actual usage.

## What is a voluntary disclosure agreement for sales tax?

A voluntary disclosure agreement is a program that lets a company come forward on unpaid tax before a state finds it. In exchange, the state typically limits the look-back to three to four years and waives penalties, though interest usually still applies. The limited look-back generally is not available where a company collected tax but never remitted it.

From The Blog

Related Articles

Loading posts...
