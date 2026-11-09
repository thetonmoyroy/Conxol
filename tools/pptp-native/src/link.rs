use crate::{
    control::Control,
    gre::Gre,
    mppe::Codec,
    ppp::{Authenticated, decode_packet, decode_ppp, options, packet},
};
use std::{
    error::Error,
    net::Ipv4Addr,
    time::{Duration, Instant},
};
const CCP: u16 = 0x80fd;
const IPCP: u16 = 0x8021;
const MPPE: &[u8] = &[18, 6, 1, 0, 0, 0x40];
type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn unicast(ip: Ipv4Addr) -> bool {
    !ip.is_unspecified()
        && !ip.is_loopback()
        && !ip.is_multicast()
        && ip != Ipv4Addr::BROADCAST
        && ip.octets()[0] != 0
        && ip.octets()[0] < 240
}
struct Ncp {
    protocol: u16,
    id: u8,
    request: Vec<u8>,
    own_ack: bool,
    peer_ack: bool,
    peer_request: Option<(u8, Vec<u8>)>,
    peer_ip: Option<Ipv4Addr>,
    rounds: u8,
}
impl Ncp {
    fn new(protocol: u16) -> Self {
        Self {
            protocol,
            id: 1,
            request: if protocol == CCP {
                MPPE.to_vec()
            } else {
                vec![3, 6, 0, 0, 0, 0]
            },
            own_ack: false,
            peer_ack: false,
            peer_request: None,
            peer_ip: None,
            rounds: 0,
        }
    }
    fn ready(&self) -> bool {
        self.own_ack && self.peer_ack
    }
    fn handle(&mut self, code: u8, id: u8, body: &[u8]) -> Result<Option<Vec<u8>>> {
        self.rounds = self.rounds.checked_add(1).ok_or("NCP negotiation limit")?;
        if self.rounds > 32 {
            return Err("NCP negotiation limit exceeded".into());
        }
        match code {
            1 => {
                let (reply, payload) = if self.protocol == CCP {
                    ccp_config(body)?
                } else {
                    ipcp_config(body)?
                };
                self.peer_ack = reply == 2;
                if self.peer_ack {
                    self.peer_request = Some((id, body.to_vec()));
                    if self.protocol == IPCP {
                        self.peer_ip = options(body)
                            .and_then(|opts| opts.into_iter().find(|o| o[0] == 3))
                            .map(|o| Ipv4Addr::new(o[2], o[3], o[4], o[5]));
                    }
                }
                Ok(Some(packet(reply, id, &payload)))
            }
            2 if id == self.id && body == self.request => {
                if self.protocol == IPCP && !unicast(self.local_ip().ok_or("missing IPCP address")?)
                {
                    return Err("server acknowledged an invalid local address".into());
                }
                self.own_ack = true;
                Ok(None)
            }
            3 if id == self.id => {
                if self.protocol == CCP {
                    if body != MPPE {
                        return Err("server does not accept required stateless 128-bit MPPE".into());
                    }
                } else {
                    let opts = options(body).ok_or("invalid IPCP Configure-Nak")?;
                    if opts.len() != 1 || opts[0].len() != 6 || opts[0][0] != 3 {
                        return Err("unsupported IPCP Configure-Nak".into());
                    }
                    let o = opts[0];
                    let ip = Ipv4Addr::new(o[2], o[3], o[4], o[5]);
                    if !unicast(ip) {
                        return Err("invalid offered IPCP address".into());
                    }
                    self.request = body.to_vec();
                }
                self.id = self.id.wrapping_add(1);
                self.own_ack = false;
                Ok(Some(packet(1, self.id, &self.request)))
            }
            4 if id == self.id => Err("server rejected required MPPE/IPCP options".into()),
            5 | 6 => Err("server terminated MPPE/IPCP negotiation".into()),
            14 if self.protocol == CCP => Ok(Some(packet(15, id, body))),
            _ => Ok(None),
        }
    }
    fn local_ip(&self) -> Option<Ipv4Addr> {
        let o = options(&self.request)?
            .into_iter()
            .find(|o| o[0] == 3 && o.len() == 6)?;
        Some(Ipv4Addr::new(o[2], o[3], o[4], o[5]))
    }
    fn repeats_peer(&self, id: u8, body: &[u8]) -> bool {
        self.peer_request
            .as_ref()
            .is_some_and(|(i, b)| *i == id && b == body)
    }
}
fn ccp_config(body: &[u8]) -> Result<(u8, Vec<u8>)> {
    let opts = options(body).ok_or("invalid CCP options")?;
    let mut rejected = Vec::new();
    for opt in &opts {
        if opt[0] != 18 || opt.len() != 6 {
            rejected.extend_from_slice(opt);
        }
    }
    if !rejected.is_empty() {
        return Ok((4, rejected));
    }
    if body == MPPE {
        Ok((2, body.to_vec()))
    } else {
        Ok((3, MPPE.to_vec()))
    }
}
fn ipcp_config(body: &[u8]) -> Result<(u8, Vec<u8>)> {
    let opts = options(body).ok_or("invalid IPCP options")?;
    let mut rejected = Vec::new();
    let mut addresses = 0;
    for opt in opts {
        if opt[0] == 3 && opt.len() == 6 {
            addresses += 1;
            if addresses > 1 || !unicast(Ipv4Addr::new(opt[2], opt[3], opt[4], opt[5])) {
                return Err("invalid peer IPCP address".into());
            }
        } else {
            rejected.extend_from_slice(opt);
        }
    }
    if !rejected.is_empty() {
        Ok((4, rejected))
    } else {
        Ok((2, body.to_vec()))
    }
}

