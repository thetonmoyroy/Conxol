use russh::keys::key::verify_server_signature;
use russh::keys::{Algorithm, HashAlg, PublicKey, ssh_key::Signature};
const MESSAGE: &[u8] = include_bytes!("fixtures/rsa-host/message.txt");

#[test]
fn legacy_512_and_768_bit_host_signatures_require_valid_padding_and_digest() {
    for (public, message, sha1, sha256, sha512) in [
        (
            include_str!("fixtures/rsa-host/rsa512.pub"),
            &include_bytes!("fixtures/rsa-host/rsa512-message.txt")[..],
            &include_bytes!("fixtures/rsa-host/rsa512-sha1.sig")[..],
            &include_bytes!("fixtures/rsa-host/rsa512-sha256.sig")[..],
            None,
        ),
        (
            include_str!("fixtures/rsa-host/rsa768.pub"),
            &include_bytes!("fixtures/rsa-host/rsa768-message.txt")[..],
            &include_bytes!("fixtures/rsa-host/rsa768-sha1.sig")[..],
            &include_bytes!("fixtures/rsa-host/rsa768-sha256.sig")[..],
            Some(&include_bytes!("fixtures/rsa-host/rsa768-sha512.sig")[..]),
        ),
    ] {
        let public = PublicKey::from_openssh(public).unwrap();
        for (hash, bytes) in [(None, sha1), (Some(HashAlg::Sha256), sha256)]
            .into_iter()
            .chain(sha512.map(|bytes| (Some(HashAlg::Sha512), bytes)))
        {
            let algorithm = Algorithm::Rsa { hash };
            let signature = Signature::new(algorithm.clone(), bytes.to_vec()).unwrap();
            assert!(verify_server_signature(
                &public, &algorithm, message, &signature
            ));
            assert!(!verify_server_signature(
                &public,
                &algorithm,
                b"altered exchange",
                &signature
            ));
            assert!(!verify_server_signature(
                &public,
                &Algorithm::Rsa {
                    hash: Some(HashAlg::Sha512)
                },
                message,
                &Signature::new(Algorithm::Rsa { hash: None }, bytes.to_vec()).unwrap()
            ));
            for invalid in [
                vec![0; bytes.len()],
                vec![1; bytes.len()],
                {
                    let mut changed = bytes.to_vec();
                    changed[bytes.len() - 1] ^= 1;
                    changed
                },
                {
                    let mut oversized = vec![0];
                    oversized.extend_from_slice(bytes);
                    oversized
                },
            ] {
                let bad = Signature::new(algorithm.clone(), invalid).unwrap();
                assert!(!verify_server_signature(&public, &algorithm, message, &bad));
            }
        }
        assert_eq!(sha1[0], 0);
        let start = sha1.iter().position(|byte| *byte != 0).unwrap();
        let algorithm = Algorithm::Rsa { hash: None };
        let short = Signature::new(algorithm.clone(), sha1[start..].to_vec()).unwrap();
        assert!(verify_server_signature(
            &public, &algorithm, message, &short
        ));
        if sha512.is_none() {
            // A 512-bit modulus cannot fit SHA-512's DigestInfo plus padding.
            let algorithm = Algorithm::Rsa {
                hash: Some(HashAlg::Sha512),
            };
            let bad = Signature::new(algorithm.clone(), sha1.to_vec()).unwrap();
            assert!(!verify_server_signature(&public, &algorithm, message, &bad));
        }
    }
}
#[test]
fn legacy_1024_bit_rsa_and_short_signatures_verify_without_accepting_tampering() {
    let public = PublicKey::from_openssh(include_str!("fixtures/rsa-host/rsa1024.pub")).unwrap();
    let message = include_bytes!("fixtures/rsa-host/rsa1024-message.txt");
    for (hash, bytes) in [
        (
            None,
            &include_bytes!("fixtures/rsa-host/rsa1024-sha1.sig")[..],
        ),
        (
            Some(HashAlg::Sha256),
            &include_bytes!("fixtures/rsa-host/rsa1024-sha256.sig")[..],
        ),
        (
            Some(HashAlg::Sha512),
            &include_bytes!("fixtures/rsa-host/rsa1024-sha512.sig")[..],
        ),
    ] {
        let algorithm = Algorithm::Rsa { hash };
        let signature = Signature::new(algorithm.clone(), bytes.to_vec()).unwrap();
        assert!(verify_server_signature(
            &public, &algorithm, message, &signature
        ));
        assert!(!verify_server_signature(
            &public,
            &algorithm,
            b"tampered exchange",
            &signature
        ));
        let mut tampered = bytes.to_vec();
        tampered[bytes.len() - 1] ^= 1;
        let signature = Signature::new(algorithm.clone(), tampered).unwrap();
        assert!(!verify_server_signature(
            &public, &algorithm, message, &signature
        ));
        let mut oversized = vec![0];
        oversized.extend_from_slice(bytes);
        let signature = Signature::new(algorithm.clone(), oversized).unwrap();
        assert!(!verify_server_signature(
            &public, &algorithm, message, &signature
        ));
    }
    let bytes = include_bytes!("fixtures/rsa-host/rsa1024-sha1.sig");
    assert_eq!(bytes[0], 0, "fixture must exercise omitted leading zeros");
    let short = bytes.iter().position(|byte| *byte != 0).unwrap();
    let algorithm = Algorithm::Rsa { hash: None };
    let signature = Signature::new(algorithm.clone(), bytes[short..].to_vec()).unwrap();
    assert!(verify_server_signature(
        &public, &algorithm, message, &signature
    ));
    assert!(!verify_server_signature(
        &public,
        &Algorithm::Rsa {
            hash: Some(HashAlg::Sha256)
        },
        message,
        &signature
    ));
}
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
    let public =
        PublicKey::from_openssh(include_str!("fixtures/rsa-host/legacy-public.pub")).unwrap();
    let algorithm = Algorithm::Rsa { hash: None };
    let bytes = include_bytes!("fixtures/rsa-host/sha1.sig");
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
    assert!(!verify_server_signature(
        &public,
        &Algorithm::Rsa {
            hash: Some(HashAlg::Sha256)
        },
        MESSAGE,
        &signature
    ));
    let mut altered = bytes.to_vec();
    altered[0] ^= 1;
    let altered = Signature::new(algorithm.clone(), altered).unwrap();
    assert!(!verify_server_signature(
        &public, &algorithm, MESSAGE, &altered
    ));
}
