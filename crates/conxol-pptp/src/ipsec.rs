//! Private IKEv1 PSK / ESP transport. No system IPsec policy or routes.
use aes::cipher::{BlockModeDecrypt, BlockModeEncrypt, KeyIvInit, block_padding::NoPadding};
use crypto_bigint::{Encoding, U256, U2048, const_monty_params, modular::ConstMontyForm};
use sha1::{Digest, Sha1};
use std::{
    io,
    net::{Ipv4Addr, UdpSocket},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

type Secret = Zeroizing<Vec<u8>>;
fn err() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "IPsec authentication or protocol validation failed",
    )
}
fn random<const N: usize>() -> io::Result<[u8; N]> {
    let mut b = [0; N];
    getrandom::fill(&mut b).map_err(io::Error::other)?;
    Ok(b)
}
fn hash(parts: &[&[u8]]) -> Vec<u8> {
    let mut h = Sha1::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().to_vec()
}
fn prf(key: &[u8], parts: &[&[u8]]) -> Secret {
    let mut k = Zeroizing::new([0u8; 64]);
    if key.len() > 64 {
        k[..20].copy_from_slice(&hash(&[key]));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha1::new();
    for b in k.iter_mut() {
        *b ^= 0x36;
    }
    inner.update(&*k);
    for p in parts {
        inner.update(p);
    }
    let digest = Zeroizing::new(inner.finalize().to_vec());
    for b in k.iter_mut() {
        *b ^= 0x36 ^ 0x5c;
    }
    Zeroizing::new(hash(&[&*k, &digest]))
}
fn equal(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && bool::from(a.ct_eq(b))
}
fn crypt(key: &[u8], iv: &[u8], bytes: &[u8], encrypt: bool) -> io::Result<Secret> {
    if key.len() != 16 || iv.len() != 16 || bytes.is_empty() || bytes.len() % 16 != 0 {
        return Err(err());
    }
    let value = if encrypt {
        cbc::Encryptor::<aes::Aes128>::new_from_slices(key, iv)
            .map_err(|_| err())?
            .encrypt_padded_vec::<NoPadding>(bytes)
    } else {
        cbc::Decryptor::<aes::Aes128>::new_from_slices(key, iv)
            .map_err(|_| err())?
            .decrypt_padded_vec::<NoPadding>(bytes)
            .map_err(|_| err())?
    };
    Ok(Zeroizing::new(value))
}
const_monty_params!(
    Modp14,
    U2048,
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF"
);
type Modp = ConstMontyForm<Modp14, { U2048::LIMBS }>;

fn payloads(items: &[(u8, Vec<u8>)]) -> io::Result<Vec<u8>> {
    let mut out = Vec::new();
    for (i, (_, body)) in items.iter().enumerate() {
        if body.len() > 4096 {
            return Err(err());
        }
        out.push(items.get(i + 1).map_or(0, |p| p.0));
        out.push(0);
        out.extend_from_slice(&((body.len() + 4) as u16).to_be_bytes());
        out.extend_from_slice(body);
    }
    Ok(out)
}
fn parse(mut kind: u8, mut bytes: &[u8], padded: bool) -> io::Result<Vec<(u8, Vec<u8>)>> {
    let mut result = Vec::new();
    while kind != 0 {
        if result.len() >= 32 || bytes.len() < 4 || bytes[1] != 0 {
            return Err(err());
        }
        let len = u16::from_be_bytes([bytes[2], bytes[3]]) as usize;
        if len < 4 || len > bytes.len() {
            return Err(err());
        }
        result.push((kind, bytes[4..len].to_vec()));
        kind = bytes[0];
        bytes = &bytes[len..];
    }
    if (!padded && !bytes.is_empty()) || (padded && bytes.len() > 15) {
        return Err(err());
    }
    Ok(result)
}
fn one(items: &[(u8, Vec<u8>)], kind: u8) -> io::Result<&[u8]> {
    let mut found = items.iter().filter(|p| p.0 == kind);
    let body = &found.next().ok_or_else(err)?.1;
    if found.next().is_some() {
        return Err(err());
    }
    Ok(body)
}
fn attrs(values: &[(u16, u16)]) -> Vec<u8> {
    let mut out = Vec::new();
    for (k, v) in values {
        out.extend_from_slice(&(k | 0x8000).to_be_bytes());
        out.extend_from_slice(&v.to_be_bytes());
    }
    out
}
fn sa(phase1: bool, spi: &[u8]) -> io::Result<Vec<u8>> {
    let attributes = if phase1 {
        attrs(&[
            (1, 7),
            (2, 2),
            (3, 1),
            (4, 14),
            (14, 128),
            (11, 1),
            (12, 3600),
        ])
    } else {
        attrs(&[(4, 4), (5, 2), (6, 128), (1, 1), (2, 1800)])
    };
    let mut transform = vec![1, if phase1 { 1 } else { 12 }, 0, 0];
    transform.extend(attributes);
    let t = payloads(&[(0, transform)])?;
    let mut proposal = vec![1, if phase1 { 1 } else { 3 }, spi.len() as u8, 1];
    proposal.extend(spi);
    proposal.extend(t);
    let mut body = vec![0, 0, 0, 1, 0, 0, 0, 1];
    body.extend(payloads(&[(0, proposal)])?);
    Ok(body)
}
fn selected_sa(body: &[u8], phase1: bool) -> io::Result<Vec<u8>> {
    if body.len() < 8 || body[..8] != [0, 0, 0, 1, 0, 0, 0, 1] {
        return Err(err());
    }
    let proposals = parse(2, &body[8..], false)?;
    if proposals.len() != 1 {
        return Err(err());
    }
    let p = &proposals[0].1;
    let spi_len = if phase1 { 0 } else { 4 };
    if p.len() < 4 + spi_len
        || p[0] != 1
        || p[1] != if phase1 { 1 } else { 3 }
        || p[2] as usize != spi_len
        || p[3] != 1
    {
        return Err(err());
    }
    let transforms = parse(3, &p[4 + spi_len..], false)?;
    if transforms.len() != 1 {
        return Err(err());
    }
    let t = &transforms[0].1;
    if t.len() < 4 || t[0] != 1 || t[1] != if phase1 { 1 } else { 12 } || t[2..4] != [0, 0] {
        return Err(err());
    }
    let mut found = std::collections::HashMap::new();
    let mut a = &t[4..];
    while !a.is_empty() {
        if a.len() < 4 {
            return Err(err());
        }
        let raw = u16::from_be_bytes([a[0], a[1]]);
        let v = u16::from_be_bytes([a[2], a[3]]);
        let k = raw & 0x7fff;
        let (value, n) = if raw & 0x8000 != 0 {
            (u32::from(v), 4)
        } else {
            let n = v as usize;
            if n == 0 || n > 4 || a.len() < 4 + n {
                return Err(err());
            }
            let mut value = 0u32;
            for b in &a[4..4 + n] {
                value = (value << 8) | u32::from(*b);
            }
            (value, 4 + n)
        };
        if found.insert(k, value).is_some()
            || !(if phase1 {
                [1, 2, 3, 4, 11, 12, 14].contains(&k)
            } else {
                [1, 2, 4, 5, 6].contains(&k)
            })
        {
            return Err(err());
        }
        a = &a[n..];
    }
    let required = if phase1 {
        vec![(1, 7), (2, 2), (3, 1), (4, 14), (14, 128)]
    } else {
        vec![(4, 4), (5, 2), (6, 128)]
    };
    for (k, v) in required {
        if found.get(&k) != Some(&v) {
            return Err(err());
        }
    }
    // This backend closes before its advertised lifetimes; shorter selections are rejected.
    let (life, duration, min) = if phase1 { (11, 12, 1800) } else { (1, 2, 1800) };
    if found.get(&life).is_some_and(|v| *v != 1) || found.get(&duration).is_some_and(|v| *v < min) {
        return Err(err());
    }
    Ok(p[4..4 + spi_len].to_vec())
}

struct Ike {
    socket: UdpSocket,
    cookies: [u8; 16],
    cancel: Arc<AtomicBool>,
    natt: bool,
}
impl Ike {
    fn message(
        &self,
        exchange: u8,
        id: u32,
        items: &[(u8, Vec<u8>)],
        key_iv: Option<(&[u8], &[u8])>,
    ) -> io::Result<Vec<u8>> {
        let mut body = payloads(items)?;
        if let Some((key, iv)) = key_iv {
            body.resize(body.len().div_ceil(16) * 16, 0);
            body = crypt(key, iv, &body, true)?.to_vec();
        }
        let mut out = self.cookies.to_vec();
        out.extend_from_slice(&[
            items.first().map_or(0, |p| p.0),
            0x10,
            exchange,
            u8::from(key_iv.is_some()),
        ]);
        out.extend(id.to_be_bytes());
        out.extend(((28 + body.len()) as u32).to_be_bytes());
        out.extend(body);
        Ok(out)
    }
    fn send(&self, bytes: &[u8]) -> io::Result<()> {
        if self.natt {
            let mut b = vec![0; 4];
            b.extend(bytes);
            self.socket.send(&b)?;
        } else {
            self.socket.send(bytes)?;
        }
        Ok(())
    }
    fn exchange(
        &mut self,
        request: &[u8],
        exchange: u8,
        id: u32,
        encrypted: bool,
    ) -> io::Result<Vec<u8>> {
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut retry = Instant::now();
        let mut delay = 1;
        while Instant::now() < deadline {
            if self.cancel.load(Ordering::Acquire) {
                return Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "IPsec connection cancelled",
                ));
            }
            if Instant::now() >= retry {
                self.send(request)?;
                retry = Instant::now() + Duration::from_secs(delay);
                delay = (delay * 2).min(4);
            }
            let mut b = [0; 8193];
            let n = match self.socket.recv(&mut b) {
                Ok(n) => n,
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
                    ) =>
                {
                    continue;
                }
                Err(e) => return Err(e),
            };
            let mut b = &b[..n];
            if self.natt {
                if !b.starts_with(&[0; 4]) {
                    continue;
                }
                b = &b[4..];
            }
            if b.len() < 28
                || b.len() > 8192
                || b[..8] != self.cookies[..8]
                || b[16] != request[16]
                || b[17] != 0x10
                || b[18] != exchange
                || b[19] != u8::from(encrypted)
                || b[20..24] != id.to_be_bytes()
                || u32::from_be_bytes(b[24..28].try_into().unwrap()) as usize != b.len()
            {
                continue;
            }
            if self.cookies[8..] != [0; 8] && b[8..16] != self.cookies[8..] {
                continue;
            }
            if b[8..16] == [0; 8] {
                continue;
            }
            self.cookies[8..].copy_from_slice(&b[8..16]);
            return Ok(b.to_vec());
        }
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "IKEv1 exchange timed out",
        ))
    }
}

