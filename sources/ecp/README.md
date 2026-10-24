# Sources: US defense Engineering Change Proposal (ECP)

Primary material for modelling the engineering change request and impact-assessment structure, from the US DoD Engineering Change Proposal. Retrieved 2026-10-24.

All of this is US federal government work (MIL-HDBK-61A, DD Form 1692 and its instructions, DI-SESS-80639D), which is not subject to US copyright (17 U.S.C. 105). Third-party hosts (everyspec.com, the Internet Archive) added their own stamps or wrappers; those are not part of the documents and are removed from the extracts. No PDFs are stored in this repo; the files below are text extracted from them.

## Files

| File | What it is | Source | Verbatim or summarised |
|---|---|---|---|
| [ecp-fields.md](ecp-fields.md) | Every ECP block and field on DD Form 1692 (REV 01/2018), pages 1 to 7, with its instruction text; handbook classification, priority, type and justification tables; cost-impact structure; schedule and effectivity fields; interchangeability; handbook Table 6-6 element list; observations on the sources | DD Form 1692 and instructions (below), MIL-HDBK-61A | Mostly verbatim (field labels, instruction text, handbook tables). Parts marked **[SUMMARY]** are my own summary: the form overview, index tables in sections 4.5, 5 and 6, and section 8. Instruction text was checked by script against the extracted source (93 of 93 instruction segments match, whitespace aside). |
| [mil-hdbk-61a-appendix-b.md](mil-hdbk-61a-appendix-b.md) | MIL-HDBK-61A Appendix B, ECP Cost Spreadsheet Template | everyspec.com PDF, below | Verbatim extract, with a note on what could not be read (the formulas table is an image) |
| [mil-hdbk-61a-section-6-2.md](mil-hdbk-61a-section-6-2.md) | Glossary definitions; section 6.2 (ECP concepts, initiation, preparation, review and disposition, implementation); Tables 6-2 (Class I / II criteria), 6-3 (justification codes), 6-4 (types), 6-5 (priorities), 6-6 (ECP content), 6-7 (review and disposition) | everyspec.com PDF, below | Verbatim extract. Table 6-3 and Table 6-6 are multi-column tables; their text is verbatim but the row alignment is reconstructed (stated in the file). Table 6-8 not extracted. |
| [mil-hdbk-61a-appendix-d.md](mil-hdbk-61a-appendix-d.md) | MIL-HDBK-61A Appendix D, ECP Management Guide (process, coordination meetings, Checklists A, B, C) | everyspec.com PDF, below | Verbatim extract (check-mark glyphs did not extract) |
| [di-sess-80639d.md](di-sess-80639d.md) | Data Item Description for the ECP deliverable | everyspec.com PDF, below | Verbatim, whole document (one page) |

## Source documents and URLs

### MIL-HDBK-61A(SE), Configuration Management Guidance, 7 Feb 2001

- Catalogue page: https://everyspec.com/MIL-HDBK/MIL-HDBK-0001-0099/MIL-HDBK-61A_15177/
- PDF: https://everyspec.com/MIL-HDBK/MIL-HDBK-0001-0099/download.php?spec=MIL-HDBK-61A.015177.PDF (2,218,495 bytes, 221 PDF pages).
- Used: section 3 glossary, section 6.2 and Tables 6-2 to 6-7, Appendix B, Appendix D.
- Not extracted: Table 6-8 (ECP implementation actions), section 6.3 (RFDs, NORs), the rest of the handbook.
- Note: the handbook is superseded by MIL-HDBK-61B (April 2020), which everyspec.com lists but which was not retrieved.

### DD Form 1692, Engineering Change Proposal (REV 01/2018), and its instructions

The official host, www.esd.whs.mil, refused every direct request (HTTP 403) from this machine: `curl` with a browser user agent, PowerShell `Invoke-WebRequest`, and the WebFetch tool all failed. A NASA copy (lws.larc.nasa.gov) did not resolve (DNS failure). The files were retrieved instead from the Internet Archive's copies of the esd.whs.mil URLs (raw capture, `id_` form). All carry "DD FORM 1692 (REV 01/2018)".

