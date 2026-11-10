import assert from 'node:assert/strict';
import { ciscoTemplate, iosxrTemplate, routerosTemplate, routerosMainTemplate, juniperTemplate, juniperLogicalTemplate, builtinRows, builtinTemplates } from '../src/vendor-config-templates.ts';
import { normalizeConfigTemplate, templateSectionVariables, serviceFields, effectiveRemoteAs, remoteAsOverridden, automaticPeerIp, editServiceValue, normalizeInterfaceAddress, prefixToMask, combinedTemplate, combinedRows, prefixRows, renderCombined } from '../src/config-templates.ts';
import { huaweiTemplate, huaweiRows, templateFields, renderTemplate, encodeTemplates, decodeTemplates } from '../src/config-templates.ts';

const expectedHuawei = ['IPBW', 'GGC', 'FNA', 'CDN', 'BDIX'].map((vpn, index) => `interface Eth-Trunk1.${200 + index}\ndescription MGMT_RTR-${vpn}\nip binding vpn-instance ${vpn}\nip address 192.0.2.${1 + index * 4} 255.255.255.252\ndot1q termination vid ${200 + index}\nstatistics enable\n#`).join('\n');
for (const template of builtinTemplates) {
  assert.ok(!/check-first-as|enforce-first-as/.test(renderCombined(template,builtinRows(template.id),prefixRows()).text));
}
for (const [template,command] of [[combinedTemplate,'undo check-first-as'],[ciscoTemplate,'no bgp enforce-first-as'],[iosxrTemplate,'bgp enforce-first-as disable']]) {
  const legacy = {...template,combined:{...template.combined,header:template.combined.header.replace('\n',`\n ${command}\n`)}};
  assert.deepEqual(normalizeConfigTemplate(legacy),template);
  assert.deepEqual(decodeTemplates(encodeTemplates([legacy])),[template]);
  assert.equal(renderCombined(legacy,builtinRows(template.id),prefixRows()).text,renderCombined(template,builtinRows(template.id),prefixRows()).text);
}
for (const template of [iosxrTemplate, routerosTemplate, routerosMainTemplate]) {
  const rows = builtinRows(template.id);
  const result = renderCombined(template, rows, prefixRows());
  assert.deepEqual(result.errors, []);
  assert.equal(result.count, 5);
  assert.ok(!result.text.includes('{{'));
  assert.deepEqual(decodeTemplates(encodeTemplates([template])), [template]);
  const changedAs = {...template, combined: {...template.combined, remoteAs: '64498'}};
  const inherited = renderCombined(changedAs, rows, prefixRows()).text;
  assert.equal(inherited.match(template === iosxrTemplate ? /remote-as 64498/g : /remote.as=64498/g).length, 5);
  const overridden = rows.map((row,index) => index === 0 ? editServiceValue(row,'peer_as','64499') : row);
  assert.equal(renderCombined(changedAs, overridden, prefixRows()).text.match(template === iosxrTemplate ? /remote-as 64499/g : /remote.as=64499/g).length,1);
  const cidr = rows.map(row => ({...row,ip: `${row.ip}/30`,mask:''}));
  assert.equal(renderCombined(template,cidr,prefixRows()).text,result.text);
  const noDefault = rows.map(row => ({...row,advertise_default:''}));
  const without = renderCombined(template,noDefault,prefixRows()).text;
  assert.ok(!without.includes(template === iosxrTemplate ? 'default-originate' : 'default-originate=always'));
  const auto = editServiceValue(rows[0],'ip','198.51.100.1/30');
  assert.equal(auto.peer_ip,'198.51.100.2');
  assert.ok(renderCombined(template,[auto],prefixRows()).text.includes('198.51.100.2'));
  assert.ok(!serviceFields(template).includes('prefix_rules'));
  assert.ok(!serviceFields(template).includes('default_originate'));
  assert.ok(!serviceFields(template).includes('prefix_length'));
}
const xr = renderCombined(iosxrTemplate,builtinRows(iosxrTemplate.id),prefixRows()).text;
assert.ok(xr.startsWith('interface Bundle-Ether1.200'));
assert.ok(!/^vrf /m.test(xr));
assert.ok(!/^\s+rd /m.test(xr));
assert.ok(xr.includes(' vrf IPBW\n  address-family ipv4 unicast'));
assert.ok(xr.includes('interface Bundle-Ether1.200\n description MGMT_RTR-IPBW\n vrf IPBW\n ipv4 address 192.0.2.1 255.255.255.252\n encapsulation dot1q 200'));
assert.equal(xr.match(/^prefix-set /gm).length, 1);
assert.ok(xr.includes('prefix-set MGMT_RTR\n 192.0.2.0/28,\n 192.0.2.16/28 le 29,\n 198.51.100.0/24,\n 203.0.113.240/28,\n 203.0.113.32/29\nend-set'));
assert.ok(xr.includes('route-policy MGMT_RTR\n if destination in MGMT_RTR then\n  pass\n else\n  drop\n endif\nend-policy'));
assert.ok(!xr.includes('MGMT_RTR-10'));
assert.ok(!xr.includes('0.0.0.0/0 le 32'));
const orderedXr = renderCombined(iosxrTemplate,builtinRows(iosxrTemplate.id),[
  {index:'1',action:'permit',network:'192.0.2.0',length:'28',ge:'',le:''},
  {index:'2',action:'deny',network:'192.0.2.0',length:'24',ge:'',le:'32'},
  {index:'3',action:'permit',network:'0.0.0.0',length:'0',ge:'',le:'32'},
]);
assert.deepEqual(orderedXr.errors,[]);
assert.equal(orderedXr.text.match(/^prefix-set /gm).length,1);
assert.ok(orderedXr.text.includes('if destination in (192.0.2.0/24 le 32) and not destination in (192.0.2.0/28) then\n  drop'));
const denyFirst = renderCombined(iosxrTemplate,builtinRows(iosxrTemplate.id),[
  {index:'1',action:'deny',network:'192.0.2.0',length:'24',ge:'',le:'32'},
  {index:'2',action:'permit',network:'0.0.0.0',length:'0',ge:'',le:'32'},
]).text;
assert.ok(denyFirst.includes('if destination in (192.0.2.0/24 le 32) then\n  drop'));
const legacyXr = {...iosxrTemplate,combined:{...iosxrTemplate.combined,
  prefixes:'prefix-set {{policy_name}}-{{index}}\n {{network}}/{{length}}{{#ge}} ge {{ge}}{{/ge}}{{#le}} le {{le}}{{/le}}\nend-set\n!',
  policy:'route-policy {{policy_name}}\n{{prefix_rules}}\n drop\nend-policy\n!\nroute-policy deny-all\n drop\nend-policy\n!',
}};
assert.equal(renderCombined(legacyXr,builtinRows(iosxrTemplate.id),prefixRows()).text,xr);
assert.deepEqual(decodeTemplates(encodeTemplates([legacyXr])),[iosxrTemplate]);
const oldCreationText = 'vrf {{vpn}}\n address-family ipv4 unicast\n exit\nexit\n' + iosxrTemplate.text;
const oldCreationTemplate = {...legacyXr,text:oldCreationText,fields:templateFields(oldCreationText),combined:{...legacyXr.combined,peer:legacyXr.combined.peer.replace(' vrf {{vpn}}\n',' vrf {{vpn}}\n  rd {{local_as}}:{{vlan}}\n')}};
assert.equal(renderCombined(oldCreationTemplate,builtinRows(iosxrTemplate.id),prefixRows()).text,xr);
assert.deepEqual(decodeTemplates(encodeTemplates([oldCreationTemplate])),[iosxrTemplate]);
assert.deepEqual(normalizeConfigTemplate(oldCreationTemplate),iosxrTemplate);
for (const section of ['prefixes','policy','header','peer']) {
  const variables = templateSectionVariables(iosxrTemplate,section);
  assert.ok(['local_as','remote_as','policy_name'].every(field => variables.includes(field)));
  assert.equal(new Set(variables).size,variables.length);
}
assert.ok(templateSectionVariables(iosxrTemplate,'prefixes').includes('network'));
assert.ok(templateSectionVariables(iosxrTemplate,'policy').includes('prefix_rules'));
assert.ok(templateSectionVariables(iosxrTemplate,'peer').includes('peer_as'));
assert.ok(templateSectionVariables(iosxrTemplate,'peer').includes('peer_ip'));
const sharedRemoteHeader = {...iosxrTemplate,combined:{...iosxrTemplate.combined,remoteAs:'64498',header:'! shared remote {{remote_as}}\n'+iosxrTemplate.combined.header}};
const withSharedRemote = renderCombined(sharedRemoteHeader,builtinRows(iosxrTemplate.id),prefixRows());
assert.deepEqual(withSharedRemote.errors,[]);
assert.ok(withSharedRemote.text.includes('! shared remote 64498'));
assert.ok(!serviceFields(sharedRemoteHeader).includes('remote_as'));
assert.equal(xr.match(/^router bgp 64496$/gm).length,1);
assert.equal(xr.match(/default-originate/g).length,1);
assert.ok(xr.includes('route-policy deny-all out'));
assert.ok(!xr.includes('route-map'));
assert.ok(renderCombined(iosxrTemplate,builtinRows(iosxrTemplate.id),[prefixRows()[0],prefixRows()[0]]).errors.length);
const ros = renderCombined(routerosTemplate,builtinRows(routerosTemplate.id),prefixRows()).text;
assert.ok(ros.includes('/interface/vlan add name="vlan200-IPBW" interface="ether1" vlan-id=200'));
assert.ok(ros.includes('/ip/vrf add name="IPBW" interfaces="vlan200-IPBW" place-before=[find where name="main"]'));
assert.ok(ros.includes('/ip/address add address=192.0.2.1/30 interface="vlan200-IPBW"'));
assert.ok(ros.includes('if (dst in 192.0.2.16/28 && dst-len in 28-29) { accept; }'));
assert.ok(ros.includes('if (dst in 0.0.0.0/0 && dst-len in 0-32) { reject; }'));
assert.equal(ros.match(/\/routing\/bgp\/instance add /g).length,5);
assert.equal(ros.match(/\/routing\/bgp\/connection add /g).length,5);
assert.equal(ros.match(/output.default-originate=always/g).length,1);
assert.equal(ros.match(/output.default-originate=never/g).length,4);
assert.ok(ros.includes('chain="MGMT-OUT-IPBW" rule="if (dst == 0.0.0.0/0) { accept; }"'));
assert.ok(ros.includes('chain="MGMT-OUT-IPBW" rule="jump deny-all;"'));
assert.ok(ros.includes('name="BGP-IPBW" as=64496 router-id=192.0.2.1 routing-table="IPBW" vrf="IPBW"'));
const mainRos = renderCombined(routerosMainTemplate,builtinRows(routerosMainTemplate.id),prefixRows());
assert.deepEqual(mainRos.errors,[]);
assert.ok(builtinTemplates.includes(routerosMainTemplate));
assert.ok(!mainRos.text.includes('/ip/vrf'));
assert.ok(!/\bvrf=|routing-table=/.test(mainRos.text));
assert.equal(mainRos.text.match(/\/routing\/bgp\/instance add /g).length,1);
assert.equal(mainRos.text.match(/\/routing\/bgp\/connection add .*instance="BGP-MAIN"/g).length,5);
assert.ok(mainRos.text.includes('/routing/bgp/instance add name="BGP-MAIN" as=64496'));
assert.ok(mainRos.text.includes('/ip/address add address=192.0.2.1/30 interface="vlan200-IPBW"'));
assert.equal(mainRos.text.match(/output.default-originate=always/g).length,1);
assert.equal(mainRos.text.match(/output.default-originate=never/g).length,4);
assert.ok([routerosTemplate,routerosMainTemplate].every(template => template.name.includes('v7') && !template.name.includes('7.20')));
assert.ok(renderCombined(routerosTemplate,[{...builtinRows(routerosTemplate.id)[0],export_policy:'bad name'}],prefixRows()).errors.length);
assert.ok(renderCombined(routerosTemplate,builtinRows(routerosTemplate.id),[{...prefixRows()[0],network:'192.0.2.1'}]).errors.length);
for (let length = 0; length <= 32; length++) {
  const bits = prefixToMask(String(length)).split('.').map(part => Number(part).toString(2).padStart(8, '0')).join('');
  assert.equal(bits, '1'.repeat(length) + '0'.repeat(32 - length));
  assert.equal(prefixToMask(`/${length}`), prefixToMask(String(length)));
}
assert.deepEqual(normalizeInterfaceAddress({ip: '192.0.2.3/31', mask: '255.255.255.0'}), {ip: '192.0.2.3', mask: '255.255.255.254'});
assert.deepEqual(normalizeInterfaceAddress({ip: '192.0.2.1', mask: '/30'}), {ip: '192.0.2.1', mask: '255.255.255.252'});
const typingCidr = editServiceValue({ip: '192.0.2.1', mask: '255.255.255.0'}, 'ip', '192.0.2.1/30');
assert.equal(typingCidr.ip, '192.0.2.1/30');
assert.equal(typingCidr.mask, '255.255.255.252');
assert.deepEqual(editServiceValue(typingCidr, 'mask', '/29'), {ip: '192.0.2.1', mask: '/29', peer_ip: '192.0.2.2'});
for (const [ip, mask, peer] of [
  ['192.0.2.1', '/30', '192.0.2.2'], ['192.0.2.2', '255.255.255.252', '192.0.2.1'],
  ['192.0.2.0', '/31', '192.0.2.1'], ['192.0.2.1', '/31', '192.0.2.0'],
  ['192.0.2.254', '/24', '192.0.2.253'], ['192.0.2.10', '/24', '192.0.2.11'],
  ['192.0.2.0', '/30', ''], ['192.0.2.3', '/30', ''], ['192.0.2.1', '/32', ''],
  ['192.0.2.1', '255.0.255.0', ''], ['192.0.2.', '/30', ''],
  ['192.0.2.1/30', '', '192.0.2.2'], ['255.255.255.254', '/31', '255.255.255.255'],
]) assert.equal(automaticPeerIp({ip, mask}), peer);
const autoPeer = editServiceValue(combinedRows()[0], 'ip', '198.51.100.1/30');
assert.equal(autoPeer.peer_ip, '198.51.100.2');
assert.equal(editServiceValue(autoPeer, 'ip', '198.51.100.2').peer_ip, '198.51.100.1');
assert.equal(editServiceValue(autoPeer, 'ip', '198.51.100.').peer_ip, '');
const manualPeer = editServiceValue(autoPeer, 'peer_ip', '203.0.113.1');
assert.equal(manualPeer.peer_ip_mode, 'manual');
assert.equal(editServiceValue(manualPeer, 'ip', '198.51.100.5/30').peer_ip, '203.0.113.1');
assert.equal(editServiceValue(manualPeer, 'mask', '/31').peer_ip, '203.0.113.1');
assert.equal(editServiceValue(manualPeer, 'peer_ip_mode', 'auto').peer_ip, '198.51.100.2');
for (const vendor of [combinedTemplate, ciscoTemplate, juniperTemplate, juniperLogicalTemplate]) {
  const data = builtinRows(vendor.id);
  data[0] = editServiceValue(data[0], 'ip', '198.51.100.1/30');
  const result = renderCombined(vendor, data, prefixRows());
  assert.deepEqual(result.errors, []);
  assert.ok(result.text.includes(vendor === combinedTemplate ? 'peer 198.51.100.2 as-number' : vendor === ciscoTemplate ? 'neighbor 198.51.100.2 remote-as' : 'neighbor 198.51.100.2 peer-as'));
}
assert.equal(editServiceValue(typingCidr, 'ip', '192.0.2.1/').ip, '192.0.2.1/');
for (const template of [huaweiTemplate, combinedTemplate, ciscoTemplate, juniperTemplate, juniperLogicalTemplate]) {
  const standard = builtinRows(template.id);
  const expected = renderCombined(template, standard, prefixRows()).text;
  for (const kind of ['cidr', 'numeric', 'slash']) {
    const entered = standard.map(row => kind === 'cidr' ? {...row, ip: `${row.ip}/30`, mask: ''} : {...row, mask: kind === 'numeric' ? '30' : '/30'});
    const result = renderCombined(template, entered, prefixRows());
    assert.deepEqual(result.errors, []);
    assert.equal(result.text, expected);
  }
}
for (const ip of ['192.0.2.1/33', '192.0.2.1/-1', '192.0.2.1/3.5', '192.0.2.1/', '256.0.2.1/30', '192.0.2/30', '2001:db8::1/64', '192.0.2.1//30', '192.0.2.1/30/1']) {
  const result = renderCombined(combinedTemplate, [{...combinedRows()[0], ip}], prefixRows());
  assert.equal(result.text, '');
  assert.match(result.errors.join(' '), /Row 1/);
}
for (const mask of ['/33', '33', '-1', '/-1', '/']) assert.throws(() => normalizeInterfaceAddress({ip: '192.0.2.1', mask}));
assert.equal(renderTemplate(huaweiTemplate.text, huaweiRows()).text, expectedHuawei);
const combined = renderCombined(combinedTemplate, combinedRows(), prefixRows());
assert.deepEqual(combined.errors, []);
const expectedPrefixes = `ip ip-prefix MGMT_RTR index 10 permit 192.0.2.0 28 greater-equal 28 less-equal 28
ip ip-prefix MGMT_RTR index 11 permit 192.0.2.16 28 greater-equal 28 less-equal 29
ip ip-prefix MGMT_RTR index 12 permit 198.51.100.0 24
ip ip-prefix MGMT_RTR index 13 permit 203.0.113.240 28
ip ip-prefix MGMT_RTR index 14 permit 203.0.113.32 29
ip ip-prefix MGMT_RTR index 255 deny 0.0.0.0 0 less-equal 32
route-policy MGMT_RTR permit node 10
 if-match ip-prefix MGMT_RTR
#`;
const expectedBgp = `bgp 64496\n #\n ipv4-family unicast\n #\n` + ['IPBW', 'GGC', 'FNA', 'CDN', 'BDIX'].map((vpn, index) => ` ipv4-family vpn-instance ${vpn}\n  peer 192.0.2.${2 + index * 4} as-number 64497\n  peer 192.0.2.${2 + index * 4} route-policy MGMT_RTR import\n  peer 192.0.2.${2 + index * 4} route-policy ${index === 0 ? 'deny-all' : `CLIENT-${vpn}-OUT`} export\n${index === 0 ? '  peer 192.0.2.2 default-route-advertise\n' : ''} #`).join('\n');
assert.equal(combined.text, [expectedHuawei, expectedPrefixes, expectedBgp].join('\n'));
assert.equal(combined.text.match(/^bgp /gm).length, 1);
const changedRows = combinedRows();
changedRows[0].advertise_default = '';
changedRows[1].advertise_default = 'true';
changedRows[1].vpn = 'OTHER';
changedRows[1].peer_ip = '192.0.2.1';
const changed = renderCombined(combinedTemplate, changedRows, prefixRows()).text;
assert.ok(!changed.includes('192.0.2.2 default-route-advertise'));
assert.ok(changed.includes('192.0.2.1 default-route-advertise'));
assert.ok(changed.includes('ip binding vpn-instance OTHER'));
assert.ok(changed.includes('ipv4-family vpn-instance OTHER'));
changedRows[2].peer_as = '';
changedRows[2].peer_as_override = 'true';
assert.match(renderCombined(combinedTemplate, changedRows, prefixRows()).errors.join(' '), /Row 3: peer_as/);
for (const template of [combinedTemplate, ciscoTemplate, juniperTemplate, juniperLogicalTemplate]) {
  const shared = {...template, combined: {...template.combined, remoteAs: '64498'}};
  const data = builtinRows(template.id);
  const inherited = renderCombined(shared, data, prefixRows());
  assert.deepEqual(inherited.errors, []);
  assert.equal(inherited.text.match(/(?:as-number|remote-as|peer-as) 64498/g).length, 5);
  // Existing mounted rows may still contain values from before the shared field existed.
  const oldRows = data.map(row => ({...row, peer_as: '64497'}));
  assert.equal(remoteAsOverridden(oldRows[0], shared.combined), false);
  assert.equal(effectiveRemoteAs(oldRows[0], shared.combined), '64498');
  assert.equal(renderCombined(shared, oldRows, prefixRows()).text.match(/(?:as-number|remote-as|peer-as) 64498/g).length, 5);
  const updatedShared = {...shared, combined: {...shared.combined, remoteAs: '64500'}};
  assert.equal(effectiveRemoteAs(oldRows[0], updatedShared.combined), '64500');
  assert.equal(renderCombined(updatedShared, oldRows, prefixRows()).text.match(/(?:as-number|remote-as|peer-as) 64500/g).length, 5);
  data[1] = editServiceValue(data[1], 'peer_as', '64499');
  const overridden = renderCombined(shared, data, prefixRows());
  assert.equal(overridden.text.match(/(?:as-number|remote-as|peer-as) 64498/g).length, 4);
  assert.equal(overridden.text.match(/(?:as-number|remote-as|peer-as) 64499/g).length, 1);
  data[1].peer_as_override = 'false';
  assert.equal(renderCombined(shared, data, prefixRows()).text.match(/(?:as-number|remote-as|peer-as) 64498/g).length, 5);
  assert.deepEqual(decodeTemplates(encodeTemplates([shared])), [shared]);
  data[1] = editServiceValue(data[1], 'peer_as', '');
  assert.match(renderCombined(shared, data, prefixRows()).errors.join(' '), /Row 2: peer_as/);
  assert.ok(renderCombined({...shared, combined: {...shared.combined, remoteAs: '4294967296'}}, builtinRows(template.id), prefixRows()).errors.length);
  const legacy = {...template, combined: {...template.combined}};
  delete legacy.combined.remoteAs;
  const legacyData = builtinRows(template.id).map(row => ({...row, peer_as: '64497'}));
  assert.deepEqual(renderCombined(legacy, legacyData, prefixRows()).errors, []);
  assert.deepEqual(decodeTemplates(encodeTemplates([legacy])), [legacy]);
}
for (const peer of ['{{#advertise_default}}x', '{{/advertise_default}}', '{{#a}}x{{/b}}', '{{#a}}{{#b}}x{{/b}}{{/a}}', '{{#bad-name}}x{{/bad-name}}']) {
  assert.ok(renderCombined({...combinedTemplate, combined: {...combinedTemplate.combined, peer}}, combinedRows(), prefixRows()).errors.length);
}
const combinedSaved = encodeTemplates([{...combinedTemplate, rows: combinedRows(), prefixRows: prefixRows()}]);
assert.deepEqual(decodeTemplates(combinedSaved), [combinedTemplate]);
assert.ok(!combinedSaved.includes('192.0.2.0'));
assert.ok(!combinedSaved.includes('192.0.2.2'));
assert.equal(renderCombined(decodeTemplates(combinedSaved)[0], [{}], [{}]).text, '');
assert.equal(renderCombined(huaweiTemplate, huaweiRows(), []).text, expectedHuawei);
assert.ok(renderCombined(combinedTemplate, combinedRows(), [{index: '1'}]).errors.length);
assert.ok(renderCombined({...combinedTemplate, combined: {...combinedTemplate.combined, localAs: ''}}, combinedRows(), prefixRows()).errors.length);
for (const vendor of [ciscoTemplate, juniperTemplate, juniperLogicalTemplate]) {
  const data = builtinRows(vendor.id);
  const generated = renderCombined(vendor, data, prefixRows());
  assert.deepEqual(generated.errors, []);
  assert.equal(generated.count, 5);
  assert.ok(!generated.text.includes('{{'));
  assert.deepEqual(decodeTemplates(encodeTemplates([vendor])), [vendor]);
  assert.equal(renderCombined(decodeTemplates(encodeTemplates([vendor]))[0], [{}], [{}]).text, '');
  const changed = data.map(row => ({...row, advertise_default: ''}));
  const noDefault = renderCombined(vendor, changed, prefixRows()).text;
  assert.ok(!noDefault.includes('default-originate'));
  assert.ok(!noDefault.includes('static route 0.0.0.0/0'));
  changed[2].advertise_default = 'true';
  changed[2].peer_ip = '192.0.2.2';
  const newDefault = renderCombined(vendor, changed, prefixRows()).text;
  assert.ok(vendor === ciscoTemplate ? newDefault.includes('neighbor 192.0.2.2 default-originate') : newDefault.includes('routing-instances FNA routing-options static route 0.0.0.0/0 no-install'));
}
const cisco = renderCombined(ciscoTemplate, builtinRows(ciscoTemplate.id), prefixRows()).text;
assert.ok(cisco.includes('interface Port-channel1.200\n description MGMT_RTR-IPBW\n encapsulation dot1Q 200\n vrf forwarding IPBW\n ip address 192.0.2.1 255.255.255.252'));
assert.ok(cisco.includes('rd 64496:200'));
assert.ok(cisco.includes('ip prefix-list MGMT_RTR seq 10 permit 192.0.2.0/28\n'));
assert.ok(cisco.includes('ip prefix-list MGMT_RTR seq 11 permit 192.0.2.16/28 le 29'));
assert.ok(cisco.includes('ip prefix-list MGMT_RTR seq 255 deny 0.0.0.0/0 le 32'));
assert.equal(cisco.match(/^router bgp 64496$/gm).length, 1);
assert.equal(cisco.match(/default-originate/g).length, 1);
assert.ok(cisco.includes('neighbor 192.0.2.2 route-map deny-all out'));
const junos = renderCombined(juniperTemplate, builtinRows(juniperTemplate.id), prefixRows()).text;
assert.ok(junos.includes('set interfaces ae1 unit 200 family inet address 192.0.2.1/30'));
assert.ok(junos.includes('set routing-instances IPBW instance-type virtual-router'));
assert.ok(junos.includes('term prefix-11 from route-filter 192.0.2.16/28 prefix-length-range /28-/29'));
assert.ok(junos.includes('term prefix-12 from route-filter 198.51.100.0/24 exact'));
assert.ok(junos.includes('term prefix-255 then reject'));
assert.ok(junos.includes('neighbor 192.0.2.2 export [ DEFAULT-IPBW deny-all ]'));
assert.ok(junos.includes('neighbor 192.0.2.6 export [ CLIENT-GGC-OUT ]'));
assert.equal(junos.match(/^set routing-options autonomous-system /gm).length, 1);
assert.equal(junos.match(/static route 0.0.0.0\/0 no-install/g).length, 1);
assert.ok(renderCombined(juniperTemplate, [{...builtinRows(juniperTemplate.id)[0], mask: '255.0.255.0'}], prefixRows()).errors.length);
assert.ok(renderCombined(ciscoTemplate, builtinRows(ciscoTemplate.id), [{...prefixRows()[0], ge: '33'}]).errors.length);
const logicalRows = builtinRows(juniperLogicalTemplate.id);
const logical = renderCombined(juniperLogicalTemplate, logicalRows, prefixRows());
assert.deepEqual(logical.errors, []);
for (const row of logicalRows) {
  const scope = `set logical-systems ${row.logical_system}`;
  assert.ok(logical.text.includes(`${scope} interfaces ae1 unit ${row.vlan} family inet address ${row.ip}/30`));
  assert.ok(logical.text.includes(`${scope} routing-instances ${row.vpn} interface ae1.${row.vlan}`));
  assert.ok(logical.text.includes(`${scope} policy-options policy-statement MGMT_RTR term prefix-11 from route-filter 192.0.2.16/28 prefix-length-range /28-/29`));
  assert.ok(logical.text.includes(`${scope} routing-options autonomous-system 64496`));
}
assert.ok(logical.text.includes('set logical-systems LS-IPBW routing-instances IPBW routing-options static route 0.0.0.0/0 discard'));
assert.ok(logical.text.includes('set logical-systems LS-IPBW policy-options policy-statement DEFAULT-IPBW term default then accept'));
assert.ok(!/^set (policy-options|routing-options|routing-instances) /m.test(logical.text));
assert.ok(!/^set interfaces ae1 unit /m.test(logical.text));
assert.ok(logical.text.includes('set interfaces ae1 vlan-tagging'));
logicalRows[1].logical_system = 'LS-IPBW';
const sharedLogical = renderCombined(juniperLogicalTemplate, logicalRows, prefixRows()).text;
assert.equal(sharedLogical.match(/set logical-systems LS-IPBW policy-options policy-statement MGMT_RTR term prefix-11 then accept/g).length, 1);
logicalRows[1].logical_system = '';
assert.match(renderCombined(juniperLogicalTemplate, logicalRows, prefixRows()).errors.join(' '), /Row 2: logical_system/);
assert.deepEqual(templateFields('{{vlan}} {{vpn}} {{vlan}}'), ['vlan', 'vpn']);
assert.equal(renderTemplate('  {{x}} {{x}}\n#', [{x: '$&{{vpn}}'}, {}, {x: 'two'}]).text, '  $&{{vpn}} $&{{vpn}}\n#\n  two two\n#');
assert.match(renderTemplate('{{x}} {{y}}', [{x: 'one'}]).errors[0], /Row 1: y/);
assert.match(renderTemplate('{{x}}', [{x: 'one\ntwo'}]).errors[0], /single line/);
assert.equal(renderTemplate('{{x}}', [{}]).text, '');
assert.equal(renderTemplate('{{__proto__}} {{constructor}}', [{}]).text, '');
assert.ok(renderTemplate('x'.repeat(10001), []).errors.length);
assert.ok(renderTemplate('{{x}}', Array.from({length: 201}, () => ({x: 'a'.repeat(10000)}))).errors.length);
const stored = {...huaweiTemplate, id: 'saved', rows: huaweiRows()};
const encoded = encodeTemplates([stored]);
assert.ok(!encoded.includes('192.0.2.1'));
assert.ok(!encoded.includes('rows'));
assert.deepEqual(decodeTemplates(encoded), [{...huaweiTemplate, id: 'saved'}]);
assert.deepEqual(decodeTemplates(null), []);
for (const raw of ['invalid', '{}', '{"version":2,"templates":[]}', JSON.stringify({version: 1, templates: [{...stored, fields: ['wrong']}]}), encodeTemplates([stored, stored])]) assert.throws(() => decodeTemplates(raw));
import { generateConfig, simpleSections, replaceSimpleSection, moveBlock, findBlock, isLoop } from '../src/config-generator.ts';
const commands = [{ id: '1', text: 'interface eth 0/{n}' }, { id: '2', text: ' no shutdown' }];
assert.equal(generateConfig(commands, '1', '2', '1').text, 'interface eth 0/1\n no shutdown\ninterface eth 0/2\n no shutdown');
assert.equal(generateConfig([{ id: '1', text: '{n}-{n}' }], '3', '1', '-1').text, '3-3\n2-2\n1-1');
assert.equal(generateConfig(commands, '1', '6', '2').count, 3);
for (const range of [['', '2', '1'], ['1', '2', '0'], ['3', '1', '1'], ['0', '10000', '1'], ['1.5', '2', '1']]) {
  assert.ok(generateConfig(commands, ...range).error);
}
assert.ok(generateConfig([], '1', '2', '1').error);
assert.ok(generateConfig([{ id: '1', text: 'x'.repeat(1000) }], '1', '10000', '1').error);

