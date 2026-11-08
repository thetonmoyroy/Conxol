//! IPv4/ICMP wire handling. No pointer casts or unchecked packet indexing.
use super::*;

pub(crate) fn checksum(bytes: &[u8]) -> u16 {
    let mut sum = 0u32;
    for pair in bytes.chunks(2) {
        sum += u32::from(u16::from_be_bytes([pair[0], *pair.get(1).unwrap_or(&0)]));
    }
    while sum >> 16 != 0 {
        sum = (sum & 0xffff) + (sum >> 16);
    }
    !(sum as u16)
}

pub(crate) fn echo_sized(
    identifier: u16,
    sequence: u16,
    nonce: [u8; 8],
    payload_size: u16,
) -> Vec<u8> {
    let mut packet = vec![0; 8 + usize::from(payload_size)];
    packet[0] = 8;
    packet[4..6].copy_from_slice(&identifier.to_be_bytes());
    packet[6..8].copy_from_slice(&sequence.to_be_bytes());
    let nonce_bytes = usize::from(payload_size).min(nonce.len());
    packet[8..8 + nonce_bytes].copy_from_slice(&nonce[..nonce_bytes]);
    let sum = checksum(&packet);
    packet[2..4].copy_from_slice(&sum.to_be_bytes());
    packet
}

fn ipv4(packet: &[u8]) -> Option<(usize, Ipv4Addr, Ipv4Addr)> {
    let header = usize::from(*packet.first()? & 15) * 4;
    if packet[0] >> 4 != 4
        || header < 20
        || packet.len() < header
        || packet[9] != 1
        || u16::from_be_bytes([packet[6], packet[7]]) & 0x3fff != 0
    {
        return None;
    }
    Some((
        header,
        Ipv4Addr::new(packet[12], packet[13], packet[14], packet[15]),
        Ipv4Addr::new(packet[16], packet[17], packet[18], packet[19]),
    ))
}

pub(crate) fn reply(
    packet: &[u8],
    target: Ipv4Addr,
    request: &[u8],
) -> Option<(Ipv4Addr, ReplyKind)> {
    let (offset, source, _) = ipv4(packet)?;
    let icmp = packet.get(offset..)?;
    if icmp.len() < 8 || checksum(icmp) != 0 {
        return None;
    }
    match (icmp[0], icmp[1]) {
        (0, 0) if source == target && icmp.get(4..) == request.get(4..) => {
            Some((source, ReplyKind::Destination))
        }
        (11, 0) | (3, _) => {
            let quoted = icmp.get(8..)?;
            let (offset, _, destination) = ipv4(quoted)?;
            let original = quoted.get(offset..offset + 8)?;
            // Routers need only quote the original IP header and eight bytes.
            // Match the original destination, protocol, identifier and sequence.
            if destination != target
                || original[0] != 8
                || original[1] != 0
                || original[4..8] != request[4..8]
            {
                return None;
            }
            Some((
                source,
                if icmp[0] == 11 {
                    ReplyKind::TimeExceeded
                } else {
                    ReplyKind::Unreachable
                },
            ))
        }
        _ => None,
    }
}

