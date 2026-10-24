// Client Script: NCR, List view. The NCR's title field already starts with its ID ("NCR-0119 · ..."),
// set by a Server Script, so only the redundant, cut-off last ID column goes.
if (!document.getElementById('plm-list-ids')) {
  const style = document.createElement('style');
  style.id = 'plm-list-ids';
  style.textContent = '.list-row-col[data-fieldname="name"] { display: none; }';
  document.head.appendChild(style);
}