const inner = { id: 'inner', kind: 'loop', start: '1', end: '2', step: '1', children: [
  { id: 'port', text: 'interface eth {n}/{n2}' }, { id: 'enable', text: ' no shutdown' },
] };
const tree = [{ id: 'before', text: 'slot {n}' }, inner, { id: 'after', text: 'exit' }];
assert.equal(generateConfig(tree, '0', '1', '1').text,
  'slot 0\ninterface eth 0/1\n no shutdown\ninterface eth 0/2\n no shutdown\nexit\nslot 1\ninterface eth 1/1\n no shutdown\ninterface eth 1/2\n no shutdown\nexit');
const third = { id: 'third', kind: 'loop', start: '4', end: '2', step: '-2', children: [{ id: 'three', text: '{n}/{n2}/{n3}' }] };
assert.equal(generateConfig([{ ...inner, children: [third] }], '1', '1', '1').text, '1/1/4\n1/1/2\n1/2/4\n1/2/2');
assert.ok(generateConfig([{ id: 'bad', text: '{n2}' }], '1', '2', '1').error);
assert.ok(generateConfig([{ ...inner, step: '0' }], '1', '2', '1').error);
assert.ok(generateConfig([{ ...inner, end: '10000' }], '1', '10000', '1').error);
assert.deepEqual(moveBlock(tree, 'inner', 'inner'), tree);
assert.deepEqual(moveBlock([{ ...inner, children: [third] }], 'inner', 'third'), [{ ...inner, children: [third] }]);
const movedIn = moveBlock(tree, 'before', 'inner', 'port');
assert.equal(movedIn.length, 2);
assert.equal(findBlock(movedIn, 'inner').children[0].id, 'before');
const movedOut = moveBlock(tree, 'port', 'root', 'before');
assert.equal(movedOut[0].id, 'port');
assert.equal(findBlock(movedOut, 'inner').children.length, 1);
assert.ok(isLoop(findBlock(movedOut, 'inner')));
assert.equal(tree[1].children.length, 2, 'moves must not mutate original tree');
let deep = [{ id: 'leaf', text: 'x' }];
for (let i = 0; i < 8; i++) deep = [{ ...inner, id: `depth${i}`, children: deep }];
assert.ok(generateConfig(deep, '1', '1', '1').error);
// Switching to Simple must describe branching trees without flattening loops.
const branching = [
  { id: 'intro1', text: 'configure' }, { id: 'intro2', text: 'slot {n}' },
  inner,
  { id: 'finish', text: 'exit' },
  { ...inner, id: 'sibling', start: '7', end: '8', children: [{ id: 'siblingText', text: 'vlan {n2}' }] },
];
const original = JSON.parse(JSON.stringify(branching));
function simpleRoundTrip(blocks) {
  return simpleSections(blocks).flatMap(section => Array.isArray(section)
    ? [{ id: section[0].id, text: section.map(command => command.text).join('\n') }]
    : [{ ...section, children: simpleRoundTrip(section.children) }]);
}
assert.deepEqual(generateConfig(simpleRoundTrip(branching), '1', '2', '1'), generateConfig(branching, '1', '2', '1'));
assert.deepEqual(branching, original, 'showing Simple view must not mutate the tree');
const rootEdit = replaceSimpleSection(branching, 'root', ['intro1', 'intro2'], 'updated slot {n}');
assert.equal(rootEdit[0].text, 'updated slot {n}');
assert.deepEqual(rootEdit.slice(1), branching.slice(2), 'editing commands before a loop must retain all later blocks');
const innerEdit = replaceSimpleSection(branching, 'inner', ['port', 'enable'], 'port {n}/{n2}\n enable');
assert.equal(findBlock(innerEdit, 'inner').children.length, 1);
assert.equal(findBlock(innerEdit, 'inner').children[0].text, 'port {n}/{n2}\n enable');
assert.deepEqual(findBlock(innerEdit, 'sibling'), findBlock(branching, 'sibling'));
assert.deepEqual(generateConfig(simpleRoundTrip([{ ...inner, children: [third] }]), '1', '2', '1'), generateConfig([{ ...inner, children: [third] }], '1', '2', '1'));
assert.deepEqual(simpleSections([]), []);

