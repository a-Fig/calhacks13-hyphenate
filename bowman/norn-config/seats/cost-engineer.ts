// Bowman's cost engineer seat, held by Norn. Today the seat is Wei-Lin Zhao's (EMP-08, Product Cost
// Engineer). The duties, who to ask and the deadlines are Bowman's choices; Norn's seat runner reads
// this file. Written 2026-10-24 (#155).
import type { SeatDefinition } from '../../../norn/seat/src/types.ts';

export const costEngineerSeat: SeatDefinition = {
  id: 'cost_engineer',
  title: 'Product Cost Engineer',
  replaces: 'EMP-08',
  duties: [
    { id: 'price', title: 'Price every change', trigger: 'An ECR is filed or revised', output: 'Unit and one-time cost, cut-in, supply risk, budget share and runway, as ranges' },
    { id: 'quotes', title: 'Check supplier quotes', trigger: 'A quote is attached to an ECR', output: 'Firm or budgetary, first-lot premium, cancellation terms, flagged on the cost page' },
    { id: 'chase', title: 'Chase missing inputs', trigger: 'A cost line is blank, or a material default stands in for a number', output: 'A question to the person who owns the number, their answer recorded and the checks re-run, or an escalation' },
    { id: 'options', title: 'Find the best option', trigger: 'An ECR has a cut-in, disposition, retrofit or bundling choice', output: 'The options simulated side by side, and the cheapest safe one recommended' },
    { id: 'packet', title: 'Write the board packet', trigger: 'The checks are current', output: 'The impact statement and recommendation on the ECR' },
    { id: 'defend', title: 'Answer questions on it', trigger: 'Someone asks why', output: 'An answer from the stored trace, every number checked' },
    { id: 'books', title: 'Prepare the books', trigger: 'An ECO is released', output: 'The ERP change package, and which lines are entered' },
  ],
  asks: [
    { match: 'delay|holding|idle|stand[- ]?down', seat: 'production_planner', unit: 'usd', why: 'The planner owns the line schedule and what a held station costs.' },
    { match: 're-?inspect|inspection|first[- ]article|test after', seat: 'quality', unit: 'usd', why: 'Quality owns inspection plans and first-article reviews.' },
    { match: 'qualif|certif|vibration|re-?test', seat: 'certification', unit: 'usd', why: 'Certification owns the test plan and means of compliance.' },
    { match: 'install|assembly|retrofit|tooling|fixture|labou?r', seat: 'manufacturing_engineer', unit: 'usd', why: 'Manufacturing engineering owns assembly time, tooling and the retrofit work instructions.' },
    { match: 'cancel|recover|scrap|quote|price', seat: 'buyer', unit: 'share', why: 'Procurement owns supplier terms and what scrap sells for.' },
    { match: 'spares|manual|training|logistic', seat: 'cm_analyst', unit: 'usd', why: 'Bowman has no product-support seat; the configuration analyst checks the ECR is complete before the board.' },
    { match: '.', seat: 'originator', unit: 'usd', why: 'you filed the ECR.' },
  ],
  deadlines: { remindAfterHours: 24, escalateAfterHours: [48, 72] },
  escalation: ['cm_analyst', 'ccb_chair'],
  materialityUsd: 1000,
};
