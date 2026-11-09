use russh::keys::key::{decode_server_signature, verify_server_signature};
use russh::keys::{
    Algorithm, EcdsaCurve, HashAlg, PrivateKey,
    ssh_key::{
        Signature, SshSig,
        encoding::{Decode, Encode},
    },
};

fn wire(algorithm: &Algorithm, r: &[u8], s: &[u8]) -> Vec<u8> {
    let mut components = Vec::new();
    r.encode(&mut components).unwrap();
    s.encode(&mut components).unwrap();
    let mut result = Vec::new();
    algorithm.encode(&mut result).unwrap();
    components.encode(&mut result).unwrap();
    result
}

#[test]
fn padded_ecdsa_exchange_signatures_still_require_valid_crypto() {
    for curve in [
        EcdsaCurve::NistP256,
        EcdsaCurve::NistP384,
        EcdsaCurve::NistP521,
    ] {
        let field_size = match curve {
            EcdsaCurve::NistP256 => 32,
            EcdsaCurve::NistP384 => 48,
            EcdsaCurve::NistP521 => 66,
        };
        let algorithm = Algorithm::Ecdsa { curve };
        let key = PrivateKey::random(&mut rand::rng(), algorithm.clone()).unwrap();
        let signed = key.sign("fixture", HashAlg::Sha256, b"exchange").unwrap();
        let message = SshSig::signed_data("fixture", HashAlg::Sha256, b"exchange").unwrap();
        let mut reader = signed.signature().as_bytes();
        let r = Vec::<u8>::decode(&mut reader).unwrap();
        let s = Vec::<u8>::decode(&mut reader).unwrap();
        let pad = |value: &[u8]| {
            let mut padded = vec![0; field_size + 1 - value.len()];
            padded.extend_from_slice(value);
            padded
        };
        let encoded = wire(&algorithm, &pad(&r), &pad(&s));
        let decoded = decode_server_signature(&encoded).unwrap();
        assert_eq!(&decoded, signed.signature());
        assert!(verify_server_signature(
            key.public_key(),
            &algorithm,
            &message,
            &decoded
        ));
        assert!(!verify_server_signature(
            key.public_key(),
            &algorithm,
            b"tampered",
            &decoded
        ));
        // A canonical signature remains byte-for-byte unchanged.
        let mut canonical = Vec::new();
        signed.signature().encode(&mut canonical).unwrap();
        assert_eq!(decode_server_signature(&canonical).unwrap(), decoded);
        for bad in [vec![], vec![0], vec![0x80], vec![0; field_size + 2]] {
            assert!(decode_server_signature(&wire(&algorithm, &bad, &pad(&s))).is_err());
        }
        let mut trailing = encoded.clone();
        trailing.push(0);
        assert!(decode_server_signature(&trailing).is_err());
        assert!(decode_server_signature(&encoded[..encoded.len() - 1]).is_err());
    }
}

#[test]
fn non_ecdsa_lengths_are_not_relaxed() {
    let encoded = wire(&Algorithm::Ed25519, &[0, 1], &[0, 1]);
    assert!(Signature::decode(&mut encoded.as_slice()).is_err());
    assert!(decode_server_signature(&encoded).is_err());
}

#[test]
fn redundant_positive_zeros_are_the_only_integer_relaxation() {
    let algorithm = Algorithm::Ecdsa {
        curve: EcdsaCurve::NistP256,
    };
    let padded = wire(&algorithm, &[0, 1], &[0, 2]);
    assert!(Signature::decode(&mut padded.as_slice()).is_err());
    let canonical = wire(&algorithm, &[1], &[2]);
    assert_eq!(
        decode_server_signature(&padded).unwrap(),
        decode_server_signature(&canonical).unwrap()
    );
    for bad in [vec![0, 0], vec![0x80], vec![0xff, 1], vec![0; 34]] {
        assert!(decode_server_signature(&wire(&algorithm, &[0, 1], &bad)).is_err());
    }
    let mut extra_component = vec![0, 0, 0, 1, 1, 0, 0, 0, 1, 2, 0];
    let mut extra = Vec::new();
    algorithm.encode(&mut extra).unwrap();
    extra_component.encode(&mut extra).unwrap();
    assert!(decode_server_signature(&extra).is_err());
    extra_component.clear();
}
