use crate::{auth, control::Control, gre::Gre};
use std::{
    error::Error,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;
const LCP: u16 = 0xc021;
const CHAP: u16 = 0xc223;
pub(crate) fn packet(code: u8, id: u8, body: &[u8]) -> Vec<u8> {
    let mut p = vec![code, id];
    p.extend_from_slice(&((4 + body.len()) as u16).to_be_bytes());
    p.extend_from_slice(body);
    p
}
pub(crate) fn decode_ppp(mut bytes: &[u8]) -> Option<(u16, &[u8])> {
    if bytes.starts_with(&[0xff, 3]) {
        bytes = &bytes[2..];
    }
    let first = *bytes.first()?;
    if first & 1 != 0 {
        Some((u16::from(first), &bytes[1..]))
    } else {
        Some((
            u16::from_be_bytes(bytes.get(..2)?.try_into().ok()?),
            &bytes[2..],
        ))
    }
}
pub(crate) fn decode_packet(bytes: &[u8]) -> Option<(u8, u8, &[u8])> {
    if bytes.len() < 4 {
        return None;
    }
    let len = u16::from_be_bytes(bytes[2..4].try_into().ok()?) as usize;
    if len < 4 || len > bytes.len() {
        return None;
    }
    Some((bytes[0], bytes[1], &bytes[4..len]))
}
pub(crate) fn options(bytes: &[u8]) -> Option<Vec<&[u8]>> {
    let mut result = Vec::new();
    let mut pos = 0;
    while pos < bytes.len() {
        let len = usize::from(*bytes.get(pos + 1)?);
        if len < 2 {
            return None;
        }
        let option = bytes.get(pos..pos + len)?;
        result.push(option);
        pos += len;
    }
    Some(result)
}
// Reject unimplemented extensions; insist on MS-CHAPv2 without sending a password.
fn peer_config(body: &[u8]) -> Option<(u8, Vec<u8>)> {
    let mut rejected = Vec::new();
    let mut has_auth = false;
    let mut wrong_auth = false;
    for opt in options(body)? {
        let valid = match opt[0] {
            1 => opt.len() == 4 && u16::from_be_bytes([opt[2], opt[3]]) >= 128,
            2 | 5 => opt.len() == 6,
            3 => {
                has_auth = true;
                wrong_auth = opt != [3, 5, 0xc2, 0x23, 0x81];
                true
            }
            7 | 8 => opt.len() == 2,
            _ => false,
        };
        if !valid {
            rejected.extend_from_slice(opt);
        }
    }
    if !rejected.is_empty() {
        Some((4, rejected))
    } else if !has_auth || wrong_auth {
        Some((3, vec![3, 5, 0xc2, 0x23, 0x81]))
    } else {
        Some((2, body.to_vec()))
    }
}

pub struct Authenticated {
    pub keys: crate::mppe::Keys,
    pub magic: [u8; 4],
    pub peer_mru: usize,
}

pub fn authenticate(
    control: &mut Control,
    gre: &mut Gre,
    peer: u16,
    user: &str,
    password: &str,
) -> Result<Authenticated, Box<dyn Error>> {
    let mut magic = [0u8; 4];
    getrandom::fill(&mut magic)?;
    // 1360 IP + inner PPP protocol + MPPE header = 1364 information bytes.
    let mut request = vec![1, 4, 5, 0x54, 5, 6];
    request.extend_from_slice(&magic);
    let mut id = 1u8;
    let mut local_ack = false;
    let mut remote_ack = false;
    let mut peer_mru = 1500usize;
    let mut config_rounds = 0u8;
    let mut authenticated_challenge: Option<(u8, Zeroizing<String>, crate::mppe::Keys)> = None;
    let mut response_cache: Option<(u8, Vec<u8>, Zeroizing<Vec<u8>>)> = None;
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut retry = Instant::now();
    let mut reported_lcp = false;
    let mut received_packets = 0u32;
    while Instant::now() < deadline {
        if !local_ack && Instant::now() >= retry {
            gre.send(peer, LCP, &packet(1, id, &request))?;
            retry = Instant::now() + Duration::from_secs(3);
        }
        if let Some((kind, body)) = control.poll()? {
            control.service(kind, &body)?;
        }
        let Some(bytes) = gre.receive(peer)? else {
            continue;
        };
        received_packets += 1;
        let Some((protocol, bytes)) = decode_ppp(&bytes) else {
            continue;
        };
        let Some((code, remote_id, body)) = decode_packet(bytes) else {
            continue;
        };
        match protocol {
            LCP => match code {
                1 => {
                    if authenticated_challenge.is_some() {
                        return Err("LCP restarted during authentication".into());
                    }
                    config_rounds += 1;
                    if config_rounds > 24 {
                        return Err("LCP negotiation limit exceeded".into());
                    }
                    let (reply, options) = peer_config(body).ok_or("invalid LCP options")?;
                    gre.send(peer, LCP, &packet(reply, remote_id, &options))?;
                    remote_ack = reply == 2;
                    if remote_ack {
                        peer_mru = self::options(body)
                            .unwrap()
                            .into_iter()
                            .find(|o| o[0] == 1)
                            .map_or(1500, |o| u16::from_be_bytes([o[2], o[3]]) as usize);
                    }
                    println!("LCP: peer Configure-Request; response code {reply}.");
                }
                2 if remote_id == id && body == request => {
                    local_ack = true;
                }
                3 | 4 if remote_id == id => {
                    config_rounds += 1;
                    if config_rounds > 24 {
                        return Err("LCP negotiation limit exceeded".into());
                    }
                    // Only our MRU and magic options may be adjusted/rejected.
                    let options = options(body).ok_or("invalid LCP response options")?;
                    if code == 4 {
                        let current = super::ppp::options(&request).unwrap();
                        let mut next = Vec::new();
                        for opt in current {
                            if !options.contains(&opt) {
                                next.extend_from_slice(opt);
                            }
                        }
                        request = next;
                    } else {
                        for opt in options {
                            if opt[0] == 1
                                && opt.len() == 4
                                && u16::from_be_bytes([opt[2], opt[3]]) >= 128
                            {
                                request = vec![1, 4, opt[2], opt[3], 5, 6];
                                request.extend_from_slice(&magic);
                            } else if opt[0] != 5 {
                                return Err("unsupported LCP Configure-Nak".into());
                            }
                        }
                    }
                    id = id.wrapping_add(1);
                    local_ack = false;
                    retry = Instant::now();
                }
                5 => {
                    gre.send(peer, LCP, &packet(6, remote_id, body))?;
                    return Err("server terminated PPP link".into());
                }
                9 => {
                    let mut reply = magic.to_vec();
                    if body.len() > 4 {
                        reply.extend_from_slice(&body[4..]);
                    }
                    gre.send(peer, LCP, &packet(10, remote_id, &reply))?;
                }
                _ => {}
            },
            CHAP if local_ack && remote_ack => match code {
                1 => {
                    if body.len() < 17 || body[0] != 16 {
                        return Err("invalid MS-CHAPv2 challenge".into());
                    }
                    if let Some((cached_id, challenge, cached)) = &response_cache {
                        if *cached_id == remote_id && challenge == body {
                            gre.send(peer, CHAP, cached)?;
                            continue;
                        }
                        return Err(
                            "server changed authentication challenge; not retrying credentials"
                                .into(),
                        );
                    }
                    let server: [u8; 16] = body[1..17].try_into().unwrap();
                    let mut peer_challenge = [0u8; 16];
                    getrandom::fill(&mut peer_challenge)?;
                    let response = auth::response(user, password, &peer_challenge, &server);
                    let mut value = Zeroizing::new(vec![49]);
                    value.extend_from_slice(&peer_challenge);
                    value.extend_from_slice(&[0; 8]);
                    value.extend_from_slice(&*response.nt);
                    value.push(0);
                    value.extend_from_slice(user.as_bytes());
                    let reply = Zeroizing::new(packet(2, remote_id, &value));
                    gre.send(peer, CHAP, &reply)?;
                    response_cache = Some((remote_id, body.to_vec(), reply));
                    authenticated_challenge = Some((remote_id, response.expected, response.keys));
                    println!(
                        "PASS: MS-CHAPv2 challenge received; credential response sent (not logged)."
                    );
                }
                3 => {
                    let (id, expected, _) = authenticated_challenge
                        .as_ref()
                        .ok_or("unsolicited CHAP success")?;
                    if *id != remote_id || !auth::verify_success(body, expected) {
                        return Err("MS-CHAPv2 server authenticator verification failed".into());
                    }
                    println!("PASS: server accepted credentials; server authenticator verified.");
                    let (_, _, keys) = authenticated_challenge.take().unwrap();
                    return Ok(Authenticated {
                        keys,
                        magic,
                        peer_mru,
                    });
                }
                4 => {
                    return Err(
                        "server rejected MS-CHAPv2 authentication (no automatic password retries)"
                            .into(),
                    );
                }
                _ => {}
            },
            _ => {}
        }
        if local_ack && remote_ack && !reported_lcp {
            println!("PASS: bidirectional GRE and PPP LCP established with MS-CHAPv2.");
            reported_lcp = true;
        }
    }
    Err(format!("PPP deadline exceeded: {received_packets} GRE PPP packets received; local LCP ack={local_ack}, peer LCP ack={remote_ack}").into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn insists_on_chapv2_and_valid_lengths() {
        assert_eq!(
            peer_config(&[3, 4, 0xc0, 0x23]).unwrap(),
            (3, vec![3, 5, 0xc2, 0x23, 0x81])
        );
        assert_eq!(peer_config(&[3, 5, 0xc2, 0x23, 0x81]).unwrap().0, 2);
        assert!(peer_config(&[1, 0]).is_none());
        assert!(peer_config(&[3, 5, 0xc2]).is_none());
        assert_eq!(peer_config(&[99, 2]).unwrap(), (4, vec![99, 2]));
    }
    #[test]
    fn parses_ppp_compression_and_bounded_packets() {
        assert_eq!(decode_ppp(&[0xff, 3, 0xc0, 0x21, 1]), Some((LCP, &[1][..])));
        assert_eq!(decode_ppp(&[0x21, 1]), Some((0x21, &[1][..])));
        assert!(decode_packet(&[1, 1, 0, 3]).is_none());
        assert!(decode_packet(&[1, 1, 0, 9]).is_none());
    }
}
