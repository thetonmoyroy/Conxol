"use strict";
const menu = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-nav');
function closeMenu() { if (menu && navigation) { menu.setAttribute('aria-expanded', 'false'); navigation.classList.remove('is-open'); } }
menu?.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; menu.setAttribute('aria-expanded', String(open)); navigation?.classList.toggle('is-open', open); });
navigation?.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
document.querySelectorAll('[data-year]').forEach(node => { node.textContent = String(new Date().getFullYear()); });
const examples = {
  huawei: ['Huawei subinterface', 'interface Eth-Trunk1.200\n description MGMT_RTR-IPBW\n ip binding vpn-instance IPBW\n ip address 192.0.2.1 255.255.255.252\n dot1q termination vid 200\n statistics enable\n#'],
  cisco: ['Cisco IOS XE subinterface', 'interface Port-channel1.200\n description MGMT_RTR-IPBW\n encapsulation dot1Q 200\n vrf forwarding IPBW\n ip address 192.0.2.1 255.255.255.252\nexit\n!'],
  juniper: ['Juniper Junos interface unit', 'set interfaces ae1 vlan-tagging\nset interfaces ae1 unit 200 description MGMT_RTR-IPBW\nset interfaces ae1 unit 200 vlan-id 200\nset interfaces ae1 unit 200 family inet address 192.0.2.1/30\nset routing-instances IPBW instance-type virtual-router\nset routing-instances IPBW interface ae1.200']
};
document.querySelectorAll('[data-vendor]').forEach(button => button.addEventListener('click', () => {
  const example = examples[button.dataset.vendor];
  const code = document.querySelector('#vendor-code');
  const status = document.querySelector('#vendor-status');
  if (!example || !code || !status) return;
  code.textContent = example[1]; status.textContent = `${example[0]} · documentation-only addresses`;
  document.querySelectorAll('[data-vendor]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
