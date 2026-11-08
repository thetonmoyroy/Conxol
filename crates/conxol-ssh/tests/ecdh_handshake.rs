//! Disposable ECDH-only peers; no credentials, personal files, or LAN access.
use russh::{
    keys::{
        HashAlg, PrivateKey,
        ssh_key::private::{Ed25519Keypair, KeypairData},
    },
    server,
};
use std::{sync::Arc, time::Duration};
use conxol_ssh::{SshFingerprintOptions, inspect_host_key};
use tokio::net::TcpListener;
use uuid::Uuid;
use zeroize::Zeroizing;

struct Peer;
impl server::Handler for Peer {
    type Error = russh::Error;
}

#[tokio::test]
async fn ecdh_only_servers_complete_verified_handshakes() {
    for algorithm in [
        russh::kex::ECDH_SHA2_NISTP256,
        russh::kex::ECDH_SHA2_NISTP384,
        russh::kex::ECDH_SHA2_NISTP521,
    ] {
        let mut seed = Zeroizing::new([0u8; 32]);
        seed[..16].copy_from_slice(Uuid::new_v4().as_bytes());
        seed[16..].copy_from_slice(Uuid::new_v4().as_bytes());
        let key =
            PrivateKey::new(KeypairData::Ed25519(Ed25519Keypair::from_seed(&seed)), "").unwrap();
        let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        let mut config = server::Config {
            keys: vec![key],
            ..Default::default()
        };
        config.preferred.kex = vec![algorithm].into();
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
            timeout: Duration::from_secs(5),
        })
        .await;
        // Ensure fixture teardown also happens when the client fails.
        worker.abort();
        let _ = worker.await;
        assert_eq!(
            inspection.unwrap().fingerprint,
            fingerprint,
            "{algorithm:?}"
        );
    }
}
