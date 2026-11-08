use russh::keys::key::verify_server_signature;
use russh::keys::{Algorithm, HashAlg, PublicKey, ssh_key::Signature};
const MESSAGE: &[u8] = include_bytes!("fixtures/rsa-host/message.txt");
#[test]
fn rsa_sha2_host_signatures_use_public_verification_and_reject_tampering() {
    let public = PublicKey::from_openssh(include_str!("fixtures/rsa-host/public.pub")).unwrap();
    for (hash, bytes) in [
        (
            HashAlg::Sha256,
            &include_bytes!("fixtures/rsa-host/sha256.sig")[..],
        ),
        (
            HashAlg::Sha512,
            &include_bytes!("fixtures/rsa-host/sha512.sig")[..],
        ),
    ] {
        let algorithm = Algorithm::Rsa { hash: Some(hash) };
        let signature = Signature::new(algorithm.clone(), bytes.to_vec()).unwrap();
        assert!(verify_server_signature(
            &public, &algorithm, MESSAGE, &signature
        ));
        assert!(!verify_server_signature(
            &public,
            &algorithm,
            b"altered exchange",
            &signature
        ));
        let mut altered = bytes.to_vec();
        altered[0] ^= 1;
        let altered = Signature::new(algorithm.clone(), altered).unwrap();
        assert!(!verify_server_signature(
            &public, &algorithm, MESSAGE, &altered
        ));
        assert!(!verify_server_signature(
            &public,
            &Algorithm::Rsa { hash: None },
            MESSAGE,
            &signature
        ));
        let other = Algorithm::Rsa {
            hash: Some(if hash == HashAlg::Sha256 {
                HashAlg::Sha512
            } else {
                HashAlg::Sha256
            }),
        };
        assert!(!verify_server_signature(
            &public, &other, MESSAGE, &signature
        ));
    }
    let sha1 = Algorithm::Rsa { hash: None };
    let signature = Signature::new(
        sha1.clone(),
        include_bytes!("fixtures/rsa-host/sha256.sig").to_vec(),
    )
    .unwrap();
    assert!(!verify_server_signature(
        &public, &sha1, MESSAGE, &signature
    ));
}

#[test]
fn negotiated_legacy_rsa_verifies_sha1_and_rejects_tampering() {
    let public = PublicKey::from_openssh(include_str!("fixtures/rsa-host/legacy-public.pub")).unwrap();
    let algorithm = Algorithm::Rsa { hash: None };
    let bytes = include_bytes!("fixtures/rsa-host/sha1.sig");
    let signature = Signature::new(algorithm.clone(), bytes.to_vec()).unwrap();
    assert!(verify_server_signature(&public, &algorithm, MESSAGE, &signature));
    assert!(!verify_server_signature(&public, &algorithm, b"altered exchange", &signature));
    assert!(!verify_server_signature(&public, &Algorithm::Rsa { hash: Some(HashAlg::Sha256) }, MESSAGE, &signature));
    let mut altered = bytes.to_vec();
    altered[0] ^= 1;
    let altered = Signature::new(algorithm.clone(), altered).unwrap();
    assert!(!verify_server_signature(&public, &algorithm, MESSAGE, &altered));
}
