// Client Script: ECR, List view. Reads the ID first, in full.
// Frappe shows a DocType's title instead of its ID when it has a title field (the ECR does), and
// puts the ID in a narrow last column that cuts it off. So: prefix the title with its ID
// ("ECR-0417 · Motor-controller bracket..."), and drop the redundant last column.
if (!document.getElementById('plm-list-ids')) {
  const style = document.createElement('style');
  style.id = 'plm-list-ids';
  style.textContent = `
    .list-row .list-subject a[data-name]::before { content: attr(data-name) "  ·  "; font-weight: 600; color: var(--text-color); }
    .list-row-col[data-fieldname="name"] { display: none; }`;
  document.head.appendChild(style);
}
