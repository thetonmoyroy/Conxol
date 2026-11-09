//! Desktop bridge to conxol-ping; no external ping process or text parser.
use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

struct StopWorker(Arc<AtomicBool>);
impl Drop for StopWorker {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}
async fn wait_stop(cancel: &mut watch::Receiver<bool>) {
    let _ = cancel.wait_for(|stop| *stop).await;
}

pub async fn ping(
    options: PingOptions,
    cancel: &mut watch::Receiver<bool>,
) -> Result<PingResult, NetworkDiagnosticError> {
    let report = execute(
        LivePingOptions {
            host: options.host,
            timeout: options.timeout,
            interval: Duration::from_secs(1),
            packet_size: 32,
        },
        cancel,
        |_| {},
        false,
    )
    .await?;
    Ok(PingResult {
        host: report.host,
        reachable: report.received > 0,
        elapsed_ms: report.elapsed_ms,
    })
}
pub async fn ping_live(
    options: LivePingOptions,
    cancel: &mut watch::Receiver<bool>,
    progress: impl FnMut(LivePingResult),
) -> Result<LivePingResult, NetworkDiagnosticError> {
    execute(options, cancel, progress, true).await
}

async fn execute(
    options: LivePingOptions,
    cancel: &mut watch::Receiver<bool>,
    mut progress: impl FnMut(LivePingResult),
    live: bool,
) -> Result<LivePingResult, NetworkDiagnosticError> {
    options.validate()?;
    if *cancel.borrow() {
        return Err(NetworkDiagnosticError::Cancelled);
    }
    if !cfg!(any(windows, target_os = "macos", target_os = "android")) {
        return Err(NetworkDiagnosticError::PingUnsupported);
    }
    let target = match options.host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip,
        Ok(IpAddr::V6(_)) => return Err(NetworkDiagnosticError::PingUnsupported),
        Err(_) => tokio::select! {
            _ = wait_stop(cancel) => return Err(NetworkDiagnosticError::Cancelled),
            result = tokio::time::timeout(options.timeout, lookup_host((options.host.as_str(), 0))) => {
                result.map_err(|_| NetworkDiagnosticError::Timeout)?
                    .map_err(|_| NetworkDiagnosticError::Resolution)?
                    .find_map(|address| match address.ip() { IpAddr::V4(ip) => Some(ip), _ => None })
                    .ok_or(NetworkDiagnosticError::PingUnsupported)?
            }
        },
    };
    let mut native = conxol_ping::Options::new(target);
    native.payload_size = options.packet_size;
    native.timeout = options.timeout;
    native.interval = options.interval;
    native.count = 1;
    native
        .validate()
        .map_err(|_| NetworkDiagnosticError::InvalidTarget)?;
    let flag = Arc::new(AtomicBool::new(false));
    let _guard = StopWorker(flag.clone());
    let worker_flag = flag.clone();
    let (updates, mut snapshots) = watch::channel(None::<conxol_ping::Report>);
    let mut worker = tokio::task::spawn_blocking(move || {
        let publish = |report: &conxol_ping::Report| {
            let _ = updates.send(Some(report.clone()));
        };
        if live {
            conxol_ping::run_live(&native, &worker_flag, publish)
        } else {
            conxol_ping::run(&native, &worker_flag, publish)
        }
    });
    loop {
        tokio::select! {
            biased;
            _ = wait_stop(cancel) => {
                flag.store(true, Ordering::Relaxed);
                let _ = worker.await;
                return Err(NetworkDiagnosticError::Cancelled);
            }
            result = &mut worker => {
                let report = result.map_err(|_| NetworkDiagnosticError::Worker)?
                    .map_err(|error| match error {
                        conxol_ping::Error::Cancelled => NetworkDiagnosticError::Cancelled,
                        conxol_ping::Error::UnsupportedPlatform => NetworkDiagnosticError::PingUnsupported,
                        conxol_ping::Error::InvalidTarget => NetworkDiagnosticError::InvalidTarget,
                        _ => NetworkDiagnosticError::PingUnavailable,
                    })?;
                return Ok(snapshot(&options.host, &report));
            }
            result = snapshots.changed() => {
                if result.is_ok() {
                    let report = snapshots.borrow_and_update().clone();
                    if let Some(report) = report { progress(snapshot(&options.host, &report)); }
                }
            }
        }
    }
}
fn snapshot(host: &str, report: &conxol_ping::Report) -> LivePingResult {
    LivePingResult {
        host: host.into(),
        sent: report.sent,
        received: report.received,
        elapsed_ms: report.elapsed_ms,
        interval_ms: report.interval_ms,
        packet_size: report.payload_size,
        lines: report.lines.iter().cloned().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn ipv6_is_explicit_without_subprocess_fallback() {
        let (_sender, mut cancel) = watch::channel(false);
        let result = ping(
            PingOptions {
                host: "::1".into(),
                timeout: Duration::from_secs(1),
            },
            &mut cancel,
        )
        .await;
        assert!(matches!(
            result,
            Err(NetworkDiagnosticError::PingUnsupported)
        ));
    }
    #[test]
    fn desktop_future_is_send() {
        fn is_send<T: Send>(_: T) {}
        let (_sender, mut cancel) = watch::channel(false);
        is_send(ping_live(
            LivePingOptions {
                host: "127.0.0.1".into(),
                timeout: Duration::from_secs(1),
                interval: Duration::from_secs(1),
                packet_size: 32,
            },
            &mut cancel,
            |_| {},
        ));
    }
}