/// XNU delivers the outer fragment field and ICMP errors' quoted total length
/// in host order. Restore wire order before checking the ICMP checksum.
pub(crate) fn darwin_reply(
    packet: &mut [u8],
    target: Ipv4Addr,
    request: &[u8],
) -> Option<(Ipv4Addr, ReplyKind)> {
    let header = usize::from(*packet.first()? & 15) * 4;
    if packet[0] >> 4 != 4 || header < 20 || packet.len() < header + 8 {
        return None;
    }
    let fragment = u16::from_ne_bytes([packet[6], packet[7]]);
    packet[6..8].copy_from_slice(&fragment.to_be_bytes());
    if matches!(packet[header], 3 | 11) {
        let offset = header + 8 + 2;
        let length = packet.get_mut(offset..offset + 2)?;
        let host_length = u16::from_ne_bytes([length[0], length[1]]);
        length.copy_from_slice(&host_length.to_be_bytes());
    }
    reply(packet, target, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn echo(identifier: u16, sequence: u16, nonce: [u8; 8]) -> Vec<u8> {
        echo_sized(identifier, sequence, nonce, 8)
    }
    fn ip(body: &[u8], source: Ipv4Addr, destination: Ipv4Addr) -> Vec<u8> {
        let mut packet = vec![0; 20];
        packet[0] = 0x45;
        packet[9] = 1;
        packet[2..4].copy_from_slice(&((20 + body.len()) as u16).to_be_bytes());
        packet[12..16].copy_from_slice(&source.octets());
        packet[16..20].copy_from_slice(&destination.octets());
        packet.extend_from_slice(body);
        packet
    }
    fn icmp_sum(packet: &mut [u8]) {
        packet[2..4].fill(0);
        let sum = checksum(packet);
        packet[2..4].copy_from_slice(&sum.to_be_bytes());
    }

    #[test]
    fn echo_reply_requires_destination_identity_sequence_and_payload() {
        let target = Ipv4Addr::LOCALHOST;
        let request = echo(123, 45, [7; 8]);
        assert_eq!(checksum(&request), 0);
        let mut response = request.clone();
        response[0] = 0;
        icmp_sum(&mut response);
        let packet = ip(&response, target, target);
        assert_eq!(
            reply(&packet, target, &request),
            Some((target, ReplyKind::Destination))
        );
        for index in [4, 6, 8] {
            let mut wrong = response.clone();
            wrong[index] ^= 1;
            icmp_sum(&mut wrong);
            assert!(reply(&ip(&wrong, target, target), target, &request).is_none());
        }
        assert!(
            reply(
                &ip(&response, Ipv4Addr::new(192, 0, 2, 1), target),
                target,
                &request
            )
            .is_none()
        );
        for length in 0..packet.len() {
            assert!(reply(&packet[..length], target, &request).is_none());
        }
    }

    #[test]
    fn time_exceeded_matches_quoted_probe_and_rejects_malformed_packets() {
        let target = Ipv4Addr::new(192, 0, 2, 2);
        let router = Ipv4Addr::new(192, 0, 2, 1);
        let request = echo(12, 34, [8; 8]);
        let mut error = vec![11, 0, 0, 0, 0, 0, 0, 0];
        error.extend_from_slice(&ip(&request[..8], Ipv4Addr::LOCALHOST, target));
        icmp_sum(&mut error);
        let packet = ip(&error, router, Ipv4Addr::LOCALHOST);
        assert_eq!(
            reply(&packet, target, &request),
            Some((router, ReplyKind::TimeExceeded))
        );
        assert!(reply(&packet, target, &echo(12, 35, [8; 8])).is_none());
        assert!(reply(&packet, router, &request).is_none());
        for length in 0..packet.len() {
            assert!(reply(&packet[..length], target, &request).is_none());
        }
        for index in [0, 9, 20, 22, 55] {
            let mut broken = packet.clone();
            broken[index] ^= 0xff;
            assert!(reply(&broken, target, &request).is_none());
        }
    }

    #[test]
    fn checksum_handles_odd_lengths() {
        assert_eq!(checksum(&[1, 2, 3]), !0x0402);
    }

    #[test]
    fn payload_boundaries_have_exact_size_and_valid_checksum() {
        for size in [0, 1, 7, 8, 32, 65500] {
            let mut request = echo_sized(1, 2, [9; 8], size);
            assert_eq!(request.len(), usize::from(size) + 8);
            assert_eq!(checksum(&request), 0);
            let original = request.clone();
            request[0] = 0;
            icmp_sum(&mut request);
            let target = Ipv4Addr::LOCALHOST;
            assert_eq!(
                reply(&ip(&request, target, target), target, &original),
                Some((target, ReplyKind::Destination))
            );
        }
    }

    #[test]
    fn darwin_error_normalization_preserves_checksum_validation() {
        let target = Ipv4Addr::LOCALHOST;
        let router = Ipv4Addr::new(192, 0, 2, 1);
        let request = echo(1, 2, [9; 8]);
        let mut error = vec![11, 0, 0, 0, 0, 0, 0, 0];
        error.extend_from_slice(&ip(&request[..8], target, target));
        icmp_sum(&mut error);
        let mut received = ip(&error, router, target);
        received[6..8].copy_from_slice(&0x4000u16.to_ne_bytes());
        received[30..32].copy_from_slice(&28u16.to_ne_bytes());
        assert_eq!(
            darwin_reply(&mut received.clone(), target, &request),
            Some((router, ReplyKind::TimeExceeded))
        );
        received[55] ^= 1;
        assert!(darwin_reply(&mut received, target, &request).is_none());
    }
}
