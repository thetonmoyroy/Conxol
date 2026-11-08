import { combinedRows, combinedTemplate, huaweiRows, huaweiTemplate, templateFields, type ConfigTemplate } from "./config-templates.ts";

const ciscoText = `vrf definition {{vpn}}
 rd {{local_as}}:{{vlan}}
 address-family ipv4
 exit-address-family
exit
interface {{interface}}.{{vlan}}
 description MGMT_RTR-{{vpn}}
 encapsulation dot1Q {{vlan}}
 vrf forwarding {{vpn}}
 ip address {{ip}} {{mask}}
exit
!`;
export const ciscoTemplate: ConfigTemplate = {
  id: "cisco-iosxe-combined", name: "Cisco IOS XE interfaces + policy + BGP", text: ciscoText, fields: templateFields(ciscoText),
  combined: {
    platform: "iosxe", localAs: "64496", remoteAs: "64497", policyName: "MGMT_RTR", checkboxFields: ["advertise_default"],
    prefixes: "ip prefix-list {{policy_name}} seq {{index}} {{action}} {{network}}/{{length}}{{#ge}} ge {{ge}}{{/ge}}{{#le}} le {{le}}{{/le}}",
    policy: "route-map {{policy_name}} permit 10\n match ip address prefix-list {{policy_name}}\nexit\nroute-map deny-all deny 10\nexit\n!",
    header: "router bgp {{local_as}}\n no bgp enforce-first-as\n no bgp default ipv4-unicast\n!",
    peer: " address-family ipv4 vrf {{vpn}}\n  neighbor {{peer_ip}} remote-as {{peer_as}}\n  neighbor {{peer_ip}} activate\n  neighbor {{peer_ip}} route-map {{import_policy}} in\n  neighbor {{peer_ip}} route-map {{export_policy}} out\n{{#advertise_default}}  neighbor {{peer_ip}} default-originate\n{{/advertise_default}} exit-address-family\n!",
  },
};
const juniperText = `set interfaces {{interface}} vlan-tagging
set interfaces {{interface}} unit {{vlan}} description MGMT_RTR-{{vpn}}
set interfaces {{interface}} unit {{vlan}} vlan-id {{vlan}}
set interfaces {{interface}} unit {{vlan}} family inet address {{ip}}/{{prefix_length}}
set routing-instances {{vpn}} instance-type virtual-router
set routing-instances {{vpn}} interface {{interface}}.{{vlan}}`;
export const juniperTemplate: ConfigTemplate = {
  id: "juniper-junos-combined", name: "Juniper Junos interfaces + policy + BGP", text: juniperText, fields: templateFields(juniperText),
  combined: {
    platform: "junos", localAs: "64496", remoteAs: "64497", policyName: "MGMT_RTR", checkboxFields: ["advertise_default"],
    prefixes: "set policy-options policy-statement {{policy_name}} term prefix-{{index}} from route-filter {{network}}/{{length}} {{route_match}}\nset policy-options policy-statement {{policy_name}} term prefix-{{index}} then {{route_action}}",
    policy: "set policy-options policy-statement {{policy_name}} then reject\nset policy-options policy-statement deny-all then reject",
    header: "set routing-options autonomous-system {{local_as}}",
    peer: `set routing-instances {{vpn}} routing-options autonomous-system {{local_as}}
set routing-instances {{vpn}} protocols bgp group MGMT_RTR type external
set routing-instances {{vpn}} protocols bgp group MGMT_RTR family inet unicast
set routing-instances {{vpn}} protocols bgp group MGMT_RTR neighbor {{peer_ip}} peer-as {{peer_as}}
set routing-instances {{vpn}} protocols bgp group MGMT_RTR neighbor {{peer_ip}} import {{import_policy}}
set routing-instances {{vpn}} protocols bgp group MGMT_RTR neighbor {{peer_ip}} export [ {{export_chain}} ]
{{#advertise_default}}set routing-instances {{vpn}} routing-options static route 0.0.0.0/0 discard
set routing-instances {{vpn}} routing-options static route 0.0.0.0/0 no-install
set policy-options policy-statement DEFAULT-{{vpn}} term default from route-filter 0.0.0.0/0 exact
set policy-options policy-statement DEFAULT-{{vpn}} term default then accept
set policy-options policy-statement DEFAULT-{{vpn}} then next policy
{{/advertise_default}}`,
  },
};

function logicalScope(text: string) {
  return text.replace(/(^|\}\})set (?!interfaces \{\{interface\}\} vlan-tagging)/gm, "$1set logical-systems {{logical_system}} ");
}
const logicalText = logicalScope(juniperText);
export const juniperLogicalTemplate: ConfigTemplate = {
  id: "juniper-junos-logical-combined", name: "Juniper Junos logical systems · per service", text: logicalText, fields: templateFields(logicalText),
  combined: {
    ...juniperTemplate.combined!, logicalSystems: true,
    header: logicalScope(juniperTemplate.combined!.header),
    peer: logicalScope(juniperTemplate.combined!.peer),
    prefixes: logicalScope(juniperTemplate.combined!.prefixes),
    policy: logicalScope(juniperTemplate.combined!.policy),
  },
};
export const builtinTemplates = [huaweiTemplate, combinedTemplate, ciscoTemplate, juniperTemplate, juniperLogicalTemplate];
export function builtinRows(id: string) {
  if (id === huaweiTemplate.id) return huaweiRows();
  if (id === combinedTemplate.id) return combinedRows();
  if (id === ciscoTemplate.id || id === juniperTemplate.id || id === juniperLogicalTemplate.id) return combinedRows().map(row => ({ ...row, interface: id === ciscoTemplate.id ? "Port-channel1" : "ae1", ...(id === juniperLogicalTemplate.id ? { logical_system: `LS-${row.vpn}` } : {}) }));
  return [{}];
}
