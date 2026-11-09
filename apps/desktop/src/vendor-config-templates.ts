import { iosxrPrefixEntry, iosxrImportPolicy, combinedRows, combinedTemplate, huaweiRows, huaweiTemplate, templateFields, type CombinedSections, type ConfigTemplate } from "./config-templates.ts";

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
    header: "router bgp {{local_as}}\n no bgp default ipv4-unicast\n!",
    peer: " address-family ipv4 vrf {{vpn}}\n  neighbor {{peer_ip}} remote-as {{peer_as}}\n  neighbor {{peer_ip}} activate\n  neighbor {{peer_ip}} route-map {{import_policy}} in\n  neighbor {{peer_ip}} route-map {{export_policy}} out\n{{#advertise_default}}  neighbor {{peer_ip}} default-originate\n{{/advertise_default}} exit-address-family\n!",
  },
};
const juniperText = `set interfaces {{interface}} vlan-tagging
set interfaces {{interface}} unit {{vlan}} description MGMT_RTR-{{vpn}}
set interfaces {{interface}} unit {{vlan}} vlan-id {{vlan}}
set interfaces {{interface}} unit {{vlan}} family inet address {{ip}}/{{prefix_length}}
set routing-instances {{vpn}} instance-type virtual-router
set routing-instances {{vpn}} interface {{interface}}.{{vlan}}`;

const iosxrText = `interface {{interface}}.{{vlan}}
 description MGMT_RTR-{{vpn}}
 vrf {{vpn}}
 ipv4 address {{ip}} {{mask}}
 encapsulation dot1q {{vlan}}
exit
!`;
export const iosxrTemplate: ConfigTemplate = {
  id: "cisco-iosxr-combined", name: "Cisco IOS XR interfaces + policy + BGP", text: iosxrText, fields: templateFields(iosxrText),
  combined: {
    platform: "iosxr", localAs: "64496", remoteAs: "64497", policyName: "MGMT_RTR", checkboxFields: ["advertise_default"],
    prefixes: iosxrPrefixEntry,
    policy: iosxrImportPolicy,
    header: "router bgp {{local_as}}\n!",
    peer: ` vrf {{vpn}}
  address-family ipv4 unicast
  exit
  neighbor {{peer_ip}}
   remote-as {{peer_as}}
   address-family ipv4 unicast
    route-policy {{import_policy}} in
    route-policy {{export_policy}} out
{{#advertise_default}}    default-originate
{{/advertise_default}}   exit
  exit
 exit
!`,
  },
};