pub struct Link<'a> {
    control: &'a mut Control,
    gre: &'a mut Gre,
    peer: u16,
    codec: Codec,
    magic: [u8; 4],
    ccp: Ncp,
    ipcp: Ncp,
    pub local_ip: Ipv4Addr,
    pub peer_ip: Ipv4Addr,
    pub sent: u64,
    pub received: u64,
    pub mtu: usize,
    pub encrypted_received: u64,
    pub other_received: u64,
}
impl<'a> Link<'a> {
    pub fn negotiate(
        control: &'a mut Control,
        gre: &'a mut Gre,
        peer: u16,
        auth: Authenticated,
    ) -> Result<Self> {
        let mut ccp = Ncp::new(CCP);
        let mut ipcp = Ncp::new(IPCP);
        let deadline = Instant::now() + Duration::from_secs(25);
        let mut retry = Instant::now();
        while Instant::now() < deadline {
            if Instant::now() >= retry {
                for ncp in [&ccp, &ipcp] {
                    if !ncp.own_ack {
                        gre.send(peer, ncp.protocol, &packet(1, ncp.id, &ncp.request))?;
                    }
                }
                retry = Instant::now() + Duration::from_secs(2);
            }
            if let Some((kind, body)) = control.poll()? {
                control.service(kind, &body)?;
            }
            let Some(bytes) = gre.receive(peer)? else {
                continue;
            };
            let Some((proto, body)) = decode_ppp(&bytes) else {
                continue;
            };
            if proto == 0x00fd {
                continue;
            } // no IP may enter the stack until both NCPs are open
            let Some((code, id, body)) = decode_packet(body) else {
                continue;
            };
            match proto {
                CCP | IPCP => {
                    let ncp = if proto == CCP { &mut ccp } else { &mut ipcp };
                    if let Some(reply) = ncp.handle(code, id, body)? {
                        gre.send(peer, proto, &reply)?;
                    }
                    println!(
                        "NCP: {} code {code}; local ack={}, peer ack={}.",
                        if proto == CCP { "CCP" } else { "IPCP" },
                        ncp.own_ack,
                        ncp.peer_ack
                    );
                }
                0xc021 => service_lcp(gre, peer, &auth.magic, code, id, body)?,
                0xc223 if code == 4 => {
                    return Err("server rejected authentication after link setup".into());
                }
                _ => {}
            }
            if ccp.ready() && ipcp.ready() {
                let local_ip = ipcp.local_ip().ok_or("no local IPCP address")?;
                let peer_ip = ipcp.peer_ip.ok_or("server omitted its IPCP address")?;
                if local_ip == peer_ip {
                    return Err("peer and local IPCP addresses are identical".into());
                }
                println!("PASS: stateless 128-bit MPPE negotiated in both directions.");
                println!("PASS: IPCP assigned private interface and peer addresses (not logged).");
                return Ok(Self {
                    control,
                    gre,
                    peer,
                    codec: Codec::new(auth.keys),
                    magic: auth.magic,
                    ccp,
                    ipcp,
                    local_ip,
                    peer_ip,
                    sent: 0,
                    received: 0,
                    mtu: 1360.min(auth.peer_mru.saturating_sub(4)),
                    encrypted_received: 0,
                    other_received: 0,
                });
            }
        }
        Err(format!(
            "MPPE/IPCP negotiation timed out: CCP open={}, IPCP open={}",
            ccp.ready(),
            ipcp.ready()
        )
        .into())
    }
    pub fn send_ipv4(&mut self, ip: &[u8]) -> Result<()> {
        if ip.len() < 20 || ip.len() > self.mtu || ip[12..16] != self.local_ip.octets() {
            return Err("outbound IP source/size is outside private tunnel".into());
        }
        let encrypted = self.codec.encrypt_ipv4(ip)?;
        self.gre.send(self.peer, 0xfd, &encrypted)?;
        self.sent += 1;
        Ok(())
    }
    pub fn poll(&mut self) -> Result<Option<Vec<u8>>> {
        if let Some((kind, body)) = self.control.poll()? {
            self.control.service(kind, &body)?;
        }
        let Some(bytes) = self.gre.receive(self.peer)? else {
            return Ok(None);
        };
        let Some((proto, body)) = decode_ppp(&bytes) else {
            return Ok(None);
        };
        if proto == 0xfd {
            self.encrypted_received += 1;
            let decoded = self.codec.decrypt_ipv4(body)?;
            if let Some(ip) = &decoded {
                if ip[16..20] != self.local_ip.octets() {
                    return Ok(None);
                }
                self.received += 1;
            }
            return Ok(decoded);
        }
        self.other_received += 1;
        if proto == 0x21 {
            return Err("unencrypted IPv4 rejected; MPPE is required".into());
        }
        let Some((code, id, body)) = decode_packet(body) else {
            return Ok(None);
        };
        match proto {
            0xc021 => service_lcp(self.gre, self.peer, &self.magic, code, id, body)?,
            CCP | IPCP => {
                let ncp = if proto == CCP { &self.ccp } else { &self.ipcp };
                match code {
                    1 if ncp.repeats_peer(id, body) => {
                        self.gre.send(self.peer, proto, &packet(2, id, body))?
                    }
                    14 if proto == CCP => self.gre.send(self.peer, proto, &packet(15, id, body))?,
                    2 | 15 => {}
                    _ => {
                        return Err(
                            "tunnel network/encryption configuration changed; connection closed"
                                .into(),
                        );
                    }
                }
            }
            _ => {}
        }
        Ok(None)
    }
}
fn service_lcp(
    gre: &mut Gre,
    peer: u16,
    magic: &[u8; 4],
    code: u8,
    id: u8,
    body: &[u8],
) -> Result<()> {
    match code {
        9 => {
            let mut reply = magic.to_vec();
            if body.len() > 4 {
                reply.extend_from_slice(&body[4..]);
            }
            gre.send(peer, 0xc021, &packet(10, id, &reply))?;
        }
        5 => {
            gre.send(peer, 0xc021, &packet(6, id, body))?;
            return Err("server terminated PPP link".into());
        }
        1 | 6 | 7 | 8 => return Err("PPP link restarted or rejected required protocol".into()),
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_mppe_downgrade_and_mismatched_ack() {
        let mut ccp = Ncp::new(CCP);
        ccp.handle(2, 99, MPPE).unwrap();
        assert!(!ccp.own_ack);
        assert!(ccp.handle(3, 1, &[18, 6, 0, 0, 0, 0x20]).is_err());
        assert_eq!(
            ccp_config(&[18, 6, 1, 0, 0, 0xe0]).unwrap(),
            (3, MPPE.to_vec())
        );
        assert_eq!(ccp_config(&[18, 6, 0, 0, 0, 0x40]).unwrap().0, 3);
        assert_eq!(ccp_config(MPPE).unwrap().0, 2);
    }
    #[test]
    fn ipcp_assigns_addresses_and_rejects_vj_compression() {
        let mut ipcp = Ncp::new(IPCP);
        assert!(ipcp.handle(2, 1, &[3, 6, 0, 0, 0, 0]).is_err());
        let offered = [3, 6, 192, 0, 2, 2];
        ipcp.handle(3, 1, &offered).unwrap();
        ipcp.handle(2, 2, &offered).unwrap();
        assert!(ipcp.own_ack);
        let remote = [3, 6, 192, 0, 2, 1];
        ipcp.handle(1, 7, &remote).unwrap();
        assert!(ipcp.ready());
        assert_eq!(ipcp.local_ip(), Some(Ipv4Addr::new(192, 0, 2, 2)));
        assert_eq!(ipcp.peer_ip, Some(Ipv4Addr::new(192, 0, 2, 1)));
        assert_eq!(
            ipcp_config(&[2, 4, 0, 0x2d]).unwrap(),
            (4, vec![2, 4, 0, 0x2d])
        );
        assert!(ipcp_config(&[3, 6, 127, 0, 0, 1]).is_err());
    }
}
