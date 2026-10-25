// Who is who at Bowman. The module has no people directory yet (the PLM and the ERP would give it), so
// this is a MOCK stand-in, copied from bowman/data/company.ts: employee ids as the change requests
// carry them, and the reviewer seats an ECR is routed to.
export const PEOPLE: Record<string, string> = {
  'EMP-01': 'Rafael Quintero', 'EMP-02': 'Dana Okafor', 'EMP-03': 'Jeff Hargrove', 'EMP-04': 'Maren Solheim',
  'EMP-05': 'Priya Venkataraman', 'EMP-06': 'Tomasz Wierzbicki', 'EMP-07': 'Ayesha Karimi', 'EMP-08': 'Wei-Lin Zhao',
  'EMP-09': 'Hamid Barzani', 'EMP-10': 'Colleen Rourke', 'EMP-11': 'Samir Vaidya', 'EMP-12': 'Beatriz Nowak',
  'EMP-13': 'Marcus Edelstein', 'EMP-14': 'Helen Castellanos', 'EMP-15': 'Gideon Falk', 'EMP-16': 'Linnea Brandt',
  'EMP-17': 'Nikhil Desai', 'EMP-18': 'Owen Tillery',
};

/** The reviewer behind each seat an ECR can be routed to. */
export const SEATS: Record<string, { role: string; person: string }> = {
  cost_engineer: { role: 'Cost engineering', person: 'Wei-Lin Zhao' },
  buyer: { role: 'Procurement', person: 'Hamid Barzani' },
  production_planner: { role: 'Production planning', person: 'Colleen Rourke' },
  cost_accountant: { role: 'Cost accounting', person: 'Samir Vaidya' },
  quality: { role: 'Quality', person: 'Beatriz Nowak' },
  certification: { role: 'Certification', person: 'Gideon Falk' },
  manufacturing_engineer: { role: 'Manufacturing', person: 'Owen Tillery' },
};

// A PLM login is the person's address (first.last@...); its local part, letters only, matches their name the same way.
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const BY_LOGIN = new Map(Object.values(PEOPLE).map(name => [squash(name), name]));

/** The person behind an employee id or a PLM login; a login that matches nobody is shown as it is. */
export const personOf = (emp: string | undefined) => {
  if (!emp) return '';
  if (PEOPLE[emp]) return PEOPLE[emp];
  return emp.includes('@') ? BY_LOGIN.get(squash(emp.split('@')[0]!)) ?? emp : emp;
};