// Repeated range edits always regenerate from the requested first number.
for (const [start, end, step, expected] of [
  ['1', '60', '1', 60], ['1', '20', '1', 20],
  ['10', '14', '2', 3], ['3', '1', '-1', 3], ['1', '2', '1', 2],
]) {
  const result = generateConfig(commands, start, end, step);
  assert.equal(result.error, '');
  assert.equal(result.count, expected);
  assert.equal(result.text.split('\n').length, expected * 2);
  assert.equal(result.text.split('\n')[0], `interface eth 0/${start}`);
  assert.equal(result.text.split('\n').at(-2), `interface eth 0/${Number(start) + (expected - 1) * Number(step)}`);
}

// Description fields must affect the generated commands on every built-in platform.
for (const template of builtinTemplates) {
  assert.ok(serviceFields(template).includes('interface_description'));
  if (template.combined) assert.ok(serviceFields(template).includes('client_description'));
  const rows = builtinRows(template.id).map(row => ({ ...row, interface_description: 'Customer uplink', client_description: 'Customer BGP' }));
  const result = renderCombined(template, rows, prefixRows());
  assert.deepEqual(result.errors, []);
  assert.ok(result.text.includes('Customer uplink'));
  if (template.combined) assert.ok(result.text.includes('Customer BGP'));
  const blank = renderCombined(template, rows.map(row => ({ ...row, interface_description: '', client_description: '' })), prefixRows());
  assert.deepEqual(blank.errors, []);
  assert.ok(!blank.text.includes('Customer'));
}