/// AES-128-CBC / HMAC-SHA1-96 ESP SA, with authenticated replay-window updates.
pub struct Esp {
    inbound_spi: [u8; 4],
    outbound_spi: [u8; 4],
    rx_key: Secret,
    tx_key: Secret,
    rx_auth: Secret,
    tx_auth: Secret,
    tx: u32,
    highest: u32,
    window: u64,
    created: Instant,
}
impl Esp {
    fn alive(&self) -> io::Result<()> {
        if self.created.elapsed() > Duration::from_secs(1500) {
            return Err(io::Error::other(
                "IPsec SA lifetime reached; reconnect the tunnel",
            ));
        }
        Ok(())
    }
    pub fn seal(&mut self, udp: &[u8]) -> io::Result<Vec<u8>> {
        self.alive()?;
        if udp.len() > 4096 {
            return Err(err());
        }
        self.tx = self.tx.checked_add(1).ok_or_else(err)?;
        let iv = random::<16>()?;
        let mut plain = Zeroizing::new(udp.to_vec());
        let padding = (16 - (plain.len() + 2) % 16) % 16;
        for i in 1..=padding {
            plain.push(i as u8);
        }
        plain.extend_from_slice(&[padding as u8, 17]);
        let mut out = self.outbound_spi.to_vec();
        out.extend(self.tx.to_be_bytes());
        out.extend(iv);
        out.extend_from_slice(&crypt(&self.tx_key, &iv, &plain, true)?);
        let tag = prf(&self.tx_auth, &[&out]);
        out.extend_from_slice(&tag[..12]);
        Ok(out)
    }
    pub fn open(&mut self, packet: &[u8]) -> io::Result<Vec<u8>> {
        self.alive()?;
        if packet.len() < 52
            || packet.len() > 4160
            || packet[..4] != self.inbound_spi
            || (packet.len() - 36) % 16 != 0
        {
            return Err(err());
        }
        let seq = u32::from_be_bytes(packet[4..8].try_into().unwrap());
        if seq == 0
            || (seq <= self.highest
                && (self.highest - seq >= 64 || self.window & (1u64 << (self.highest - seq)) != 0))
        {
            return Err(err());
        }
        let len = packet.len() - 12;
        let tag = prf(&self.rx_auth, &[&packet[..len]]);
        if !equal(&tag[..12], &packet[len..]) {
            return Err(err());
        }
        let plain = crypt(&self.rx_key, &packet[8..24], &packet[24..len], false)?;
        let padding = usize::from(plain[plain.len() - 2]);
        if plain[plain.len() - 1] != 17 || padding + 2 > plain.len() {
            return Err(err());
        }
        let end = plain.len() - padding - 2;
        if plain[end..end + padding]
            .iter()
            .enumerate()
            .any(|(i, b)| usize::from(*b) != i + 1)
        {
            return Err(err());
        }
        if seq > self.highest {
            let shift = seq - self.highest;
            self.window = if shift >= 64 {
                1
            } else {
                (self.window << shift) | 1
            };
            self.highest = seq;
        } else {
            self.window |= 1u64 << (self.highest - seq);
        }
        Ok(plain[..end].to_vec())
    }
}

