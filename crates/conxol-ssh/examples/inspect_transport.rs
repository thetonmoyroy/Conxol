//! Explicit, credential-free host-key inspection. Does not save trust.
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let host = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("usage: inspect_transport HOST [PORT]"))?;
    let port = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "22".into())
        .parse()?;
    let inspection = conxol_ssh::inspect_host_key(conxol_ssh::SshFingerprintOptions {
        legacy_rsa: false,
        host,
        port,
        timeout: Duration::from_secs(10),
    })
    .await?;
    println!("SSH handshake completed; no authentication attempted.");
    println!("Observed host-key fingerprint: {}", inspection.fingerprint);
    println!("Observation does not approve or save this host key.");
    Ok(())
}