| File | Internet Archive capture | Used for |
|---|---|---|
| DD1692-InstComplete.pdf (instructions, pages 1 to 7) | https://web.archive.org/web/20240205081923id_/https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/DD1692-InstComplete.pdf | all instruction text |
| dd1692-1.pdf (page 1) | https://web.archive.org/web/20230807145821id_/https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1692-1.pdf | page 1 labels |
| dd1692-2.pdf (page 2) | https://web.archive.org/web/20240927090644id_/https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1692-2.pdf | page 2 labels |
| dd1692-3.pdf (page 3) | https://web.archive.org/web/20230802181054id_/https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1692-3.pdf | page 3 labels |
| dd1692-4.pdf (page 4) | https://web.archive.org/web/20230802005853id_/https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1692-4.pdf | page 4 labels |
| dd1692-5.pdf (page 5) | https://web.archive.org/web/20230802042524id_/https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1692-5.pdf | page 5 labels |
| dd1692.pdf (complete form) | https://web.archive.org/web/20230801062543id_/https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1692.pdf | pages 6 and 7 labels; cross-check of page 1 |
| dd1692-6Inst.pdf, dd1692-7Inst.pdf, dd1692-Inst.pdf | https://web.archive.org/web/20240205081921id_/https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1692-6Inst.pdf, https://web.archive.org/web/20240926173623id_/https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1692-7Inst.pdf, https://web.archive.org/web/20240926184333id_/https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1692-Inst.pdf | downloaded; page 6 and 7 instruction text matched the complete instructions file; not otherwise used |

Original (blocked) URLs, for citing: https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1692.pdf and https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/DD1692-InstComplete.pdf (catalogue page https://www.esd.whs.mil/Directives/forms/dd1500_1999/DD1692/).

How the text was read: these PDFs are dynamic XFA forms. Ordinary PDF text extraction returns only "Please wait... If this message is not eventually replaced by the proper contents of the document, your PDF viewer may not be able to display this type of document." The text was read from the XFA template embedded in each PDF (`pypdf`, then an XML walk over the form's `draw` and `field` elements). This gives exact field labels and instruction text, but not the printed layout. The OMB expiry shown in the form copies is 20221130.

### DI-SESS-80639D, Engineering Change Proposal (ECP), Data Item Description, 7 Apr 2015

- Catalogue page: https://everyspec.com/DATA-ITEM-DESC-DIDs/DI-SESS/DI-SESS-80639D_52391/
- PDF: https://everyspec.com/DATA-ITEM-DESC-DIDs/DI-SESS/download.php?spec=DI-SESS-80639D.052391.pdf (78,733 bytes).

## What could not be retrieved or was not done

- **Direct esd.whs.mil downloads.** Blocked (HTTP 403, an access-denied page). Worked around with Internet Archive copies. The captures are dated 2023 and 2024; if the form changed after that, this would not show. The form footer still said REV 01/2018 and "PREVIOUS EDITIONS ARE OBSOLETE".
- **quicksearch.dla.mil (ASSIST).** Not retrieved; a search did not surface a direct PDF, and everyspec.com had the same DID. Not tried via the ASSIST site itself.
- **DD Form 1695, Notice of Revision (NOR)** and its DID (DI-SESS-80642). Referenced by the ECP (Block 16 "NOR NO.") but not retrieved.
- **Superseded earlier DID, DI-CMAN-80639C**, and **MIL-HDBK-61B (2020)**. Not retrieved.
- **MIL-HDBK-61A Appendix B formulas (Table B-1).** In the PDF this is a low-resolution rotated image; not machine-readable. The "sample data" table (B-3) contains no sample data in the PDF. See the note in mil-hdbk-61a-appendix-b.md.
- **DD Form 1692 rendering.** The printed layout was not available (the form is XFA); labels are exact but visual grouping is inferred from the form template.
- **The brief's premise on Appendix B.** The brief asked for the "ECP content in Appendix B". In MIL-HDBK-61A, Appendix B is the ECP cost spreadsheet template only. The ECP content list is Table 6-6 in section 6.2, and the process guide is Appendix D. This is reflected in the file names and in ecp-fields.md section 8.

## Working files

The downloaded PDFs and extraction scripts are not in the repo. They were kept in `C:\Users\smash\AppData\Local\Temp\ecpdl` and `C:\Users\smash\AppData\Local\Temp\ecpscripts` on the retrieving machine (temporary; may be deleted).