/// Connected encrypted UDP facade consumed by L2TP. This implementation
/// requires RFC 3947 NAT-T and intentionally offers no raw-ESP fallback.
pub struct Transport {
    ike: Ike,
    esp: Esp,
    last_keepalive: Instant,
    key: Secret,
    auth: Secret,
    phase1_iv: Vec<u8>,
    quick_reply: Vec<u8>,
    quick_ack: Vec<u8>,
    last_ack: Instant,
}
impl Transport {
    pub fn connect(server: Ipv4Addr, psk: &str, cancel: Arc<AtomicBool>) -> io::Result<Self> {
        Self::connect_ports(server, 500, 4500, psk, cancel)
    }
    fn connect_ports(
        server: Ipv4Addr,
        ike_port: u16,
        natt_port: u16,
        psk: &str,
        cancel: Arc<AtomicBool>,
    ) -> io::Result<Self> {
        if psk.is_empty() || psk.len() > 1024 {
            return Err(err());
        }
        let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))?;
        socket.connect((server, ike_port))?;
        socket.set_read_timeout(Some(Duration::from_millis(10)))?;
        socket.set_write_timeout(Some(Duration::from_secs(2)))?;
        let local = match socket.local_addr()?.ip() {
            std::net::IpAddr::V4(ip) => ip,
            _ => return Err(err()),
        };
        let mut cookies = [0; 16];
        cookies[..8].copy_from_slice(&random::<8>()?);
        let mut ike = Ike {
            socket,
            cookies,
            cancel,
            natt: false,
        };
        let offer = sa(true, &[])?;
        let vid = vec![
            0x4a, 0x13, 0x1c, 0x81, 0x07, 0x03, 0x58, 0x45, 0x5c, 0x57, 0x28, 0xf2, 0x0e, 0x95,
            0x45, 0x2f,
        ];
        let request = ike.message(2, 0, &[(1, offer.clone()), (13, vid.clone())], None)?;
        let reply = ike.exchange(&request, 2, 0, false)?;
        let items = parse(reply[16], &reply[28..], false)?;
        selected_sa(one(&items, 1)?, true)?;
        if !items.iter().any(|p| p.0 == 13 && p.1 == vid) {
            return Err(io::Error::other(
                "IPsec server does not support RFC 3947 NAT traversal",
            ));
        }
        let exponent = Zeroizing::new(U256::from_be_bytes(random::<32>()?.into()));
        let gx = Modp::new(&U2048::from(2u8))
            .pow(&exponent)
            .retrieve()
            .to_be_bytes();
        let ni = Zeroizing::new(random::<32>()?);
        // Force UDP encapsulation by advertising a nonmatching local mapping.
        let nat_local = hash(&[&ike.cookies, &local.octets(), &0u16.to_be_bytes()]);
        let nat_remote = hash(&[&ike.cookies, &server.octets(), &ike_port.to_be_bytes()]);
        let request = ike.message(
            2,
            0,
            &[
                (4, gx.to_vec()),
                (10, ni.to_vec()),
                (20, nat_remote),
                (20, nat_local),
            ],
            None,
        )?;
        let reply = ike.exchange(&request, 2, 0, false)?;
        let items = parse(reply[16], &reply[28..], false)?;
        let gy = one(&items, 4)?;
        let nr = one(&items, 10)?;
        if gy.len() != 256
            || !(16..=256).contains(&nr.len())
            || items
                .iter()
                .filter(|p| p.0 == 20 && p.1.len() == 20)
                .count()
                < 2
        {
            return Err(err());
        }
        let y = U2048::from_be_slice(gy);
        use crypto_bigint::modular::ConstMontyParams;
        let prime = Modp14::PARAMS.modulus().as_ref();
        if y <= U2048::ONE
            || y >= prime.wrapping_sub(&U2048::ONE)
            || Modp::new(&y)
                .pow(&prime.wrapping_sub(&U2048::ONE).shr_vartime(1))
                .retrieve()
                != U2048::ONE
        {
            return Err(err());
        }
        let shared = Zeroizing::new(
            Modp::new(&y)
                .pow(&exponent)
                .retrieve()
                .to_be_bytes()
                .to_vec(),
        );
        let skeyid = prf(psk.as_bytes(), &[&*ni, nr]);
        let d = prf(&skeyid, &[&*shared, &ike.cookies, &[0]]);
        let a = prf(&skeyid, &[&d, &*shared, &ike.cookies, &[1]]);
        let e = prf(&skeyid, &[&a, &*shared, &ike.cookies, &[2]]);
        let key = Zeroizing::new(e[..16].to_vec());
        let initial_iv = hash(&[&gx, gy]);
        let mut identity = vec![1, 0, 0, 0];
        identity.extend(local.octets());
        let hash_i = prf(&skeyid, &[&gx, gy, &ike.cookies, &offer, &identity]);
        ike.socket.connect((server, natt_port))?;
        ike.natt = true;
        let request = ike.message(
            2,
            0,
            &[(5, identity), (8, hash_i.to_vec())],
            Some((&key, &initial_iv[..16])),
        )?;
        let reply = ike.exchange(&request, 2, 0, true)?;
        let plain = crypt(&key, &request[request.len() - 16..], &reply[28..], false)?;
        let items = parse(reply[16], &plain, true)?;
        let peer_id = one(&items, 5)?;
        if peer_id.len() < 5 {
            return Err(err());
        }
        let hash_r = prf(
            &skeyid,
            &[
                gy,
                &gx,
                &ike.cookies[8..],
                &ike.cookies[..8],
                &offer,
                peer_id,
            ],
        );
        if !equal(&hash_r, one(&items, 8)?) {
            return Err(err());
        }
        let phase1_iv = &reply[reply.len() - 16..];
        let id = u32::from_be_bytes(random::<4>()?).max(1);
        let qiv = hash(&[phase1_iv, &id.to_be_bytes()]);
        let spi = random::<4>()?;
        if u32::from_be_bytes(spi) < 256 {
            return Err(err());
        }
        let qnonce = Zeroizing::new(random::<32>()?);
        let mut idci = vec![1, 17, 6, 165];
        idci.extend(local.octets());
        let mut idcr = vec![1, 17, 6, 165];
        idcr.extend(server.octets());
        let tail = vec![
            (1, sa(false, &spi)?),
            (10, qnonce.to_vec()),
            (5, idci.clone()),
            (5, idcr.clone()),
        ];
        let tail_wire = payloads(&tail)?;
        let h1 = prf(&a, &[&id.to_be_bytes(), &tail_wire]);
        let mut all = vec![(8, h1.to_vec())];
        all.extend(tail);
        let request = ike.message(32, id, &all, Some((&key, &qiv[..16])))?;
        let reply = ike.exchange(&request, 32, id, true)?;
        let plain = crypt(&key, &request[request.len() - 16..], &reply[28..], false)?;
        let items = parse(reply[16], &plain, true)?;
        if items.first().is_none_or(|p| p.0 != 8) {
            return Err(err());
        }
        let tail_wire = payloads(&items[1..])?;
        let h2 = prf(&a, &[&id.to_be_bytes(), &*qnonce, &tail_wire]);
        if !equal(&h2, one(&items, 8)?) {
            return Err(err());
        }
        let peer_spi = selected_sa(one(&items, 1)?, false)?;
        if peer_spi.len() != 4
            || u32::from_be_bytes(peer_spi.as_slice().try_into().map_err(|_| err())?) < 256
        {
            return Err(err());
        }
        let peer_nonce = one(&items, 10)?;
        if !(16..=256).contains(&peer_nonce.len()) {
            return Err(err());
        }
        let ids: Vec<_> = items.iter().filter(|p| p.0 == 5).collect();
        if ids.len() != 2 || ids[0].1 != idci || ids[1].1 != idcr {
            return Err(err());
        }
        let h3 = prf(&a, &[&[0], &id.to_be_bytes(), &*qnonce, peer_nonce]);
        let last = ike.message(
            32,
            id,
            &[(8, h3.to_vec())],
            Some((&key, &reply[reply.len() - 16..])),
        )?;
        ike.send(&last)?;
        let material = |spi: &[u8]| {
            let first = prf(&d, &[&[3], spi, &*qnonce, peer_nonce]);
            let second = prf(&d, &[&first, &[3], spi, &*qnonce, peer_nonce]);
            let mut k = Zeroizing::new(first.to_vec());
            k.extend_from_slice(&second);
            k
        };
        let inbound = material(&spi);
        let outbound = material(&peer_spi);
        let esp = Esp {
            inbound_spi: spi,
            outbound_spi: peer_spi.try_into().map_err(|_| err())?,
            rx_key: Zeroizing::new(inbound[..16].to_vec()),
            tx_key: Zeroizing::new(outbound[..16].to_vec()),
            rx_auth: Zeroizing::new(inbound[16..36].to_vec()),
            tx_auth: Zeroizing::new(outbound[16..36].to_vec()),
            tx: 0,
            highest: 0,
            window: 0,
            created: Instant::now(),
        };
        Ok(Self {
            ike,
            esp,
            last_keepalive: Instant::now(),
            key,
            auth: a,
            phase1_iv: phase1_iv.to_vec(),
            quick_reply: reply,
            quick_ack: last,
            last_ack: Instant::now(),
        })
    }
    pub fn send(&mut self, body: &[u8]) -> io::Result<usize> {
        let len = u16::try_from(body.len() + 8).map_err(|_| err())?;
        let mut udp = vec![6, 165, 6, 165];
        udp.extend(len.to_be_bytes());
        udp.extend([0, 0]);
        udp.extend(body);
        let packet = self.esp.seal(&udp)?;
        self.ike.socket.send(&packet)?;
        Ok(body.len())
    }
    pub fn recv(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if self.ike.cancel.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "IPsec connection cancelled",
            ));
        }
        self.esp.alive()?;
        if self.last_keepalive.elapsed() > Duration::from_secs(15) {
            self.ike.socket.send(&[255])?;
            self.last_keepalive = Instant::now();
        }
        let mut wire = [0; 8193];
        let n = self.ike.socket.recv(&mut wire)?;
        // IKE informational/late retransmits and NAT keepalives never enter L2TP.
        if n == 1 {
            return Err(io::ErrorKind::WouldBlock.into());
        }
        if wire[..n].starts_with(&[0; 4]) {
            if wire[4..n] == self.quick_reply
                && self.last_ack.elapsed() > Duration::from_millis(100)
            {
                self.ike.send(&self.quick_ack)?;
                self.last_ack = Instant::now();
            }
            return Err(io::ErrorKind::WouldBlock.into());
        }
        let udp = match self.esp.open(&wire[..n]) {
            Ok(p) => p,
            Err(_) => return Err(io::ErrorKind::WouldBlock.into()),
        };
        if udp.len() < 8
            || udp[..4] != [6, 165, 6, 165]
            || u16::from_be_bytes([udp[4], udp[5]]) as usize != udp.len()
            || udp.len() - 8 > out.len()
        {
            return Err(io::ErrorKind::WouldBlock.into());
        }
        out[..udp.len() - 8].copy_from_slice(&udp[8..]);
        Ok(udp.len() - 8)
    }
}

