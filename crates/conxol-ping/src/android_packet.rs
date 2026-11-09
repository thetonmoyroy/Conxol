//! Linux/Android ping-socket messages, decoded without pointer casts.
use super::{Ipv4Addr, ReplyKind, packet};

pub(crate) fn echo_reply(data: &[u8], source: Ipv4Addr, target: Ipv4Addr, request: &[u8]) -> bool {
    source == target
        && data.len() >= 8
        && request.len() >= 8
        && data[0] == 0
        && data[1] == 0
        && packet::checksum(data) == 0
        && data.get(4..) == request.get(4..)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ExtendedError {
    Local(i32),
    Remote(Ipv4Addr, ReplyKind),
}

/// `control` is the data of an IP_RECVERR cmsg: a 16-byte Linux
/// sock_extended_err followed by SO_EE_OFFENDER's sockaddr_in.
pub(crate) fn extended_error(
    control: &[u8],
    quoted: &[u8],
    destination: Ipv4Addr,
    target: Ipv4Addr,
    request: &[u8],
) -> Option<ExtendedError> {
    if control.len() < 16 {
        return None;
    }
    let errno = u32::from_ne_bytes(control[..4].try_into().ok()?);
    match control[4] {
        1 if errno > 0 && errno <= i32::MAX as u32 => Some(ExtendedError::Local(errno as i32)),
        2 => {
            if destination != target
                || request.len() < 8
                || quoted.len() < 8
                || quoted[..8] != request[..8]
                || control.len() < 32
                || u16::from_ne_bytes(control[16..18].try_into().ok()?) != 2
            {
                return None;
            }
            let kind = match (control[5], control[6]) {
                (11, 0) => ReplyKind::TimeExceeded,
                (3, _) => ReplyKind::Unreachable,
                _ => return None,
            };
            let address = Ipv4Addr::new(control[20], control[21], control[22], control[23]);
            if address.is_unspecified() || address.is_multicast() || address.is_broadcast() {
                return None;
            }
            Some(ExtendedError::Remote(address, kind))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn remote(kind: u8, code: u8) -> Vec<u8> {
        let mut bytes = vec![0; 32];
        bytes[4] = 2;
        bytes[5] = kind;
        bytes[6] = code;
        bytes[16..18].copy_from_slice(&2u16.to_ne_bytes());
        bytes[20..24].copy_from_slice(&[192, 0, 2, 1]);
        bytes
    }
    #[test]
    fn echo_requires_complete_identity_payload_checksum_and_source() {
        let target = Ipv4Addr::LOCALHOST;
        for size in [0, 1, 7, 8, 32, 65500] {
            let request = packet::echo_sized(123, 456, [7; 8], size);
            let mut reply = request.clone();
            reply[0] = 0;
            reply[2..4].fill(0);
            let checksum = packet::checksum(&reply);
            reply[2..4].copy_from_slice(&checksum.to_be_bytes());
            assert!(echo_reply(&reply, target, target, &request));
            assert!(!echo_reply(
                &reply,
                Ipv4Addr::new(192, 0, 2, 1),
                target,
                &request
            ));
            assert!(!echo_reply(
                &reply,
                target,
                target,
                &packet::echo_sized(123, 457, [7; 8], size)
            ));
            for length in [0, 1, 7, reply.len() - 1] {
                assert!(!echo_reply(&reply[..length], target, target, &request));
            }
            reply[2] ^= 1;
            assert!(!echo_reply(&reply, target, target, &request));
        }
    }
    #[test]
    fn errors_match_original_destination_identifier_sequence_and_type() {
        let target = Ipv4Addr::new(192, 0, 2, 2);
        let request = packet::echo_sized(123, 456, [7; 8], 32);
        for (kind, code, expected) in [
            (11, 0, ReplyKind::TimeExceeded),
            (3, 1, ReplyKind::Unreachable),
        ] {
            let control = remote(kind, code);
            assert_eq!(
                extended_error(&control, &request[..8], target, target, &request),
                Some(ExtendedError::Remote(Ipv4Addr::new(192, 0, 2, 1), expected))
            );
            for length in 0..control.len() {
                assert!(
                    extended_error(&control[..length], &request, target, target, &request)
                        .is_none()
                );
            }
            for length in 0..8 {
                assert!(
                    extended_error(&control, &request[..length], target, target, &request)
                        .is_none()
                );
            }
            assert!(
                extended_error(&control, &request, Ipv4Addr::LOCALHOST, target, &request).is_none()
            );
            assert!(
                extended_error(
                    &control,
                    &request,
                    target,
                    target,
                    &packet::echo_sized(123, 457, [7; 8], 32)
                )
                .is_none()
            );
            let mut unknown = control.clone();
            unknown[4] = 99;
            assert!(extended_error(&unknown, &request, target, target, &request).is_none());
        }
        assert!(extended_error(&remote(11, 1), &request, target, target, &request).is_none());
        let mut unknown_source = remote(11, 0);
        unknown_source[16..18].fill(0);
        assert!(extended_error(&unknown_source, &request, target, target, &request).is_none());
    }
    #[test]
    fn local_errors_remain_local_failures_instead_of_hop_loss() {
        let mut control = vec![0; 16];
        control[..4].copy_from_slice(&13u32.to_ne_bytes());
        control[4] = 1;
        assert_eq!(
            extended_error(&control, &[], Ipv4Addr::LOCALHOST, Ipv4Addr::LOCALHOST, &[]),
            Some(ExtendedError::Local(13))
        );
    }
}
