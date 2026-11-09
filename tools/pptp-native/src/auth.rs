//! RFC 2759 MS-CHAPv2. Never log inputs or derived authentication material.
use des::{
    Des,
    cipher::{BlockEncrypt, KeyInit},
};
use md4::{Digest, Md4};
use sha1::Sha1;
use zeroize::{Zeroize, Zeroizing};

fn challenge(peer: &[u8; 16], server: &[u8; 16], user: &str) -> [u8; 8] {
    let user = user.rsplit('\\').next().unwrap_or(user);
    let mut hash = Sha1::new();
    hash.update(peer);
    hash.update(server);
    hash.update(user.as_bytes());
    hash.finalize()[..8].try_into().unwrap()
}

pub struct Response {
    pub nt: Zeroizing<[u8; 24]>,
    pub expected: Zeroizing<String>,
    pub keys: crate::mppe::Keys,
}

pub fn response(user: &str, password: &str, peer: &[u8; 16], server: &[u8; 16]) -> Response {
    let unicode = Zeroizing::new(
        password
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let hash = Zeroizing::new(<[u8; 16]>::from(Md4::digest(&*unicode)));
    let hashhash = Zeroizing::new(<[u8; 16]>::from(Md4::digest(hash.as_slice())));
    let challenge = challenge(peer, server, user);
    let mut padded = Zeroizing::new([0u8; 21]);
    padded[..16].copy_from_slice(&*hash);
    let mut nt = Zeroizing::new([0u8; 24]);
    for (i, raw) in padded.chunks_exact(7).enumerate() {
        let mut key = Zeroizing::new([0u8; 8]);
        // Expand seven bytes to eight DES bytes, reserving each low bit for parity.
        let mut bits = 0u64;
        for byte in raw {
            bits = (bits << 8) | u64::from(*byte);
        }
        for (j, byte) in key.iter_mut().enumerate() {
            let value = ((bits >> (49 - j * 7)) as u8 & 0x7f) << 1;
            *byte = value | u8::from(value.count_ones().is_multiple_of(2));
        }
        bits.zeroize();
        let cipher = Des::new_from_slice(&*key).unwrap();
        let mut block = challenge.into();
        cipher.encrypt_block(&mut block);
        nt[i * 8..i * 8 + 8].copy_from_slice(&block);
        block.as_mut_slice().zeroize();
    }
    let mut h = Sha1::new();
    h.update(hashhash.as_slice());
    h.update(nt.as_slice());
    h.update(b"Magic server to client signing constant");
    let digest = Zeroizing::new(<[u8; 20]>::from(h.finalize()));
    let mut h = Sha1::new();
    h.update(digest.as_slice());
    h.update(challenge);
    h.update(b"Pad to make it do more than one iteration");
    let mut expected = Zeroizing::new(String::from("S="));
    use std::fmt::Write;
    for byte in h.finalize() {
        write!(&mut *expected, "{byte:02X}").unwrap();
    }
    let keys = crate::mppe::derive(&hashhash, &nt);
    Response { nt, expected, keys }
}

pub fn verify_success(message: &[u8], expected: &str) -> bool {
    let Some(actual) = message.get(..42) else {
        return false;
    };
    let mut difference = 0u8;
    for (a, b) in actual.iter().zip(expected.as_bytes()) {
        difference |= a ^ b;
    }
    difference == 0 && (message.len() == 42 || message[42] == b' ')
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rfc2759_vector_and_server_verification() {
        let response = response(
            "User",
            "clientPass",
            b"!@#$%^&*()_+:3|~",
            b"[]|}{?/><,`!2&&(",
        );
        assert_eq!(
            &*response.nt,
            &[
                0x82, 0x30, 0x9e, 0xcd, 0x8d, 0x70, 0x8b, 0x5e, 0xa0, 0x8f, 0xaa, 0x39, 0x81, 0xcd,
                0x83, 0x54, 0x42, 0x33, 0x11, 0x4a, 0x3d, 0x85, 0xd6, 0xdf
            ]
        );
        assert_eq!(
            &*response.expected,
            "S=407A5589115FD0D6209F510FE9C04566932CDA56"
        );
        assert!(verify_success(
            response.expected.as_bytes(),
            &response.expected
        ));
        assert!(!verify_success(
            b"S=0000000000000000000000000000000000000000",
            &response.expected
        ));
        assert!(!verify_success(b"S=", &response.expected));
    }
}