impl Drop for Transport {
    fn drop(&mut self) {
        let _ = (|| -> io::Result<()> {
            let id = u32::from_be_bytes(random::<4>()?).max(1);
            let mut esp_delete = vec![0, 0, 0, 1, 3, 4, 0, 2];
            esp_delete.extend(self.esp.inbound_spi);
            esp_delete.extend(self.esp.outbound_spi);
            let mut ike_delete = vec![0, 0, 0, 1, 1, 16, 0, 1];
            ike_delete.extend(self.ike.cookies);
            let tail = vec![(12, esp_delete), (12, ike_delete)];
            let h = prf(&self.auth, &[&id.to_be_bytes(), &payloads(&tail)?]);
            let mut all = vec![(8, h.to_vec())];
            all.extend(tail);
            let iv = hash(&[&self.phase1_iv, &id.to_be_bytes()]);
            self.ike.send(
                &self
                    .ike
                    .message(5, id, &all, Some((&self.key, &iv[..16])))?,
            )
        })();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn esp() -> Esp {
        Esp {
            inbound_spi: [1, 2, 3, 4],
            outbound_spi: [1, 2, 3, 4],
            rx_key: Zeroizing::new(vec![0x42; 16]),
            tx_key: Zeroizing::new(vec![0x42; 16]),
            rx_auth: Zeroizing::new(vec![0x23; 20]),
            tx_auth: Zeroizing::new(vec![0x23; 20]),
            tx: 0,
            highest: 0,
            window: 0,
            created: Instant::now(),
        }
    }
    #[test]
    fn rfc2202_hmac_and_nist_cbc_known_answers() {
        let value = prf(&[0x0b; 20], &[b"Hi There"]);
        assert_eq!(
            &*value,
            &[
                0xb6, 0x17, 0x31, 0x86, 0x55, 0x05, 0x72, 0x64, 0xe2, 0x8b, 0xc0, 0xb6, 0xfb, 0x37,
                0x8c, 0x8e, 0xf1, 0x46, 0xbe, 0x00
            ]
        );
        let key = [
            0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6, 0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf,
            0x4f, 0x3c,
        ];
        let plain = [
            0x6b, 0xc1, 0xbe, 0xe2, 0x2e, 0x40, 0x9f, 0x96, 0xe9, 0x3d, 0x7e, 0x11, 0x73, 0x93,
            0x17, 0x2a,
        ];
        assert_eq!(
            &*crypt(
                &key,
                &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                &plain,
                true
            )
            .unwrap(),
            &[
                0x76, 0x49, 0xab, 0xac, 0x81, 0x19, 0xb2, 0x46, 0xce, 0xe9, 0x8e, 0x9b, 0x12, 0xe9,
                0x19, 0x7d
            ]
        );
    }
    #[test]
    fn esp_authentication_replay_reordering_wrap_and_expiry() {
        let mut sender = esp();
        let mut receiver = esp();
        let first = sender.seal(b"first").unwrap();
        let second = sender.seal(b"second").unwrap();
        let mut forged = second.clone();
        forged[8] ^= 1;
        assert!(receiver.open(&forged).is_err());
        assert_eq!(receiver.highest, 0);
        assert_eq!(receiver.open(&second).unwrap(), b"second");
        assert_eq!(receiver.open(&first).unwrap(), b"first");
        assert!(receiver.open(&first).is_err());
        for n in 0..first.len() {
            assert!(esp().open(&first[..n]).is_err());
        }
        for index in 0..first.len() {
            let mut bad = first.clone();
            bad[index] ^= 1;
            assert!(esp().open(&bad).is_err());
        }
        sender.tx = u32::MAX;
        assert!(sender.seal(b"wrap").is_err());
        sender.created = Instant::now() - Duration::from_secs(1501);
        assert!(sender.seal(b"expired").is_err());
        let mut sender = esp();
        let mut receiver = esp();
        let old = sender.seal(b"old").unwrap();
        for _ in 0..65 {
            let p = sender.seal(b"new").unwrap();
            receiver.open(&p).unwrap();
        }
        assert!(receiver.open(&old).is_err());
    }
    #[test]
    fn proposal_selection_rejects_downgrades_and_malformed_payloads() {
        for phase1 in [true, false] {
            let s = sa(phase1, if phase1 { &[] } else { &[1, 2, 3, 4] }).unwrap();
            assert!(selected_sa(&s, phase1).is_ok());
            for n in 0..s.len() {
                assert!(selected_sa(&s[..n], phase1).is_err());
            }
            let mut bad = s;
            bad[if phase1 { 21 } else { 25 }] = 0;
            assert!(selected_sa(&bad, phase1).is_err());
        }
        assert!(parse(1, &[0, 0, 0, 3], false).is_err());
        assert!(parse(1, &[0, 0, 255, 255], false).is_err());
    }
    #[test]
    fn cancelled_handshake_does_not_send() {
        let server = UdpSocket::bind("127.0.0.1:0").unwrap();
        server.set_nonblocking(true).unwrap();
        let cancel = Arc::new(AtomicBool::new(true));
        assert_eq!(
            Transport::connect_ports(
                Ipv4Addr::LOCALHOST,
                server.local_addr().unwrap().port(),
                4500,
                "fixture",
                cancel
            )
            .err()
            .unwrap()
            .kind(),
            io::ErrorKind::Interrupted
        );
        assert_eq!(
            server.recv(&mut [0; 64]).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
    }
    #[test]
    fn loopback_main_quick_and_encrypted_udp() {
        run_loopback(false);
    }
    #[test]
    fn loopback_rejects_invalid_peer_authenticator() {
        run_loopback(true);
    }
    fn run_loopback(tamper: bool) {
        let initial = UdpSocket::bind("127.0.0.1:0").unwrap();
        let floated = UdpSocket::bind("127.0.0.1:0").unwrap();
        for s in [&initial, &floated] {
            s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        }
        let ports = (
            initial.local_addr().unwrap().port(),
            floated.local_addr().unwrap().port(),
        );
        let peer = std::thread::spawn(move || {
            let mut wire = [0; 8192];
            let (n, address) = initial.recv_from(&mut wire).unwrap();
            initial.connect(address).unwrap();
            floated.connect(address).unwrap();
            let mut cookies = [0; 16];
            cookies[..8].copy_from_slice(&wire[..8]);
            cookies[8..].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
            let first = parse(wire[16], &wire[28..n], false).unwrap();
            let offer = one(&first, 1).unwrap().to_vec();
            let mut ike = Ike {
                socket: initial,
                cookies,
                cancel: Arc::new(AtomicBool::new(false)),
                natt: false,
            };
            ike.send(
                &ike.message(
                    2,
                    0,
                    &[(1, offer.clone()), (13, one(&first, 13).unwrap().to_vec())],
                    None,
                )
                .unwrap(),
            )
            .unwrap();
            let n = ike.socket.recv(&mut wire).unwrap();
            let second = parse(wire[16], &wire[28..n], false).unwrap();
            let gx = one(&second, 4).unwrap();
            let ni = one(&second, 10).unwrap();
            let exponent = U256::from(37u8);
            let gy = Modp::new(&U2048::from(2u8))
                .pow(&exponent)
                .retrieve()
                .to_be_bytes();
            let nr = [0x66; 32];
            let shared = Zeroizing::new(
                Modp::new(&U2048::from_be_slice(gx))
                    .pow(&exponent)
                    .retrieve()
                    .to_be_bytes()
                    .to_vec(),
            );
            let skeyid = prf(b"fixture-psk", &[ni, &nr]);
            let d = prf(&skeyid, &[&shared, &cookies, &[0]]);
            let a = prf(&skeyid, &[&d, &shared, &cookies, &[1]]);
            let e = prf(&skeyid, &[&a, &shared, &cookies, &[2]]);
            let key = &e[..16];
            ike.send(
                &ike.message(
                    2,
                    0,
                    &[
                        (4, gy.to_vec()),
                        (10, nr.to_vec()),
                        (20, vec![0; 20]),
                        (20, vec![0; 20]),
                    ],
                    None,
                )
                .unwrap(),
            )
            .unwrap();
            ike.socket = floated;
            ike.natt = true;
            let n = ike.socket.recv(&mut wire).unwrap();
            let request = &wire[4..n];
            let iv = hash(&[gx, &gy]);
            let plain = crypt(key, &iv[..16], &request[28..], false).unwrap();
            let items = parse(request[16], &plain, true).unwrap();
            let expected = prf(
                &skeyid,
                &[gx, &gy, &cookies, &offer, one(&items, 5).unwrap()],
            );
            assert!(equal(&expected, one(&items, 8).unwrap()));
            let identity = vec![1, 0, 0, 0, 127, 0, 0, 1];
            let mut h = prf(
                &skeyid,
                &[&gy, gx, &cookies[8..], &cookies[..8], &offer, &identity],
            );
            if tamper {
                h[0] ^= 1;
            }
            let response = ike
                .message(
                    2,
                    0,
                    &[(5, identity), (8, h.to_vec())],
                    Some((key, &request[request.len() - 16..])),
                )
                .unwrap();
            ike.send(&response).unwrap();
            if tamper {
                return;
            }
            let n = ike.socket.recv(&mut wire).unwrap();
            let request = &wire[4..n];
            let id = u32::from_be_bytes(request[20..24].try_into().unwrap());
            let iv = hash(&[&response[response.len() - 16..], &id.to_be_bytes()]);
            let plain = crypt(key, &iv[..16], &request[28..], false).unwrap();
            let items = parse(request[16], &plain, true).unwrap();
            assert!(equal(
                &prf(&a, &[&id.to_be_bytes(), &payloads(&items[1..]).unwrap()]),
                one(&items, 8).unwrap()
            ));
            let client_spi = selected_sa(one(&items, 1).unwrap(), false).unwrap();
            let qni = one(&items, 10).unwrap();
            let qnr = [0x77; 32];
            let spi = [9, 8, 7, 6];
            let mut selected = one(&items, 1).unwrap().to_vec();
            selected[16..20].copy_from_slice(&spi);
            let tail = vec![
                (1, selected),
                (10, qnr.to_vec()),
                items[3].clone(),
                items[4].clone(),
            ];
            let h = prf(&a, &[&id.to_be_bytes(), qni, &payloads(&tail).unwrap()]);
            let mut all = vec![(8, h.to_vec())];
            all.extend(tail);
            let response = ike
                .message(32, id, &all, Some((key, &request[request.len() - 16..])))
                .unwrap();
            ike.send(&response).unwrap();
            let n = ike.socket.recv(&mut wire).unwrap();
            let request = &wire[4..n];
            let plain =
                crypt(key, &response[response.len() - 16..], &request[28..], false).unwrap();
            let last = parse(request[16], &plain, true).unwrap();
            assert!(equal(
                &prf(&a, &[&[0], &id.to_be_bytes(), qni, &qnr]),
                one(&last, 8).unwrap()
            ));
            let material = |spi: &[u8]| {
                let first = prf(&d, &[&[3], spi, qni, &qnr]);
                let second = prf(&d, &[&first, &[3], spi, qni, &qnr]);
                let mut k = first.to_vec();
                k.extend_from_slice(&second);
                k
            };
            let inbound = material(&spi);
            let outbound = material(&client_spi);
            let mut esp = Esp {
                inbound_spi: spi,
                outbound_spi: client_spi.try_into().unwrap(),
                rx_key: Zeroizing::new(inbound[..16].to_vec()),
                rx_auth: Zeroizing::new(inbound[16..36].to_vec()),
                tx_key: Zeroizing::new(outbound[..16].to_vec()),
                tx_auth: Zeroizing::new(outbound[16..36].to_vec()),
                tx: 0,
                highest: 0,
                window: 0,
                created: Instant::now(),
            };
            let n = ike.socket.recv(&mut wire).unwrap();
            let udp = esp.open(&wire[..n]).unwrap();
            assert_eq!(&udp[8..], b"private l2tp payload");
            ike.socket.send(&esp.seal(&udp).unwrap()).unwrap();
        });
        let result = Transport::connect_ports(
            Ipv4Addr::LOCALHOST,
            ports.0,
            ports.1,
            "fixture-psk",
            Arc::new(AtomicBool::new(false)),
        );
        if tamper {
            assert!(result.is_err());
            peer.join().unwrap();
            return;
        }
        let mut transport = result.unwrap();
        transport.send(b"private l2tp payload").unwrap();
        let mut buf = [0; 256];
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match transport.recv(&mut buf) {
                Ok(n) => {
                    assert_eq!(&buf[..n], b"private l2tp payload");
                    break;
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                    ) =>
                {
                    assert!(Instant::now() < deadline)
                }
                Err(e) => panic!("{e}"),
            }
        }
        peer.join().unwrap();
    }
}
