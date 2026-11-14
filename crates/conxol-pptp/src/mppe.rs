//! RFC 3078/3079, 128-bit stateless MPPE only. No plaintext downgrade.
use rc4::{KeyInit, Rc4, StreamCipher, consts::U16};
use sha1::{Digest, Sha1};
use zeroize::Zeroizing;

pub struct Keys {
    pub send: Zeroizing<[u8; 16]>,
    pub receive: Zeroizing<[u8; 16]>,
}
fn sha(parts: &[&[u8]]) -> Zeroizing<[u8; 20]> {
    let mut h = Sha1::new();
    for part in parts {
        h.update(part);
    }
    Zeroizing::new(h.finalize().into())
}
pub fn derive(hashhash: &[u8; 16], nt: &[u8; 24]) -> Keys {
    let digest = sha(&[hashhash, nt, b"This is the MPPE Master Key"]);
    let master = &digest[..16];
    let send = sha(&[
        master,
        &[0; 40],
        b"On the client side, this is the send key; on the server side, it is the receive key.",
        &[0xf2; 40],
    ]);
    let receive = sha(&[
        master,
        &[0; 40],
        b"On the client side, this is the receive key; on the server side, it is the send key.",
        &[0xf2; 40],
    ]);
    Keys {
        send: Zeroizing::new(send[..16].try_into().unwrap()),
        receive: Zeroizing::new(receive[..16].try_into().unwrap()),
    }
}
fn rc4(key: &[u8; 16], data: &mut [u8]) {
    Rc4::<U16>::new(key.into()).apply_keystream(data);
}
struct Direction {
    start: Zeroizing<[u8; 16]>,
    current: Zeroizing<[u8; 16]>,
    count: u16,
}
impl Direction {
    fn new(start: Zeroizing<[u8; 16]>) -> Self {
        let digest = sha(&[start.as_slice(), &[0; 40], start.as_slice(), &[0xf2; 40]]);
        Self {
            start,
            current: Zeroizing::new(digest[..16].try_into().unwrap()),
            count: 0xfff,
        }
    }
    fn advance(&mut self) {
        let digest = sha(&[
            self.start.as_slice(),
            &[0; 40],
            self.current.as_slice(),
            &[0xf2; 40],
        ]);
        let mut interim = Zeroizing::new(<[u8; 16]>::try_from(&digest[..16]).unwrap());
        self.current.copy_from_slice(interim.as_slice());
        rc4(&self.current, &mut *interim);
        self.current.copy_from_slice(interim.as_slice());
        self.count = (self.count + 1) & 0xfff;
    }
}
pub struct Codec {
    send: Direction,
    receive: Direction,
}
impl Codec {
    pub fn new(keys: Keys) -> Self {
        Self {
            send: Direction::new(keys.send),
            receive: Direction::new(keys.receive),
        }
    }
    pub fn encrypt_ipv4(&mut self, ip: &[u8]) -> Result<Vec<u8>, &'static str> {
        if ip.len() < 20 || ip.len() > crate::PPTP_MTU || ip[0] >> 4 != 4 {
            return Err("invalid outbound IPv4 size/version");
        }
        self.send.advance();
        let mut p = Vec::with_capacity(ip.len() + 4);
        p.extend_from_slice(&(0x9000 | self.send.count).to_be_bytes());
        // Uncompressed PPP protocol field is encrypted with the IP payload.
        p.extend_from_slice(&[0, 0x21]);
        p.extend_from_slice(ip);
        rc4(&self.send.current, &mut p[2..]);
        Ok(p)
    }
    pub fn decrypt_ipv4(&mut self, packet: &[u8]) -> Result<Option<Vec<u8>>, &'static str> {
        if packet.len() < 4 || packet.len() > crate::PPTP_MRU || packet[0] & 0xf0 != 0x90 {
            return Err("invalid stateless encrypted MPPE header");
        }
        let count = u16::from_be_bytes([packet[0] & 0xf, packet[1]]);
        let delta = count.wrapping_sub(self.receive.count) & 0xfff;
        if delta == 0 || delta > 2048 {
            return Ok(None);
        } // duplicate/late packets cannot advance keys
        for _ in 0..delta {
            self.receive.advance();
        }
        let mut plain = Zeroizing::new(packet[2..].to_vec());
        rc4(&self.receive.current, &mut plain);
        let protocol_len = if plain.starts_with(&[0, 0x21]) {
            2
        } else if plain[0] == 0x21 {
            1
        } else {
            return Err("decrypted MPPE protocol is not IPv4");
        };
        let ip = &plain[protocol_len..];
        if ip.len() < 20
            || ip[0] >> 4 != 4
            || u16::from_be_bytes([ip[2], ip[3]]) as usize != ip.len()
        {
            return Err("invalid decrypted IPv4 packet");
        }
        Ok(Some(ip.to_vec()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn keys() -> Keys {
        derive(
            &[
                0x41, 0xc0, 0x0c, 0x58, 0x4b, 0xd2, 0xd9, 0x1c, 0x40, 0x17, 0xa2, 0xa1, 0x2f, 0xa5,
                0x9f, 0x3f,
            ],
            &[
                0x82, 0x30, 0x9e, 0xcd, 0x8d, 0x70, 0x8b, 0x5e, 0xa0, 0x8f, 0xaa, 0x39, 0x81, 0xcd,
                0x83, 0x54, 0x42, 0x33, 0x11, 0x4a, 0x3d, 0x85, 0xd6, 0xdf,
            ],
        )
    }
    #[test]
    fn rfc3079_128bit_vector() {
        // RFC example uses server-send, i.e. client-receive direction.
        let d = Direction::new(keys().receive);
        assert_eq!(
            &*d.start,
            &[
                0x8b, 0x7c, 0xdc, 0x14, 0x9b, 0x99, 0x3a, 0x1b, 0xa1, 0x18, 0xcb, 0x15, 0x3f, 0x56,
                0xdc, 0xcb
            ]
        );
        assert_eq!(
            &*d.current,
            &[
                0x40, 0x5c, 0xb2, 0x24, 0x7a, 0x79, 0x56, 0xe6, 0xe2, 0x11, 0, 0x7a, 0xe2, 0x7b,
                0x22, 0xd4
            ]
        );
        let mut text = b"test message".to_vec();
        rc4(&d.current, &mut text);
        assert_eq!(
            text,
            [
                0x81, 0x84, 0x83, 0x17, 0xdf, 0x68, 0x84, 0x62, 0x72, 0xfb, 0x5a, 0xbe
            ]
        );
    }
    #[test]
    fn loss_duplicates_late_packets_and_counter_wrap() {
        let mut sender = Codec::new(keys());
        let k = keys();
        let mut receiver = Codec::new(Keys {
            send: k.receive,
            receive: k.send,
        });
        let mut ip = vec![0u8; 20];
        ip[0] = 0x45;
        ip[2..4].copy_from_slice(&20u16.to_be_bytes());
        let mut old = None;
        for i in 0..4100 {
            let encrypted = sender.encrypt_ipv4(&ip).unwrap();
            if i == 4 || i == 5 {
                old = Some(encrypted);
                continue;
            }
            assert_eq!(receiver.decrypt_ipv4(&encrypted).unwrap(), Some(ip.clone()));
            assert_eq!(receiver.decrypt_ipv4(&encrypted).unwrap(), None);
            if i == 6 {
                assert_eq!(receiver.decrypt_ipv4(old.as_ref().unwrap()).unwrap(), None);
            }
        }
    }
    #[test]
    fn refuses_plaintext_compression_and_short_packets() {
        let mut codec = Codec::new(keys());
        for header in [0x10, 0x80, 0xb0, 0xd0] {
            assert!(codec.decrypt_ipv4(&[header, 0, 0, 0]).is_err());
        }
        assert!(codec.decrypt_ipv4(&[0x90]).is_err());
    }

    #[test]
    fn full_mtu_packet_roundtrips_and_oversized_packets_are_rejected() {
        let k = keys();
        let mut receiver = Codec::new(Keys {
            send: k.receive,
            receive: k.send,
        });
        let mut sender = Codec::new(keys());
        let mut ip = vec![0x5a; crate::PPTP_MTU];
        ip[0] = 0x45;
        ip[2..4].copy_from_slice(&(crate::PPTP_MTU as u16).to_be_bytes());
        let encrypted = sender.encrypt_ipv4(&ip).unwrap();
        assert_eq!(encrypted.len(), crate::PPTP_MRU);
        assert_eq!(receiver.decrypt_ipv4(&encrypted).unwrap(), Some(ip.clone()));
        ip.push(0);
        assert!(sender.encrypt_ipv4(&ip).is_err());
        let mut oversized = encrypted;
        oversized.push(0);
        assert!(receiver.decrypt_ipv4(&oversized).is_err());
    }
}
