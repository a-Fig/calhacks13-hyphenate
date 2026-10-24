// Bowman PLM desk tweaks, loaded through the bench's app_include_js (up.sh brand).
// /desk is Frappe's empty app grid here: land on the PLM home instead.
document.title = 'Bowman PLM';
(function () {
  const home = () => { if (/^/desk/?$/.test(location.pathname) && window.frappe && frappe.set_route) frappe.set_route('bowman-plm'); };
  window.addEventListener('load', () => {
    setTimeout(home, 600);
    if (window.frappe && frappe.router && frappe.router.on) frappe.router.on('change', home);
  });
})();
