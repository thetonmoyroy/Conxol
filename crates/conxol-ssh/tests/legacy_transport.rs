//! Disposable legacy-only SSH2 peers. No personal credentials or network hosts.
use conxol_ssh::{SshFingerprintOptions, inspect_host_key};
use russh::{
    cipher, kex,
    keys::{Algorithm, HashAlg, PrivateKey},
    mac, server,
};
use std::{sync::Arc, time::Duration};
use tokio::net::TcpListener;

struct Peer;
impl server::Handler for Peer {
    type Error = russh::Error;
}

#[tokio::test]
async fn legacy_only_peers_complete_verified_handshakes() {
    let modern_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    for exchange in [kex::DH_G14_SHA1, kex::DH_GEX_SHA1, kex::DH_G1_SHA1] {
        for encryption in [
            cipher::AES_256_CBC,
            cipher::AES_192_CBC,
            cipher::AES_128_CBC,
            cipher::TRIPLE_DES_CBC,
        ] {
            for integrity in [mac::HMAC_SHA1_ETM, mac::HMAC_SHA1, mac::HMAC_SHA1_96] {
                check(modern_key.clone(), exchange, encryption, integrity).await;
            }
        }
    }
    let dsa = PrivateKey::random(&mut rand::rng(), Algorithm::Dsa).unwrap();
    check(
        dsa,
        kex::DH_G1_SHA1,
        cipher::TRIPLE_DES_CBC,
        mac::HMAC_SHA1_96,
    )
    .await;
}

async fn check(
    key: PrivateKey,
    exchange: kex::Name,
    encryption: cipher::Name,
    integrity: mac::Name,
) {
    let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
    let host_algorithm = key.algorithm();
    let mut config = server::Config {
        keys: vec![key],
        ..Default::default()
    };
    config.preferred.kex = vec![exchange].into();
    config.preferred.cipher = vec![encryption].into();
    config.preferred.mac = vec![integrity].into();
    config.preferred.key = vec![host_algorithm].into();
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let worker = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        if let Ok(session) = server::run_stream(Arc::new(config), stream, Peer).await {
            let _ = session.await;
        }
    });
    let inspection = inspect_host_key(SshFingerprintOptions {
        legacy_rsa: false,
        host: "127.0.0.1".into(),
        port,
        timeout: Duration::from_secs(10),
    })
    .await;
    worker.abort();
    let _ = worker.await;
    assert_eq!(
        inspection.unwrap().fingerprint,
        fingerprint,
        "{exchange:?}/{encryption:?}/{integrity:?}"
    );
}
