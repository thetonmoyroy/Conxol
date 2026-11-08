//! Rust-owned serial terminal transport.
//!
//! Opening a serial device is an explicit native operation. The crate never
//! enumerates devices implicitly and its tests do not open `/dev`, USB serial
//! adapters, or any other real hardware.

use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use conxol_core::{ConnectionEvent, ConnectionLifecycle, ConnectionState};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_READ_BYTES: usize = 64 * 1024;
const MAX_DEVICE_PATH_BYTES: usize = 4096;

#[derive(Debug, Error)]
pub enum SerialError {
    #[error("serial device and baud rate are required")]
    InvalidOptions,
    #[error("serial device could not be found")]
    DeviceNotFound,
    #[error("serial device permission was denied")]
    PermissionDenied,
    #[error("serial device could not be opened")]
    OpenFailed,
    #[error("serial device disconnected during {operation}")]
    DeviceDisconnected { operation: &'static str },
    #[error("serial I/O failed during {operation}")]
    Io { operation: &'static str },
    #[error("serial operation timed out")]
    Timeout,
    #[error("serial connection is closed")]
    Closed,
    #[error("serial connection was cancelled")]
    Cancelled,
    #[error("serial devices could not be enumerated")]
    Enumeration,
    #[error("serial lifecycle error")]
    Lifecycle,
    #[error("serial worker failed")]
    Worker,
}

impl SerialError {
    fn is_device_loss(&self) -> bool {
        matches!(self, Self::DeviceDisconnected { .. })
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SerialDataBits {
    Five,
    Six,
    Seven,
    #[default]
    Eight,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SerialStopBits {
    #[default]
    One,
    Two,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SerialParity {
    #[default]
    None,
    Odd,
    Even,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SerialFlowControl {
    #[default]
    None,
    Software,
    Hardware,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LineEnding {
    None,
    #[default]
    CrLf,
    Cr,
    Lf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialDeviceInfo {
    pub device: String,
    pub kind: String,
}

/// Enumerates port metadata without opening a device. Callers should invoke
/// this explicitly from a user-visible refresh action; the transport never
/// performs enumeration implicitly.
pub fn enumerate_devices() -> Result<Vec<SerialDeviceInfo>, SerialError> {
    serialport::available_ports()
        .map(|ports| {
            ports
                .into_iter()
                .map(|port| SerialDeviceInfo {
                    device: port.port_name,
                    kind: match port.port_type {
                        serialport::SerialPortType::UsbPort(_) => "USB",
                        serialport::SerialPortType::PciPort => "PCI",
                        serialport::SerialPortType::BluetoothPort => "Bluetooth",
                        serialport::SerialPortType::Unknown => "Unknown",
                    }
                    .to_owned(),
                })
                .collect()
        })
        .map_err(|_| SerialError::Enumeration)
}

impl LineEnding {
    pub fn suffix(self) -> &'static [u8] {
        match self {
            Self::None => b"",
            Self::CrLf => b"\r\n",
            Self::Cr => b"\r",
            Self::Lf => b"\n",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialOptions {
    pub device: String,
    pub baud_rate: u32,
    #[serde(default)]
    pub data_bits: SerialDataBits,
    #[serde(default)]
    pub stop_bits: SerialStopBits,
    #[serde(default)]
    pub parity: SerialParity,
    #[serde(default)]
    pub flow_control: SerialFlowControl,
    #[serde(default)]
    pub line_ending: LineEnding,
    #[serde(default = "default_io_timeout")]
    pub io_timeout: Duration,
    #[serde(default = "default_open_timeout")]
    pub open_timeout: Duration,
}

impl SerialOptions {
    pub fn new(device: impl Into<String>, baud_rate: u32) -> Self {
        Self {
            device: device.into(),
            baud_rate,
            data_bits: SerialDataBits::default(),
            stop_bits: SerialStopBits::default(),
            parity: SerialParity::default(),
            flow_control: SerialFlowControl::default(),
            line_ending: LineEnding::default(),
            io_timeout: default_io_timeout(),
            open_timeout: default_open_timeout(),
        }
    }

    pub fn validate(&self) -> Result<(), SerialError> {
        if self.device.len() > MAX_DEVICE_PATH_BYTES
            || self.device.trim().is_empty()
            || self.device.contains('\0')
            || Path::new(&self.device)
                .to_str()
                .is_some_and(|path| path.chars().any(char::is_control))
            || self.baud_rate == 0
            || self.io_timeout.is_zero()
            || self.open_timeout.is_zero()
        {
            return Err(SerialError::InvalidOptions);
        }
        Ok(())
    }

    pub fn frame_text(&self, text: &str) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(text.len() + self.line_ending.suffix().len());
        bytes.extend_from_slice(text.as_bytes());
        bytes.extend_from_slice(self.line_ending.suffix());
        bytes
    }

    /// Frames isolated Enter and Backspace keys for device consoles.
    /// Other input remains byte-for-byte unchanged so pasted text and control
    /// sequences are not unexpectedly rewritten.
    pub fn frame_terminal_input(&self, input: &[u8]) -> Vec<u8> {
        if matches!(input, b"\r" | b"\n") {
            self.line_ending.suffix().to_vec()
        } else if input == b"\x7f" {
            // xterm emits DEL for Backspace; network-device consoles use BS.
            b"\x08".to_vec()
        } else {
            input.to_vec()
        }
    }
}

impl Default for SerialOptions {
    fn default() -> Self {
        Self::new("", 115_200)
    }
}

fn default_io_timeout() -> Duration {
    Duration::from_millis(250)
}

fn default_open_timeout() -> Duration {
    Duration::from_secs(5)
}

type PortHandle = Arc<Mutex<Option<Box<dyn serialport::SerialPort>>>>;

type PendingRead =
    tokio::sync::Mutex<Option<tokio::task::JoinHandle<Result<Vec<u8>, SerialError>>>>;

// select! may drop the caller when keyboard input wins. Keep the blocking
// worker owned by the connection so the next read receives its bytes, rather
// than starting another worker and silently discarding the previous result.
async fn read_from_worker(
    pending: &PendingRead,
    timeout: Duration,
    read: impl FnOnce() -> Result<Vec<u8>, SerialError> + Send + 'static,
) -> Result<Vec<u8>, SerialError> {
    let mut pending = pending.lock().await;
    let worker = pending.get_or_insert_with(|| tokio::task::spawn_blocking(read));
    let result = tokio::time::timeout(timeout, worker).await;
    match result {
        Ok(result) => {
            pending.take();
            result.map_err(|_| SerialError::Worker)?
        }
        Err(_) => Err(SerialError::Timeout),
    }
}

/// A native serial connection. All blocking driver calls run outside the
/// async executor and are bounded by the driver's configured I/O timeout.
pub struct SerialConnection {
    options: SerialOptions,
    port: PortHandle,
    pending_read: PendingRead,
    lifecycle: Mutex<ConnectionLifecycle>,
}

impl std::fmt::Debug for SerialConnection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SerialConnection")
            .field("device", &self.options.device)
            .field("baud_rate", &self.options.baud_rate)
            .field("state", &self.state())
            .finish()
    }
}

impl SerialConnection {
    fn lock_lifecycle(&self) -> MutexGuard<'_, ConnectionLifecycle> {
        // Lifecycle stores only state and revision, so poison leaves a usable value.
        self.lifecycle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub async fn connect(options: SerialOptions) -> Result<Self, SerialError> {
        options.validate()?;
        let open_options = options.clone();
        let worker = tokio::task::spawn_blocking(move || open_port(&open_options));
        let port = tokio::time::timeout(options.open_timeout, worker)
            .await
            .map_err(|_| SerialError::Timeout)?
            .map_err(|_| SerialError::Worker)??;

        Self::from_open_port(options, port)
    }

    /// Adopt an already-open native serial port.
    ///
    /// This keeps the lifecycle and I/O path testable with a caller-owned
    /// pseudo-terminal pair without weakening the normal device-explicit
    /// [`Self::connect`] path.
    pub fn from_open_port(
        options: SerialOptions,
        port: Box<dyn serialport::SerialPort>,
    ) -> Result<Self, SerialError> {
        options.validate()?;
        let mut lifecycle = ConnectionLifecycle::new();
        lifecycle
            .apply(ConnectionEvent::BeginConnect)
            .map_err(|_| SerialError::Lifecycle)?;
        lifecycle
            .apply(ConnectionEvent::BeginAuthentication)
            .map_err(|_| SerialError::Lifecycle)?;
        lifecycle
            .apply(ConnectionEvent::AuthenticationSucceeded)
            .map_err(|_| SerialError::Lifecycle)?;

        Ok(Self {
            options,
            port: Arc::new(Mutex::new(Some(port))),
            pending_read: PendingRead::default(),
            lifecycle: Mutex::new(lifecycle),
        })
    }

    pub fn state(&self) -> ConnectionState {
        self.lock_lifecycle().state()
    }

    pub fn options(&self) -> &SerialOptions {
        &self.options
    }

    pub async fn read(&self, maximum: usize) -> Result<Vec<u8>, SerialError> {
        if self.state() != ConnectionState::Connected {
            return Err(SerialError::Closed);
        }
        let maximum = maximum.clamp(1, MAX_READ_BYTES);
        let port = Arc::clone(&self.port);
        let result = read_from_worker(
            &self.pending_read,
            self.options.io_timeout.saturating_mul(2),
            move || {
                let mut guard = port.lock().map_err(|_| SerialError::Worker)?;
                let Some(port) = guard.as_mut() else {
                    return Err(SerialError::Closed);
                };
                let mut buffer = vec![0_u8; maximum];
                match std::io::Read::read(&mut **port, &mut buffer) {
                    Ok(read) => {
                        buffer.truncate(read);
                        Ok(buffer)
                    }
                    Err(error) => classify_read_error(error),
                }
            },
        )
        .await;
        if let Err(error) = &result
            && error.is_device_loss()
        {
            self.mark_lost();
        }
        result
    }

    pub async fn write(&self, bytes: &[u8]) -> Result<usize, SerialError> {
        if self.state() != ConnectionState::Connected {
            return Err(SerialError::Closed);
        }
        let bytes = bytes.to_vec();
        let length = bytes.len();
        let port = Arc::clone(&self.port);
        let operation = tokio::task::spawn_blocking(move || {
            let mut guard = port.lock().map_err(|_| SerialError::Worker)?;
            let Some(port) = guard.as_mut() else {
                return Err(SerialError::Closed);
            };
            std::io::Write::write_all(&mut **port, &bytes)
                .map(|()| length)
                .map_err(|error| classify_io_error("write", error))
        });
        let result = tokio::time::timeout(self.options.io_timeout.saturating_mul(2), operation)
            .await
            .map_err(|_| SerialError::Timeout)?
            .map_err(|_| SerialError::Worker)?;
        if let Err(error) = &result
            && error.is_device_loss()
        {
            self.mark_lost();
        }
        result
    }

    pub async fn write_text(&self, text: &str) -> Result<usize, SerialError> {
        self.write(&self.options.frame_text(text)).await
    }

    pub async fn reconnect(&self) -> Result<(), SerialError> {
        self.lock_lifecycle()
            .apply(ConnectionEvent::BeginReconnect)
            .map_err(|_| SerialError::Lifecycle)?;
        // Finish the old port's reader before replacing its handle. Never let
        // an outstanding worker consume bytes from the reconnected device.
        if let Some(worker) = self.pending_read.lock().await.take() {
            let _ = worker.await;
        }
        self.take_port()?;
        let options = self.options.clone();
        let open_options = options.clone();
        let worker = tokio::task::spawn_blocking(move || open_port(&open_options));
        let new_port = match tokio::time::timeout(options.open_timeout, worker).await {
            Err(_) => {
                self.mark_failed();
                return Err(SerialError::Timeout);
            }
            Ok(Err(_error)) => {
                self.mark_failed();
                return Err(SerialError::Worker);
            }
            Ok(Ok(Err(error))) => {
                self.mark_failed();
                return Err(error);
            }
            Ok(Ok(Ok(port))) => port,
        };
        *self.port.lock().map_err(|_| SerialError::Worker)? = Some(new_port);
        let mut lifecycle = self.lock_lifecycle();
        lifecycle
            .apply(ConnectionEvent::BeginAuthentication)
            .map_err(|_| SerialError::Lifecycle)?;
        lifecycle
            .apply(ConnectionEvent::AuthenticationSucceeded)
            .map_err(|_| SerialError::Lifecycle)?;
        Ok(())
    }

    pub fn mark_lost(&self) {
        let _ = self.lock_lifecycle().apply(ConnectionEvent::ConnectionLost);
    }

    fn mark_failed(&self) {
        let _ = self.lock_lifecycle().apply(ConnectionEvent::Fail);
    }

    pub async fn cancel(&self) -> Result<(), SerialError> {
        let mut lifecycle = self.lock_lifecycle();
        if matches!(
            lifecycle.state(),
            ConnectionState::Connected
                | ConnectionState::Reconnecting
                | ConnectionState::Connecting
                | ConnectionState::Authenticating
        ) {
            lifecycle
                .apply(ConnectionEvent::Cancel)
                .map_err(|_| SerialError::Lifecycle)?;
        }
        drop(lifecycle);
        self.take_port()?;
        Ok(())
    }

    pub async fn close(&self) -> Result<(), SerialError> {
        let mut lifecycle = self.lock_lifecycle();
        if matches!(
            lifecycle.state(),
            ConnectionState::Connected
                | ConnectionState::Reconnecting
                | ConnectionState::Connecting
                | ConnectionState::Authenticating
        ) {
            lifecycle
                .apply(ConnectionEvent::DisconnectRequested)
                .map_err(|_| SerialError::Lifecycle)?;
        }
        drop(lifecycle);
        self.take_port()?;
        let mut lifecycle = self.lock_lifecycle();
        if lifecycle.state() == ConnectionState::Disconnecting {
            lifecycle
                .apply(ConnectionEvent::Disconnected)
                .map_err(|_| SerialError::Lifecycle)?;
        }
        Ok(())
    }

    fn take_port(&self) -> Result<(), SerialError> {
        self.port.lock().map_err(|_| SerialError::Worker)?.take();
        Ok(())
    }
}

fn open_port(options: &SerialOptions) -> Result<Box<dyn serialport::SerialPort>, SerialError> {
    let builder = serialport::new(&options.device, options.baud_rate)
        .data_bits(options.data_bits.into())
        .stop_bits(options.stop_bits.into())
        .parity(options.parity.into())
        .flow_control(options.flow_control.into())
        .timeout(options.io_timeout);
    builder.open().map_err(map_open_error)
}

fn map_open_error(error: serialport::Error) -> SerialError {
    match error.kind() {
        serialport::ErrorKind::NoDevice | serialport::ErrorKind::Io(io::ErrorKind::NotFound) => {
            SerialError::DeviceNotFound
        }
        serialport::ErrorKind::Io(io::ErrorKind::PermissionDenied) => SerialError::PermissionDenied,
        serialport::ErrorKind::InvalidInput => SerialError::InvalidOptions,
        serialport::ErrorKind::Unknown | serialport::ErrorKind::Io(_) => SerialError::OpenFailed,
    }
}

fn classify_io_error(operation: &'static str, error: io::Error) -> SerialError {
    #[cfg(unix)]
    if error.raw_os_error() == Some(libc::EIO) {
        return SerialError::DeviceDisconnected { operation };
    }
    if matches!(
        error.kind(),
        io::ErrorKind::NotConnected
            | io::ErrorKind::UnexpectedEof
            | io::ErrorKind::BrokenPipe
            | io::ErrorKind::NotFound
    ) {
        SerialError::DeviceDisconnected { operation }
    } else {
        SerialError::Io { operation }
    }
}

fn classify_read_error(error: io::Error) -> Result<Vec<u8>, SerialError> {
    if matches!(
        error.kind(),
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
    ) {
        Ok(Vec::new())
    } else {
        Err(classify_io_error("read", error))
    }
}

impl From<SerialDataBits> for serialport::DataBits {
    fn from(value: SerialDataBits) -> Self {
        match value {
            SerialDataBits::Five => Self::Five,
            SerialDataBits::Six => Self::Six,
            SerialDataBits::Seven => Self::Seven,
            SerialDataBits::Eight => Self::Eight,
        }
    }
}

impl From<SerialStopBits> for serialport::StopBits {
    fn from(value: SerialStopBits) -> Self {
        match value {
            SerialStopBits::One => Self::One,
            SerialStopBits::Two => Self::Two,
        }
    }
}

impl From<SerialParity> for serialport::Parity {
    fn from(value: SerialParity) -> Self {
        match value {
            SerialParity::None => Self::None,
            SerialParity::Odd => Self::Odd,
            SerialParity::Even => Self::Even,
        }
    }
}

impl From<SerialFlowControl> for serialport::FlowControl {
    fn from(value: SerialFlowControl) -> Self {
        match value {
            SerialFlowControl::None => Self::None,
            SerialFlowControl::Software => Self::Software,
            SerialFlowControl::Hardware => Self::Hardware,
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn serial_tab_reaches_device_unchanged_for_cli_completion() {
        let options = super::SerialOptions::new("fixture", 9600);
        assert_eq!(options.frame_terminal_input(b"\t"), b"\x09");
        assert_eq!(options.frame_terminal_input(b"\x1b[Z"), b"\x1b[Z");
        assert_eq!(options.frame_terminal_input(b"show\t"), b"show\t");
    }

    #[test]
    fn serial_backspace_uses_bs_without_rewriting_delete_or_pasted_text() {
        let options = super::SerialOptions::new("fixture", 9600);
        assert_eq!(options.frame_terminal_input(b"\x7f"), b"\x08");
        for bytes in [b"\x08".as_slice(), b"\x1b[3~", b"command\x7ftext", b"\x03"] {
            assert_eq!(options.frame_terminal_input(bytes), bytes);
        }
    }
    #[tokio::test]
    async fn serial_read_survives_repeated_keyboard_select_cancellation() {
        let pending = super::PendingRead::default();
        let mut received = Vec::new();
        let mut expected = Vec::new();
        for index in 0..64 {
            let bytes =
                format!("interface Ethernet{index}\r\n description fixture ☃\r\n").into_bytes();
            expected.extend_from_slice(&bytes);
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            {
                let read = super::read_from_worker(&pending, Duration::from_secs(3), move || {
                    started_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
                    Ok(bytes)
                });
                tokio::pin!(read);
                tokio::select! {
                    result = &mut read => panic!("read completed before keyboard interrupt: {result:?}"),
                    started = tokio::time::timeout(Duration::from_secs(3), started_rx) => { started.unwrap().unwrap(); }
                }
                // The manager drops this future when a keyboard command wins.
            }
            assert!(pending.lock().await.is_some());
            release_tx.send(()).unwrap();
            received.extend(
                super::read_from_worker(&pending, Duration::from_secs(3), || {
                    panic!("a replacement read must not consume another chunk")
                })
                .await
                .unwrap(),
            );
            assert!(pending.lock().await.is_none());
        }
        assert_eq!(
            received, expected,
            "every configuration byte must arrive once and in order"
        );
    }

    #[tokio::test]
    async fn serial_read_timeout_preserves_worker_and_completed_errors_allow_retry() {
        let pending = super::PendingRead::default();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let result = super::read_from_worker(&pending, Duration::from_millis(20), move || {
            release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            Ok(b"Configuration written\r\nOLT#".to_vec())
        })
        .await;
        assert!(matches!(result, Err(super::SerialError::Timeout)));
        release_tx.send(()).unwrap();
        let bytes = super::read_from_worker(&pending, Duration::from_secs(3), || {
            panic!("worker already exists")
        })
        .await
        .unwrap();
        assert_eq!(bytes, b"Configuration written\r\nOLT#");
        assert!(matches!(
            super::read_from_worker(&pending, Duration::from_secs(3), || Err(
                super::SerialError::Io { operation: "read" }
            ))
            .await,
            Err(super::SerialError::Io { .. })
        ));
        assert!(pending.lock().await.is_none());
        assert_eq!(
            super::read_from_worker(&pending, Duration::from_secs(3), || Ok(b"retry".to_vec()))
                .await
                .unwrap(),
            b"retry"
        );
    }

    use super::*;

    #[test]
    fn options_cover_serial_parameters_without_opening_a_device() {
        let mut options = SerialOptions::new("/temporary/fixture-device", 115_200);
        options.data_bits = SerialDataBits::Seven;
        options.stop_bits = SerialStopBits::Two;
        options.parity = SerialParity::Even;
        options.flow_control = SerialFlowControl::Hardware;
        options.line_ending = LineEnding::Lf;
        assert!(options.validate().is_ok());
        assert_eq!(options.frame_text("status"), b"status\n");
        assert_eq!(options.frame_terminal_input(b"\r"), b"\n");
        assert_eq!(options.frame_terminal_input(b"status"), b"status");
    }

    #[test]
    fn invalid_device_options_are_rejected_before_any_open_attempt() {
        let mut options = SerialOptions::new("/temporary/fixture-device", 115_200);
        options.device = "bad\npath".into();
        assert!(matches!(
            options.validate(),
            Err(SerialError::InvalidOptions)
        ));
        options.device = "/temporary/fixture-device".into();
        options.baud_rate = 0;
        assert!(matches!(
            options.validate(),
            Err(SerialError::InvalidOptions)
        ));
    }

    #[test]
    fn oversized_device_path_is_rejected_during_validation() {
        let options = SerialOptions::new("d".repeat(MAX_DEVICE_PATH_BYTES + 1), 115_200);
        assert!(matches!(
            options.validate(),
            Err(SerialError::InvalidOptions)
        ));
    }

    #[test]
    fn device_loss_is_a_distinct_recoverable_error() {
        let error = classify_io_error("read", io::Error::from(io::ErrorKind::NotConnected));
        assert!(matches!(
            error,
            SerialError::DeviceDisconnected {
                operation: "read",
                ..
            }
        ));
    }

    #[test]
    fn read_timeouts_are_idle_reads_not_session_failures() {
        for kind in [io::ErrorKind::TimedOut, io::ErrorKind::WouldBlock] {
            assert!(
                classify_read_error(io::Error::from(kind))
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[test]
    fn open_errors_are_typed_without_device_path_or_driver_text() {
        let missing = map_open_error(serialport::Error::new(
            serialport::ErrorKind::NoDevice,
            "/private/device/path disappeared",
        ));
        assert_eq!(missing.to_string(), "serial device could not be found");
        assert!(!missing.to_string().contains("/private/device/path"));

        let denied = map_open_error(serialport::Error::new(
            serialport::ErrorKind::Io(io::ErrorKind::PermissionDenied),
            "permission details",
        ));
        assert_eq!(denied.to_string(), "serial device permission was denied");
    }

    #[test]
    fn lifecycle_can_cancel_a_serial_connection_without_hardware() {
        let mut lifecycle = ConnectionLifecycle::new();
        lifecycle.apply(ConnectionEvent::BeginConnect).unwrap();
        lifecycle
            .apply(ConnectionEvent::BeginAuthentication)
            .unwrap();
        lifecycle
            .apply(ConnectionEvent::AuthenticationSucceeded)
            .unwrap();
        lifecycle.apply(ConnectionEvent::Cancel).unwrap();
        assert_eq!(lifecycle.state(), ConnectionState::Cancelled);
    }

    #[cfg(unix)]
    #[test]
    fn poisoned_lifecycle_lock_keeps_state_and_close_available() {
        use serialport::{SerialPort, TTYPort};

        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let (_master, device) = TTYPort::pair().unwrap();
            let options = SerialOptions::new(device.name().unwrap(), 115_200);
            let connection = SerialConnection::from_open_port(options, Box::new(device)).unwrap();

            let poison = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _lifecycle = connection.lifecycle.lock().unwrap();
                std::panic::resume_unwind(Box::new("poison lifecycle lock"));
            }));
            assert!(poison.is_err());
            assert_eq!(connection.state(), ConnectionState::Connected);

            connection.close().await.unwrap();
            assert_eq!(connection.state(), ConnectionState::Disconnected);
        });
    }
}
