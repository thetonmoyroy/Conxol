use conxol_network::{
    LivePingOptions, LivePingResult, NetworkDiagnosticError, PortScanOptions, ScanProtocol,
    TcpCheckResult, TracerouteOptions, TracerouteResult, mtr_live, ping_live,
    scan_ports_with_progress,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;
use tokio::sync::watch;
use uuid::Uuid;

const MIN_TIMEOUT_MS: u64 = 50;
const MAX_TIMEOUT_MS: u64 = 60_000;
const MAX_CONCURRENT_OPERATIONS: usize = 2;
const SCAN_BATCH_SIZE: usize = 64;
const SCAN_PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkScanRequest {
    #[serde(default)]
    pub protocol: ScanProtocol,
    pub host: String,
    pub start_port: u16,
    pub end_port: u16,
    pub concurrency: usize,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkScanResponse {
    pub scan_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkDiagnosticResponse {
    pub operation_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum NetworkScanState {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkScanEvent {
    scan_id: String,
    state: NetworkScanState,
    scanned: usize,
    total: usize,
    results: Vec<TcpCheckResult>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum NetworkDiagnosticKind {
    Ping,
    Mtr,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum NetworkDiagnosticState {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkDiagnosticEvent {
    operation_id: String,
    kind: NetworkDiagnosticKind,
    state: NetworkDiagnosticState,
    ping: Option<LivePingResult>,
    traceroute: Option<TracerouteResult>,
    error: Option<String>,
}

#[derive(Debug, Error)]
pub enum NetworkManagerError {
    #[error("network scan manager lock poisoned")]
    LockPoisoned,
    #[error("the concurrent network operation limit has been reached")]
    OperationLimit,
    #[error(
        "network scan timeout must be between {MIN_TIMEOUT_MS} and {MAX_TIMEOUT_MS} milliseconds"
    )]
    InvalidTimeout,
    #[error(transparent)]
    Diagnostic(#[from] NetworkDiagnosticError),
}

#[derive(Clone, Default)]
pub struct NetworkManager {
    scans: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    diagnostics: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl NetworkManager {
    pub async fn start_scan(
        &self,
        app: AppHandle,
        request: NetworkScanRequest,
    ) -> Result<NetworkScanResponse, NetworkManagerError> {
        if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&request.timeout_ms) {
            return Err(NetworkManagerError::InvalidTimeout);
        }
        let options = PortScanOptions {
            host: request.host,
            start_port: request.start_port,
            end_port: request.end_port,
            concurrency: request.concurrency,
            timeout: Duration::from_millis(request.timeout_ms),
        };
        options.validate()?;
        let total = usize::from(options.end_port - options.start_port) + 1;
        let scan_id = Uuid::new_v4().to_string();
        let (cancel_sender, mut cancellation) = watch::channel(false);
        register_operation(&self.scans, scan_id.clone(), cancel_sender)?;

        emit_scan_event(
            &app,
            NetworkScanEvent {
                scan_id: scan_id.clone(),
                state: NetworkScanState::Running,
                scanned: 0,
                total,
                results: Vec::new(),
                error: None,
            },
        );

        let manager = self.clone();
        let id_for_task = scan_id.clone();
        let last_scanned = Arc::new(AtomicUsize::new(0));
        let progress_scanned = Arc::clone(&last_scanned);
        tauri::async_runtime::spawn(async move {
            let progress_app = app.clone();
            let progress_id = id_for_task.clone();
            let mut pending_results = crate::output_batch::ProgressBatch::new(
                SCAN_BATCH_SIZE,
                SCAN_PROGRESS_INTERVAL,
                Instant::now(),
            );
            let result = scan_ports_with_progress(
                options,
                request.protocol,
                &mut cancellation,
                |port_result, scanned, total| {
                    progress_scanned.store(scanned, Ordering::Relaxed);
                    let Some(results) = pending_results.push(port_result.clone(), Instant::now())
                    else {
                        return;
                    };
                    emit_scan_event(
                        &progress_app,
                        NetworkScanEvent {
                            scan_id: progress_id.clone(),
                            state: NetworkScanState::Running,
                            scanned,
                            total,
                            results,
                            error: None,
                        },
                    );
                },
            )
            .await;

            match result {
                Ok(results) => emit_scan_event(
                    &app,
                    NetworkScanEvent {
                        scan_id: id_for_task.clone(),
                        state: NetworkScanState::Completed,
                        scanned: results.len(),
                        total,
                        results: pending_results.take(),
                        error: None,
                    },
                ),
                Err(NetworkDiagnosticError::Cancelled) => emit_scan_event(
                    &app,
                    NetworkScanEvent {
                        scan_id: id_for_task.clone(),
                        state: NetworkScanState::Cancelled,
                        scanned: last_scanned.load(Ordering::Relaxed),
                        total,
                        results: pending_results.take(),
                        error: None,
                    },
                ),
                Err(error) => emit_scan_event(
                    &app,
                    NetworkScanEvent {
                        scan_id: id_for_task.clone(),
                        state: NetworkScanState::Failed,
                        scanned: last_scanned.load(Ordering::Relaxed),
                        total,
                        results: pending_results.take(),
                        error: Some(error.to_string()),
                    },
                ),
            }
            manager.remove(&id_for_task);
        });

        Ok(NetworkScanResponse { scan_id })
    }

    pub fn cancel_scan(&self, scan_id: &str) -> Result<bool, NetworkManagerError> {
        let sender = self
            .scans
            .lock()
            .map_err(|_| NetworkManagerError::LockPoisoned)?
            .get(scan_id)
            .cloned();
        let Some(sender) = sender else {
            return Ok(false);
        };
        if sender.send(true).is_err() {
            self.remove(scan_id);
            return Ok(false);
        }
        Ok(true)
    }

    pub async fn start_ping(
        &self,
        app: AppHandle,
        host: String,
        timeout_ms: u64,
        interval_ms: u64,
        packet_size: u16,
    ) -> Result<NetworkDiagnosticResponse, NetworkManagerError> {
        let options = LivePingOptions {
            interval: Duration::from_millis(interval_ms),
            packet_size,
            host,
            timeout: validated_timeout(timeout_ms)?,
        };
        options.validate()?;
        let operation_id = Uuid::new_v4().to_string();
        let (cancel_sender, mut cancellation) = watch::channel(false);
        register_operation(&self.diagnostics, operation_id.clone(), cancel_sender)?;
        emit_diagnostic_event(
            &app,
            NetworkDiagnosticEvent {
                operation_id: operation_id.clone(),
                kind: NetworkDiagnosticKind::Ping,
                state: NetworkDiagnosticState::Running,
                ping: None,
                traceroute: None,
                error: None,
            },
        );
        let manager = self.clone();
        let id_for_task = operation_id.clone();
        tauri::async_runtime::spawn(async move {
            match ping_live(options, &mut cancellation, |snapshot| {
                emit_diagnostic_event(
                    &app,
                    NetworkDiagnosticEvent {
                        operation_id: id_for_task.clone(),
                        kind: NetworkDiagnosticKind::Ping,
                        state: NetworkDiagnosticState::Running,
                        ping: Some(snapshot),
                        traceroute: None,
                        error: None,
                    },
                );
            })
            .await
            {
                Ok(result) => emit_diagnostic_event(
                    &app,
                    NetworkDiagnosticEvent {
                        operation_id: id_for_task.clone(),
                        kind: NetworkDiagnosticKind::Ping,
                        state: NetworkDiagnosticState::Completed,
                        ping: Some(result),
                        traceroute: None,
                        error: None,
                    },
                ),
                Err(NetworkDiagnosticError::Cancelled) => emit_diagnostic_event(
                    &app,
                    NetworkDiagnosticEvent {
                        operation_id: id_for_task.clone(),
                        kind: NetworkDiagnosticKind::Ping,
                        state: NetworkDiagnosticState::Cancelled,
                        ping: None,
                        traceroute: None,
                        error: None,
                    },
                ),
                Err(error) => emit_diagnostic_event(
                    &app,
                    NetworkDiagnosticEvent {
                        operation_id: id_for_task.clone(),
                        kind: NetworkDiagnosticKind::Ping,
                        state: NetworkDiagnosticState::Failed,
                        ping: None,
                        traceroute: None,
                        error: Some(error.to_string()),
                    },
                ),
            }
            manager.remove_diagnostic(&id_for_task);
        });
        Ok(NetworkDiagnosticResponse { operation_id })
    }

    pub async fn start_mtr(
        &self,
        app: AppHandle,
        host: String,
        timeout_ms: u64,
        max_hops: u8,
    ) -> Result<NetworkDiagnosticResponse, NetworkManagerError> {
        let mtr_program = if cfg!(windows) {
            let packaged = app
                .path()
                .resource_dir()
                .map_err(|_| NetworkDiagnosticError::MtrUnavailable)?
                .join("helpers/mtr/mtr.exe");
            if packaged.is_file() {
                packaged
            } else {
                #[cfg(debug_assertions)]
                {
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../../../tools/mtr/windows-x86_64/mtr.exe")
                }
                #[cfg(not(debug_assertions))]
                {
                    return Err(NetworkDiagnosticError::MtrUnavailable.into());
                }
            }
        } else {
            std::path::PathBuf::from("mtr")
        };
        let kind = NetworkDiagnosticKind::Mtr;
        let options = TracerouteOptions {
            host,
            timeout: validated_timeout(timeout_ms)?,
            max_hops,
        };
        options.validate()?;
        let operation_id = Uuid::new_v4().to_string();
        let (cancel_sender, mut cancellation) = watch::channel(false);
        register_operation(&self.diagnostics, operation_id.clone(), cancel_sender)?;
        emit_diagnostic_event(
            &app,
            NetworkDiagnosticEvent {
                operation_id: operation_id.clone(),
                kind: kind.clone(),
                state: NetworkDiagnosticState::Running,
                ping: None,
                traceroute: None,
                error: None,
            },
        );
        let manager = self.clone();
        let id_for_task = operation_id.clone();
        tauri::async_runtime::spawn(async move {
            let result = mtr_live(&mtr_program, options, &mut cancellation, |snapshot| {
                emit_diagnostic_event(
                    &app,
                    NetworkDiagnosticEvent {
                        operation_id: id_for_task.clone(),
                        kind: NetworkDiagnosticKind::Mtr,
                        state: NetworkDiagnosticState::Running,
                        ping: None,
                        traceroute: Some(snapshot),
                        error: None,
                    },
                );
            })
            .await;
            match result {
                Ok(result) => emit_diagnostic_event(
                    &app,
                    NetworkDiagnosticEvent {
                        operation_id: id_for_task.clone(),
                        kind: kind.clone(),
                        state: NetworkDiagnosticState::Completed,
                        ping: None,
                        traceroute: Some(result),
                        error: None,
                    },
                ),
                Err(NetworkDiagnosticError::Cancelled) => emit_diagnostic_event(
                    &app,
                    NetworkDiagnosticEvent {
                        operation_id: id_for_task.clone(),
                        kind: kind.clone(),
                        state: NetworkDiagnosticState::Cancelled,
                        ping: None,
                        traceroute: None,
                        error: None,
                    },
                ),
                Err(error) => emit_diagnostic_event(
                    &app,
                    NetworkDiagnosticEvent {
                        operation_id: id_for_task.clone(),
                        kind: kind.clone(),
                        state: NetworkDiagnosticState::Failed,
                        ping: None,
                        traceroute: None,
                        error: Some(error.to_string()),
                    },
                ),
            }
            manager.remove_diagnostic(&id_for_task);
        });
        Ok(NetworkDiagnosticResponse { operation_id })
    }

    pub fn cancel_diagnostic(&self, operation_id: &str) -> Result<bool, NetworkManagerError> {
        let sender = self
            .diagnostics
            .lock()
            .map_err(|_| NetworkManagerError::LockPoisoned)?
            .get(operation_id)
            .cloned();
        let Some(sender) = sender else {
            return Ok(false);
        };
        if sender.send(true).is_err() {
            self.remove_diagnostic(operation_id);
            return Ok(false);
        }
        Ok(true)
    }

    fn remove(&self, scan_id: &str) {
        if let Ok(mut scans) = self.scans.lock() {
            scans.remove(scan_id);
        }
    }

    fn remove_diagnostic(&self, operation_id: &str) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            diagnostics.remove(operation_id);
        }
    }
}

fn register_operation(
    operations: &Mutex<HashMap<String, watch::Sender<bool>>>,
    operation_id: String,
    cancel_sender: watch::Sender<bool>,
) -> Result<(), NetworkManagerError> {
    let mut operations = operations
        .lock()
        .map_err(|_| NetworkManagerError::LockPoisoned)?;
    if operations.len() >= MAX_CONCURRENT_OPERATIONS {
        return Err(NetworkManagerError::OperationLimit);
    }
    operations.insert(operation_id, cancel_sender);
    Ok(())
}

fn emit_scan_event(app: &AppHandle, event: NetworkScanEvent) {
    let _ = app.emit("network://scan", event);
}

fn emit_diagnostic_event(app: &AppHandle, event: NetworkDiagnosticEvent) {
    let _ = app.emit("network://diagnostic", event);
}

fn validated_timeout(timeout_ms: u64) -> Result<Duration, NetworkManagerError> {
    if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return Err(NetworkManagerError::InvalidTimeout);
    }
    Ok(Duration::from_millis(timeout_ms))
}

#[cfg(test)]
mod tests {
    use super::{MAX_CONCURRENT_OPERATIONS, NetworkManagerError, register_operation};
    use std::collections::HashMap;
    use std::sync::Mutex;
    use tokio::sync::watch;

    #[test]
    fn network_operation_registry_enforces_its_concurrency_limit() {
        let operations = Mutex::new(HashMap::new());
        let mut receivers = Vec::new();

        for index in 0..MAX_CONCURRENT_OPERATIONS {
            let (sender, receiver) = watch::channel(false);
            receivers.push(receiver);
            register_operation(&operations, index.to_string(), sender).unwrap();
        }

        let (sender, receiver) = watch::channel(false);
        receivers.push(receiver);
        assert!(matches!(
            register_operation(&operations, "overflow".into(), sender),
            Err(NetworkManagerError::OperationLimit)
        ));
        assert_eq!(operations.lock().unwrap().len(), MAX_CONCURRENT_OPERATIONS);
    }

    #[test]
    fn cancelling_finished_operations_returns_false_and_cleans_stale_entries() {
        let manager = super::NetworkManager::default();
        let (scan_sender, scan_receiver) = watch::channel(false);
        drop(scan_receiver);
        manager
            .scans
            .lock()
            .unwrap()
            .insert("finished-scan".into(), scan_sender);

        let (diagnostic_sender, diagnostic_receiver) = watch::channel(false);
        drop(diagnostic_receiver);
        manager
            .diagnostics
            .lock()
            .unwrap()
            .insert("finished-diagnostic".into(), diagnostic_sender);

        assert!(!manager.cancel_scan("finished-scan").unwrap());
        assert!(!manager.scans.lock().unwrap().contains_key("finished-scan"));
        assert!(!manager.cancel_diagnostic("finished-diagnostic").unwrap());
        assert!(
            !manager
                .diagnostics
                .lock()
                .unwrap()
                .contains_key("finished-diagnostic")
        );
    }
}