const routerosText = `/interface/vlan add name="vlan{{vlan}}-{{vpn}}" interface="{{interface}}" vlan-id={{vlan}} comment="MGMT_RTR-{{vpn}}"
/ip/vrf add name="{{vpn}}" interfaces="vlan{{vlan}}-{{vpn}}" place-before=[find where name="main"]
/ip/address add address={{ip}}/{{prefix_length}} interface="vlan{{vlan}}-{{vpn}}" comment="MGMT_RTR-{{vpn}}"`;
export const routerosTemplate: ConfigTemplate = {
  id: "mikrotik-routeros7-combined", name: "MikroTik v7 VLAN + VRF + BGP", text: routerosText, fields: templateFields(routerosText),
  combined: {
    platform: "routeros7", localAs: "64496", remoteAs: "64497", policyName: "MGMT_RTR", checkboxFields: ["advertise_default"],
    prefixes: '/routing/filter/rule add chain="{{policy_name}}" rule="if ({{prefix_condition}}) { {{route_action}}; }" comment="prefix-{{index}}"',
    policy: '/routing/filter/rule add chain="{{policy_name}}" rule="reject;"\n/routing/filter/rule add chain="deny-all" rule="reject;"',
    header: "# MikroTik v7: one BGP instance per service VRF",
    peer: `{{#advertise_default}}/routing/filter/rule add chain="MGMT-OUT-{{vpn}}" rule="if (dst == 0.0.0.0/0) { accept; }"
{{/advertise_default}}/routing/filter/rule add chain="MGMT-OUT-{{vpn}}" rule="jump {{export_policy}};"
/routing/bgp/instance add name="BGP-{{vpn}}" as={{local_as}} router-id={{ip}} routing-table="{{vpn}}" vrf="{{vpn}}"
/routing/bgp/connection add name="MGMT_RTR-{{vpn}}" instance="BGP-{{vpn}}" local.address={{ip}} local.role=ebgp remote.address={{peer_ip}}/32 remote.as={{peer_as}} input.filter="{{import_policy}}" output.filter-chain="MGMT-OUT-{{vpn}}" output.default-originate={{default_originate}} disabled=no`,
  },
};
const routerosMainText = `/interface/vlan add name="vlan{{vlan}}-{{vpn}}" interface="{{interface}}" vlan-id={{vlan}} comment="MGMT_RTR-{{vpn}}"
/ip/address add address={{ip}}/{{prefix_length}} interface="vlan{{vlan}}-{{vpn}}" comment="MGMT_RTR-{{vpn}}"`;
export const routerosMainTemplate: ConfigTemplate = {
  id: "mikrotik-routeros7-main-combined", name: "MikroTik v7 VLAN + BGP (no VRF)", text: routerosMainText, fields: templateFields(routerosMainText),
  combined: {
    ...routerosTemplate.combined!,
    header: '# MikroTik v7: shared BGP instance in the main routing table\n/routing/bgp/instance add name="BGP-MAIN" as={{local_as}}',
    peer: `{{#advertise_default}}/routing/filter/rule add chain="MGMT-OUT-{{vpn}}" rule="if (dst == 0.0.0.0/0) { accept; }"
{{/advertise_default}}/routing/filter/rule add chain="MGMT-OUT-{{vpn}}" rule="jump {{export_policy}};"
/routing/bgp/connection add name="MGMT_RTR-{{vpn}}" instance="BGP-MAIN" local.address={{ip}} local.role=ebgp remote.address={{peer_ip}}/32 remote.as={{peer_as}} input.filter="{{import_policy}}" output.filter-chain="MGMT-OUT-{{vpn}}" output.default-originate={{default_originate}} disabled=no`,
  },
};
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
export const builtinTemplates = [huaweiTemplate, combinedTemplate, ciscoTemplate, iosxrTemplate, routerosTemplate, routerosMainTemplate, juniperTemplate, juniperLogicalTemplate];
export function templateNotes(platform: CombinedSections["platform"]): string {
  switch (platform) {
    case "iosxe": return "Cisco IOS XE / VRF Lite. Configure the parent Port-channel and referenced CLIENT export route-maps on the router.";
    case "iosxr": return "Cisco IOS XR / existing VRFs. The template binds interfaces and configures BGP peers in precreated VRFs without creating VRFs or setting their RDs. Configure the parent Bundle-Ether and referenced CLIENT export RPL policies. Permitted prefixes share one named prefix set; route-policy handles denies in prefix-row order. Review and commit the configuration yourself.";
    case "routeros7": return "MikroTik v7 with explicit BGP instances. Select an existing parent interface. Both variants add VLANs; the VRF variant also adds service VRFs before main, while the no-VRF variant shares one BGP instance in the main routing table. Service names identify VLANs, peers and filter chains in both variants. Configure referenced CLIENT export filter chains and the networks you intend to originate.";
    default: return "Juniper Junos set commands / virtual-router instances. Configure the parent ae interface and referenced CLIENT export policies. Default advertisement creates a discard static default with no-install and an export policy ahead of the service export policy.";
  }
}
export function builtinRows(id: string) {
  if (id === huaweiTemplate.id) return huaweiRows();
  if (id === combinedTemplate.id) return combinedRows();
  if (id === iosxrTemplate.id || id === routerosTemplate.id || id === routerosMainTemplate.id) return combinedRows().map(row => ({ ...row, interface: id === iosxrTemplate.id ? "Bundle-Ether1" : "ether1" }));
  if (id === ciscoTemplate.id || id === juniperTemplate.id || id === juniperLogicalTemplate.id) return combinedRows().map(row => ({ ...row, interface: id === ciscoTemplate.id ? "Port-channel1" : "ae1", ...(id === juniperLogicalTemplate.id ? { logical_system: `LS-${row.vpn}` } : {}) }));
  return [{}];
}
