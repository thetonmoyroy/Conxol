//! Async desktop adapter for the in-process native MTR engine.
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

async fn wait_stop(cancellation: &mut watch::Receiver<bool>) {
    // Return unit so a watch read guard cannot survive into a select handler
    // that awaits the worker join (the desktop future must remain Send).
    let _ = cancellation.wait_for(|stop| *stop).await;
}

pub async fn mtr_report(
    options: TracerouteOptions,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<TracerouteResult, NetworkDiagnosticError> {
    execute(options, cancellation, |_| {}, false).await
}

pub async fn mtr_live(
    options: TracerouteOptions,
    cancellation: &mut watch::Receiver<bool>,
    progress: impl FnMut(TracerouteResult),
) -> Result<TracerouteResult, NetworkDiagnosticError> {
    execute(options, cancellation, progress, true).await
}

async fn execute(
    options: TracerouteOptions,
    cancellation: &mut watch::Receiver<bool>,
    mut progress: impl FnMut(TracerouteResult),
    live: bool,
) -> Result<TracerouteResult, NetworkDiagnosticError> {
    options.validate()?;
    if *cancellation.borrow() {
        return Err(NetworkDiagnosticError::Cancelled);
    }
    if !cfg!(any(windows, target_os = "macos")) {
        return Err(NetworkDiagnosticError::MtrUnsupported);
    }
    let target = match options.host.parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => address,
        Ok(IpAddr::V6(_)) => return Err(NetworkDiagnosticError::MtrUnsupported),
        Err(_) => tokio::select! {
            _ = wait_stop(cancellation) => return Err(NetworkDiagnosticError::Cancelled),
            result = tokio::time::timeout(options.timeout, lookup_host((options.host.as_str(), 0))) => {
                result.map_err(|_| NetworkDiagnosticError::Timeout)?
                    .map_err(|_| NetworkDiagnosticError::Resolution)?
                    .find_map(|address| match address.ip() { IpAddr::V4(ip) => Some(ip), _ => None })
                    .ok_or(NetworkDiagnosticError::MtrUnsupported)?
            }
        },
    };
    let mut native = conxol_mtr::Options::new(target);
    native.max_hops = options.max_hops;
    native.timeout = options.timeout.min(Duration::from_secs(2));
    let flag = Arc::new(AtomicBool::new(false));
    let _guard = StopWorker(flag.clone()); // Also stops a worker if this future is dropped.
    let worker_flag = flag.clone();
    // A single latest-value slot bounds memory when the UI consumer is slower.
    let (updates, mut snapshots) = watch::channel(None::<conxol_mtr::Report>);
    let mut worker = tokio::task::spawn_blocking(move || {
        let mut previous = std::time::Instant::now() - Duration::from_secs(1);
        let publish = |report: &conxol_mtr::Report| {
            if previous.elapsed() >= Duration::from_millis(100) {
                previous = std::time::Instant::now();
                let _ = updates.send(Some(report.clone()));
            }
        };
        if live {
            conxol_mtr::run_live(&native, &worker_flag, publish)
        } else {
            conxol_mtr::run(&native, &worker_flag, publish)
        }
    });
    loop {
        tokio::select! {
            biased;
            _ = wait_stop(cancellation) => {
                flag.store(true, Ordering::Relaxed);
                // Join before reporting Stop so native handles/sockets are closed.
                let _ = worker.await;
                return Err(NetworkDiagnosticError::Cancelled);
            }
            result = &mut worker => {
                let report = result.map_err(|_| NetworkDiagnosticError::Worker)?
                    .map_err(|error| match error {
                        conxol_mtr::Error::Cancelled => NetworkDiagnosticError::Cancelled,
                        conxol_mtr::Error::UnsupportedPlatform => NetworkDiagnosticError::MtrUnsupported,
                        conxol_mtr::Error::InvalidTarget => NetworkDiagnosticError::InvalidTarget,
                        _ => NetworkDiagnosticError::MtrUnavailable,
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

fn snapshot(host: &str, report: &conxol_mtr::Report) -> TracerouteResult {
    let mut lines = vec![format!(
        "{:<4} {:<40} {:>6} {:>8} {:>8} {:>8} {:>8} {:>8}",
        "Hop", "Host", "Loss%", "Sent", "Last", "Avg", "Best", "Worst"
    )];
    for hop in &report.hops {
        let number = |value: Option<f64>| value.map_or_else(|| "—".into(), |v| format!("{v:.2}"));
        lines.push(format!(
            "{:<4} {:<40} {:>6.1} {:>8} {:>8} {:>8} {:>8} {:>8}",
            hop.ttl,
            hop.address
                .map_or_else(|| "???".into(), |ip| ip.to_string()),
            hop.loss_percent,
            hop.sent,
            number(hop.last_ms),
            number(hop.average_ms),
            number(hop.best_ms),
            number(hop.worst_ms)
        ));
    }
    TracerouteResult {
        host: host.into(),
        reached: report.reached,
        hops: lines,
        elapsed_ms: report.elapsed_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options(host: &str) -> TracerouteOptions {
        TracerouteOptions {
            host: host.into(),
            timeout: Duration::from_secs(1),
            max_hops: 1,
        }
    }

    #[tokio::test]
    async fn cancelled_run_never_resolves_or_opens_native_backend() {
        let (_sender, mut cancel) = watch::channel(true);
        assert!(matches!(
            mtr_live(options("127.0.0.1"), &mut cancel, |_| panic!(
                "unexpected update"
            ))
            .await,
            Err(NetworkDiagnosticError::Cancelled)
        ));
    }

    #[tokio::test]
    async fn ipv6_is_explicitly_unsupported_without_external_fallback() {
        let (_sender, mut cancel) = watch::channel(false);
        assert!(matches!(
            mtr_report(options("::1"), &mut cancel).await,
            Err(NetworkDiagnosticError::MtrUnsupported)
        ));
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[tokio::test]
    async fn native_loopback_report_and_live_stop() {
        let (sender, mut cancel) = watch::channel(false);
        let mut updates = 0;
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            mtr_live(options("127.0.0.1"), &mut cancel, |report| {
                assert!(report.reached);
                assert!(report.hops[1].contains("127.0.0.1"));
                updates += 1;
                if updates == 2 {
                    sender.send(true).unwrap();
                }
            }),
        )
        .await
        .unwrap();
        assert!(matches!(result, Err(NetworkDiagnosticError::Cancelled)));
        assert_eq!(updates, 2);
        sender.send(false).unwrap();
        let report = mtr_report(options("127.0.0.1"), &mut cancel).await.unwrap();
        assert!(report.reached);
        assert!(report.hops[1].contains("127.0.0.1"));
    }
}
