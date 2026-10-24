Source: https://everyspec.com/MIL-HDBK/MIL-HDBK-0001-0099/download.php?spec=MIL-HDBK-61A.015177.PDF
(catalogue page: https://everyspec.com/MIL-HDBK/MIL-HDBK-0001-0099/MIL-HDBK-61A_15177/)
Document: MIL-HDBK-61A(SE), Configuration Management Guidance, 7 Feb 2001. Public-domain US government work.
Retrieved: 2026-10-24. Text extracted from the PDF with `pdftotext -layout`; page footers ("Downloaded from https://www.everyspec.com", running header) removed and runs of blank lines collapsed. Otherwise verbatim; the original's hard line wraps are kept. Notes labelled [EXTRACTOR NOTE] are mine.

# MIL-HDBK-61A Appendix B - ECP Cost Spreadsheet Template

Appendix B is the cost page of the ECP, not the whole ECP content. The ECP content list is Table 6-6 (see mil-hdbk-61a-section-6-2.md). Appendix B matters because it fixes the cost-summary structure: production, retrofit, integrated logistics support, other; non-recurring vs recurring; savings in parentheses.

[EXTRACTOR NOTE] In the PDF, the table captioned "Table B-2. ECP Cost Spreadsheet Template-with Formulas" (page B-2; the text of B.2 calls it Table B-1) is a rotated low-resolution image, so its formulas are not machine-readable. From the image, as best it can be read: Total Recurring = PRODUCT(Unit, Quantity); Total = SUM(Non-Recurring, Total Recurring); subtotal rows are SUMs of the lines above; "Other Costs/Savings to Govt." has its own SUM column; the final row sums the subtotals. Treat that sentence as my reading, not as source text. The table captioned "Table B-3 ... Sample Data" is in the PDF, but its cells are all $0.00 or blank; no actual sample data is present.

The extracted text below is column-scrambled for the two tables. The clean row list is in ecp-fields.md, section "Cost impact structure".

## Extracted text (verbatim apart from the clean-up described above)

```text
                           APPENDIX B
           ENGINEERING CHANGE PROPOSAL

            COST SPREADSHEET TEMPLATE

QUESTIONS THIS APPENDIX WILL ANSWER                                                        Para.

1. How should the estimated net total cost of an engineering change be calculated and B.2

portrayed in an engineering change proposal?

B.1 Scope.

This appendix provides a spreadsheet representation of a typical Engineering Change Proposal cost page. It
supplements the instructions in the ECP data item description by means of the formulas depicted in each cell
of the spreadsheet, and by means of a blank spreadsheet (without formulas showing) and a spreadsheet
with sample data included.

B.2 Application and Use

Use this appendix for guidance and information. The spreadsheet and samples are contained in the following tables.

Table B-1  ECP Cost Spreadsheet Template-with Formulas
Table B-2  ECP Cost Spreadsheet Template-Blank Form
Table B-3  ECP Cost Spreadsheet Template-with Sample Data

The file containing these data in MS EXCEL format may be downloaded from the following website, and may be
used as a template for tailoring to a specific program application.
http://www.mlrassociates.com/

                                              Page B-1

Table B-2. ECP Cost Spreadsheet Template-with Formulas

                                          Page B-2

                                Table B-2. ECP Cost Spreadsheet Template- Blank Form

ESTIMATED NET TOTAL COST IMPACT (Use parentheses for savings)

                                                            COSTS/(SAVINGS) UNDER CONTRACT                   Other Costs/
                                                                                                                Savings
           FACTOR                            Non-Recurring        Recurring             Total  Total           to Govt.

                                                            Unit      Quantity Recurring                                $0.00

a. PRODUCTION COST (SAVINGS)                                                                                            $0.00

(1) Configuration Item/CSCI                                                             $0.00         $0.00             $0.00
                                                                                        $0.00         $0.00             $0.00
(2) Factory Test Equipment                                                              $0.00         $0.00             $0.00
                                                                                        $0.00         $0.00
(3) Special Factory Tooling                                                             $0.00         $0.00
                                                                                        $0.00         $0.00
(4) Scrap                                                                               $0.00         $0.00
                                                                                        $0.00         $0.00
(5) Engineering & Engineering Data Revision                                             $0.00         $0.00
                                                                                        $0.00         $0.00
(6) Revision of Test Procedures                                                         $0.00         $0.00

(7) Qualification of New Items                                                          $0.00         $0.00
                                                                                        $0.00         $0.00
(8) Blank or user identified factor                                                     $0.00         $0.00
                                                                                        $0.00         $0.00
(9) Blank or user identified factor                                                     $0.00         $0.00
                                                                                        $0.00         $0.00
(10) Blank or user identified factor                                                    $0.00         $0.00
                                                                                        $0.00         $0.00
(11) SUBTOTAL OF PRODUCTION                  $0.00 XXXXXXXX           XXXXXXX           $0.00         $0.00
                                                                                        $0.00         $0.00
COSTS/(SAVINGS)                                                       XXXXXXX           $0.00         $0.00
                                                                                        $0.00         $0.00
b. RETROFIT COSTS                                                     XXXXXXX           $0.00         $0.00
                                                                      XXXXXXX           $0.00         $0.00
(1) Engineering Data Revision                                                           $0.00         $0.00

(2) Prototype Testing                                                                   $0.00         $0.00
                                                                                        $0.00         $0.00
(3) Kit Proof Testing                                                                   $0.00         $0.00
                                                                                        $0.00         $0.00
(4) Retrofit Kits for Operational Systems                                               $0.00         $0.00
                                                                                        $0.00         $0.00
(5) Prep of MWO/TCTO/ALT/TD                                                             $0.00         $0.00
                                                                                        $0.00         $0.00
(6) Special Tooling for Retrofit                                                        $0.00         $0.00
                                                                                        $0.00         $0.00
(7) Installation -- Contractor Personnel                                                $0.00         $0.00
                                                                                        $0.00         $0.00
(8) Installation -- Government Personnel                                                $0.00         $0.00
                                                                                        $0.00         $0.00
(9) Testing after Retrofit                                                              $0.00         $0.00
                                                                                        $0.00         $0.00
(10) Modification of GFE/GFP                                                            $0.00         $0.00
                                                                                        $0.00         $0.00
(11) Qualification of GFE/GFP
                                                                                        $0.00         $0.00
(12) Blank or user identified factor                                                    $0.00         $0.00

(13) Blank or user identified factor

(14) Blank or user identified factor

(15) SUBTOTAL OF RETROFIT COSTS              $0.00 XXXXXXXX

(SAVINGS)

c. INTEGRATED LOGISTICS SUPPORT COSTS/(SAVINGS)

(1) Retrofit of Spares/Repair Parts

(2) New Spares/Repair Parts

(3) Supply/Provisioning Data

(4) Support Equipment

(5) Retrofit Kits for Spares

(6) Operator Training Courses

(7) Maintenance Training Courses

(8) Revision of Technical Manuals

(9) New Technical Manuals

(10) Training/Trainers

(11) Interim Support

(12) Maintenance Manpower

(13) Computer Programs/Documentation

(14) Blank or user identified factor

(15) Blank or user identified factor

(16) Blank or user identified factor

(17) Operations and Support Cost Change

(18) SUBTOTAL OF LOGISTICS                   $0.00 XXXXXXXX

SUPPORT COSTS/(SAVINGS)

d. OTHER COSTS/(SAVINGS)

e. SUBTOTAL COSTS/(SAVINGS)                  $0.00 XXXXXXXX

f. ESTIMATED NET TOTAL COSTS/(SAVINGS)

                                                            Page B-3

                               Table B-3. ECP Cost Spreadsheet Template- Sample Data

ESTIMATED NET TOTAL COST IMPACT (Use parentheses for savings)

                                                            COSTS/(SAVINGS) UNDER CONTRACT                   Other Costs/
                                                                                                                Savings
           FACTOR                            Non-Recurring        Recurring             Total  Total           to Govt.

                                                            Unit      Quantity Recurring                                $0.00

a. PRODUCTION COST (SAVINGS)                                                                                            $0.00

(1) Configuration Item/CSCI                                                             $0.00         $0.00             $0.00
                                                                                        $0.00         $0.00             $0.00
(2) Factory Test Equipment                                                              $0.00         $0.00             $0.00
                                                                                        $0.00         $0.00
(3) Special Factory Tooling                                                             $0.00         $0.00
                                                                                        $0.00         $0.00
(4) Scrap                                                                               $0.00         $0.00
                                                                                        $0.00         $0.00
(5) Engineering & Engineering Data Revision                                             $0.00         $0.00
                                                                                        $0.00         $0.00
(6) Revision of Test Procedures                                                         $0.00         $0.00

(7) Qualification of New Items                                                          $0.00         $0.00
                                                                                        $0.00         $0.00
(8) Blank or user identified factor                                                     $0.00         $0.00
                                                                                        $0.00         $0.00
(9) Blank or user identified factor                                                     $0.00         $0.00
                                                                                        $0.00         $0.00
(10) Blank or user identified factor                                                    $0.00         $0.00
                                                                                        $0.00         $0.00
(11) SUBTOTAL OF PRODUCTION                  $0.00 XXXXXXXX           XXXXXXX           $0.00         $0.00
                                                                                        $0.00         $0.00
COSTS/(SAVINGS)                                                       XXXXXXX           $0.00         $0.00
                                                                                        $0.00         $0.00
b. RETROFIT COSTS                                                     XXXXXXX           $0.00         $0.00
                                                                      XXXXXXX           $0.00         $0.00
(1) Engineering Data Revision                                                           $0.00         $0.00

(2) Prototype Testing                                                                   $0.00         $0.00
                                                                                        $0.00         $0.00
(3) Kit Proof Testing                                                                   $0.00         $0.00
                                                                                        $0.00         $0.00
(4) Retrofit Kits for Operational Systems                                               $0.00         $0.00
                                                                                        $0.00         $0.00
(5) Prep of MWO/TCTO/ALT/TD                                                             $0.00         $0.00
                                                                                        $0.00         $0.00
(6) Special Tooling for Retrofit                                                        $0.00         $0.00
                                                                                        $0.00         $0.00
(7) Installation -- Contractor Personnel                                                $0.00         $0.00
                                                                                        $0.00         $0.00
(8) Installation -- Government Personnel                                                $0.00         $0.00
                                                                                        $0.00         $0.00
(9) Testing after Retrofit                                                              $0.00         $0.00
                                                                                        $0.00         $0.00
(10) Modification of GFE/GFP                                                            $0.00         $0.00
                                                                                        $0.00         $0.00
(11) Qualification of GFE/GFP
                                                                                        $0.00         $0.00
(12) Blank or user identified factor                                                    $0.00         $0.00

(13) Blank or user identified factor

(14) Blank or user identified factor

(15) SUBTOTAL OF RETROFIT COSTS              $0.00 XXXXXXXX

(SAVINGS)

c. INTEGRATED LOGISTICS SUPPORT COSTS/(SAVINGS)

(1) Retrofit of Spares/Repair Parts

(2) New Spares/Repair Parts

(3) Supply/Provisioning Data

(4) Support Equipment

(5) Retrofit Kits for Spares

(6) Operator Training Courses

(7) Maintenance Training Courses

(8) Revision of Technical Manuals

(9) New Technical Manuals

(10) Training/Trainers

(11) Interim Support

(12) Maintenance Manpower

(13) Computer Programs/Documentation

(14) Blank or user identified factor

(15) Blank or user identified factor

(16) Blank or user identified factor

(17) Operations and Support Cost Change

(18) SUBTOTAL OF LOGISTICS                   $0.00 XXXXXXXX

SUPPORT COSTS/(SAVINGS)

d. OTHER COSTS/(SAVINGS)

e. SUBTOTAL COSTS/(SAVINGS)                  $0.00 XXXXXXXX

f. ESTIMATED NET TOTAL COSTS/(SAVINGS)

                                                            Page B-4
```
