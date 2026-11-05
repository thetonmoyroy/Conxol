//! Bounded SSH troubleshooting data. Never records requests, hosts, credentials,
//! keyboard-interactive prompts, terminal bytes, or arbitrary error strings.
use crate::SshError;
use serde::Serialize;
use std::{
    collections::VecDeque,
    future::Future,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
const MAX_FAILURES: usize = 64;
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    HostKeyInspection,
    Connect,
    Reconnect,
    Unscoped,
}
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Network,
    RequestValidation,
    CredentialLookup,
    Handshake,
    Authentication,
    Shell,
    Connect,
}
#[derive(Clone)]
struct Context {
    attempt_id: String,
    operation: Operation,
    timeout_ms: u64,
    jump_hops: usize,
}
tokio::task_local! { static CONTEXT: Context; }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    timestamp_unix_ms: u64,
    attempt_id: String,
    operation: Operation,
    stage: Stage,
    timeout_ms: u64,
    jump_hops: usize,
    raw_error: String,
    error_chain: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    authentication: Option<AuthenticationFailure>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticationFailure {
    attempted_method: &'static str,
    remaining_methods: Vec<String>,
    partial_success: bool,
}
#[derive(Default)]
struct History(VecDeque<Failure>);
impl History {
    fn push(&mut self, event: Failure) {
        if self.0.len() == MAX_FAILURES {
            self.0.pop_front();
        }
        self.0.push_back(event);
    }
    fn snapshot(&self) -> Vec<Failure> {
        self.0.iter().cloned().collect()
    }
}
fn history() -> &'static Mutex<History> {
    static HISTORY: OnceLock<Mutex<History>> = OnceLock::new();
    HISTORY.get_or_init(|| Mutex::new(History::default()))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    capture: &'static str,
    maximum_failures: usize,
    failures: Vec<Failure>,
}
pub fn snapshot() -> Snapshot {
    Snapshot {
        capture: "in-memory failures since this app launch",
        maximum_failures: MAX_FAILURES,
        failures: history()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .snapshot(),
    }
}
pub async fn scope<T>(
    operation: Operation,
    timeout_ms: u64,
    jump_hops: usize,
    work: impl Future<Output = T>,
) -> T {
    CONTEXT
        .scope(
            Context {
                attempt_id: uuid::Uuid::new_v4().to_string(),
                operation,
                timeout_ms,
                jump_hops,
            },
            work,
        )
        .await
}
fn event(stage: Stage, chain: Vec<String>) -> Failure {
    let context = CONTEXT.try_with(Clone::clone).unwrap_or_else(|_| Context {
        attempt_id: uuid::Uuid::new_v4().to_string(),
        operation: Operation::Unscoped,
        timeout_ms: 0,
        jump_hops: 0,
    });
    Failure {
        timestamp_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u64::MAX as u128) as u64,
        attempt_id: context.attempt_id,
        operation: context.operation,
        stage,
        timeout_ms: context.timeout_ms,
        jump_hops: context.jump_hops,
        raw_error: chain.first().cloned().unwrap_or_default(),
        error_chain: chain,
        authentication: None,
    }
}
fn record(stage: Stage, chain: Vec<String>) {
    let chain = chain
        .into_iter()
        .take(8)
        .map(|text| {
            if text.len() <= 8192 {
                text
            } else {
                let mut end = 8192;
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                format!("{}<truncated>", &text[..end])
            }
        })
        .collect();
    history()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(event(stage, chain));
}
fn io_raw(error: &std::io::Error) -> String {
    // Retain the actual OS code and its standard message, not custom payloads
    // which can contain local paths, endpoint addresses, or secrets.
    match error.raw_os_error() {
        Some(code) => format!(
            "std::io::Error {{ kind: {:?}, osCode: {code}, message: {:?} }}",
            error.kind(),
            std::io::Error::from_raw_os_error(code).to_string()
        ),
        None => format!(
            "std::io::Error {{ kind: {:?}, customMessage: <redacted> }}",
            error.kind()
        ),
    }
}
fn algorithm_names(names: &[String]) -> Vec<String> {
    names
        .iter()
        .take(32)
        .map(|name| {
            if !name.is_empty()
                && name.len() <= 96
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-_.@+".contains(&byte))
            {
                name.clone()
            } else {
                "<invalid-or-oversized-algorithm>".into()
            }
        })
        .collect()
}
fn russh_raw(error: &russh::Error) -> String {
    use russh::Error as E;
    match error {
        E::IO(error) => format!("russh::Error::IO({})", io_raw(error)),
        E::NoCommonAlgo { kind, ours, theirs } => format!(
            "russh::Error::NoCommonAlgo {{ kind: {kind:?}, ours: {:?}, theirs: {:?} }}",
            algorithm_names(ours),
            algorithm_names(theirs)
        ),
        // These library variants contain no untrusted strings or key bytes.
        E::CouldNotReadKey
        | E::KexInit
        | E::UnknownAlgo
        | E::Version
        | E::Kex
        | E::PacketAuth
        | E::Inconsistent
        | E::NotAuthenticated
        | E::UnsupportedAuthMethod
        | E::IndexOutOfBounds
        | E::UnknownKey
        | E::WrongServerSig
        | E::PacketSize(_)
        | E::WrongChannel
        | E::ChannelOpenFailure(_)
        | E::Disconnect
        | E::NoHomeDir
        | E::KeyChanged { .. }
        | E::HUP
        | E::ConnectionTimeout
        | E::KeepaliveTimeout
        | E::InactivityTimeout
        | E::NoAuthMethod
        | E::SendError
        | E::Pending
        | E::DecryptionError
        | E::RequestDenied
        | E::StrictKeyExchangeViolation { .. }
        | E::RecvError => format!("russh::Error::{error:?}"),
        E::Keys(_) => "russh::Error::Keys(<key details redacted>)".into(),
        E::SshKey(_) => "russh::Error::SshKey(<key details redacted>)".into(),
        E::Signature(_) => "russh::Error::Signature".into(),
        E::SshEncoding(_) => "russh::Error::SshEncoding".into(),
        E::Utf8(error) => format!(
            "russh::Error::Utf8 {{ validUpTo: {}, errorLength: {:?} }}",
            error.valid_up_to(),
            error.error_len()
        ),
        E::InvalidConfig(_) => "russh::Error::InvalidConfig(<config text redacted>)".into(),
        _ => "russh::Error::<internal error details redacted>".into(),
    }
}
fn ssh_raw(error: &SshError) -> String {
    match error {
        SshError::Transport(inner) | SshError::Channel(inner) => russh_raw(inner),
        SshError::LocalIo(inner) => io_raw(inner),
        SshError::AuthenticationRejected => "SshError::AuthenticationRejected".into(),
        SshError::AuthenticationCancelled => "SshError::AuthenticationCancelled".into(),
        SshError::AgentUnavailable => "SshError::AgentUnavailable".into(),
        SshError::AgentEmpty => "SshError::AgentEmpty".into(),
        SshError::Agent(_) => "SshError::Agent(<agent details redacted>)".into(),
        SshError::PrivateKey(_) => "SshError::PrivateKey(<key details redacted>)".into(),
        SshError::KnownHosts(_) => "SshError::KnownHosts(<trust file details redacted>)".into(),
        SshError::UnsupportedKeyAlgorithm(_) => {
            "SshError::UnsupportedKeyAlgorithm(<key details redacted>)".into()
        }
        SshError::HostKeyRejected { .. } => "SshError::HostKeyRejected".into(),
        SshError::Negotiation(kind) => format!("SshError::Negotiation({kind:?})"),
        SshError::Timeout => "SshError::Timeout".into(),
        SshError::HandshakeClosed => "SshError::HandshakeClosed".into(),
        SshError::ConnectionRefused => "SshError::ConnectionRefused".into(),
        SshError::DnsFailure => "SshError::DnsFailure".into(),
        SshError::HostUnreachable => "SshError::HostUnreachable".into(),
        SshError::ConnectionFailed => "SshError::ConnectionFailed".into(),
        SshError::HostSignature => "SshError::HostSignature".into(),
        SshError::ProtocolVersion => "SshError::ProtocolVersion".into(),
        SshError::KeyExchange => "SshError::KeyExchange".into(),
        SshError::HandshakePacket => "SshError::HandshakePacket".into(),
        SshError::StrictKeyExchange => "SshError::StrictKeyExchange".into(),
        SshError::HostKeyEncoding => "SshError::HostKeyEncoding".into(),
        SshError::ChannelRequestRejected { request } => {
            format!("SshError::ChannelRequestRejected {{ request: {request:?} }}")
        }
        SshError::ChannelRequestClosed { request } => {
            format!("SshError::ChannelRequestClosed {{ request: {request:?} }}")
        }
        SshError::KeyboardInteractiveEchoPrompt => "SshError::KeyboardInteractiveEchoPrompt".into(),
        SshError::KeyboardInteractiveTooManyPrompts => {
            "SshError::KeyboardInteractiveTooManyPrompts".into()
        }
        SshError::KeyboardInteractiveChallengeLimit => {
            "SshError::KeyboardInteractiveChallengeLimit".into()
        }
        SshError::KeyboardInteractiveInvalidResponses => {
            "SshError::KeyboardInteractiveInvalidResponses".into()
        }
        SshError::InvalidOptions => "SshError::InvalidOptions".into(),
        SshError::TooManyJumpHosts => "SshError::TooManyJumpHosts".into(),
        _ => "SshError::<additional details redacted>".into(),
    }
}
pub fn record_auth_failure(method: &'static str, result: &russh::client::AuthResult) {
    let russh::client::AuthResult::Failure {
        remaining_methods,
        partial_success,
    } = result
    else {
        return;
    };
    let methods: Vec<String> = remaining_methods.iter().map(String::from).collect();
    let mut failure = event(
        Stage::Authentication,
        vec![format!(
            "russh::AuthResult::Failure {{ attemptedMethod: {method:?}, remainingMethods: {methods:?}, partialSuccess: {partial_success} }}"
        )],
    );
    failure.authentication = Some(AuthenticationFailure {
        attempted_method: method,
        remaining_methods: methods,
        partial_success: *partial_success,
    });
    history()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(failure);
}
pub fn record_error(stage: Stage, error: &SshError) {
    if matches!(stage, Stage::Connect)
        && CONTEXT
            .try_with(|context| {
                history()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .0
                    .iter()
                    .any(|failure| failure.attempt_id == context.attempt_id)
            })
            .unwrap_or(false)
    {
        return;
    }
    if matches!(error, SshError::AuthenticationCancelled) {
        return;
    }
    record(stage, vec![ssh_raw(error)]);
}
pub fn record_request_failure(stage: Stage) {
    record(
        stage,
        vec!["SshManagerError::InvalidRequest(<request details redacted>)".into()],
    );
}
pub fn record_vault_failure(error_kind: &'static str) {
    record(Stage::CredentialLookup, vec![error_kind.to_owned()]);
}

pub(crate) fn record_handshake(error: &anyhow::Error) {
    if error
        .downcast_ref::<SshError>()
        .is_some_and(|error| matches!(error, SshError::AuthenticationCancelled))
    {
        return;
    }
    let stage = if error.chain().any(|cause| {
        cause.downcast_ref::<std::io::Error>().is_some()
            || matches!(
                cause.downcast_ref::<russh::Error>(),
                Some(russh::Error::IO(_))
            )
    }) {
        Stage::Network
    } else {
        Stage::Handshake
    };
    record(stage, raw_chain(error));
}
fn raw_chain(error: &anyhow::Error) -> Vec<String> {
    error
        .chain()
        .take(8)
        .map(|cause| {
            if let Some(error) = cause.downcast_ref::<russh::Error>() {
                russh_raw(error)
            } else if let Some(error) = cause.downcast_ref::<std::io::Error>() {
                io_raw(error)
            } else if let Some(error) = cause.downcast_ref::<SshError>() {
                ssh_raw(error)
            } else {
                "<unclassified error context redacted>".into()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostic_errors_keep_library_variants_and_os_codes_without_payloads() {
        let custom = std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "password=fixture-secret at C:/private/key for personal-host",
        );
        let output = io_raw(&custom);
        assert!(output.contains("ConnectionReset"));
        for forbidden in ["fixture-secret", "C:/private", "personal-host"] {
            assert!(!output.contains(forbidden));
        }
        assert!(io_raw(&std::io::Error::from_raw_os_error(10054)).contains("10054"));
        assert_eq!(russh_raw(&russh::Error::HUP), "russh::Error::HUP");
        assert_eq!(russh_raw(&russh::Error::KexInit), "russh::Error::KexInit");
        assert!(
            russh_raw(&russh::Error::StrictKeyExchangeViolation {
                message_type: 255,
                sequence_number: 42
            })
            .contains("42")
        );
        let output = russh_raw(&russh::Error::InvalidConfig("fixture-secret".into()));
        assert!(!output.contains("fixture-secret"));
        let output = russh_raw(&russh::Error::Keys(
            russh::keys::Error::UnsupportedKeyType {
                key_type_string: "fixture-secret".into(),
                key_type_raw: b"fixture-private-key".to_vec(),
            },
        ));
        assert!(output.contains("Keys"));
        assert!(!output.contains("fixture-secret"));
        assert!(!output.contains("fixture-private-key"));
    }
    #[test]
    fn negotiation_errors_preserve_legacy_server_algorithms_and_filter_untrusted_text() {
        let output = russh_raw(&russh::Error::NoCommonAlgo {
            kind: russh::AlgorithmKind::Kex,
            ours: vec!["curve25519-sha256".into()],
            theirs: vec![
                "diffie-hellman-group1-sha1".into(),
                "password=fixture-secret".into(),
                "\u{1b}[31m".into(),
                "x".repeat(10000),
            ],
        });
        assert!(output.contains("NoCommonAlgo"));
        assert!(output.contains("curve25519-sha256"));
        assert!(output.contains("diffie-hellman-group1-sha1"));
        assert!(!output.contains("fixture-secret"));
        assert!(!output.contains('\u{1b}'));
        assert!(output.len() < 1024);
        assert_eq!(
            algorithm_names(&vec!["ssh-ed25519".into(); 10000]).len(),
            32
        );
    }
    #[test]
    fn error_chain_retains_the_typed_cause_but_omits_arbitrary_context() {
        let error = anyhow::Error::new(std::io::Error::from_raw_os_error(10054))
            .context("fixture-user fixture-password C:/private/file fixture-host");
        let chain = raw_chain(&error);
        let output = serde_json::to_string(&chain).unwrap();
        assert!(output.contains("10054"));
        assert!(chain.len() >= 2);
        for forbidden in [
            "fixture-user",
            "fixture-password",
            "C:/private/file",
            "fixture-host",
        ] {
            assert!(!output.contains(forbidden));
        }
    }
    #[test]
    fn failure_history_keeps_only_the_latest_64_events() {
        let mut history = History::default();
        for index in 0..100 {
            history.push(event(
                Stage::Handshake,
                vec![format!("fixture-error-{index}")],
            ));
        }
        let snapshot = history.snapshot();
        assert_eq!(snapshot.len(), 64);
        assert_eq!(snapshot[0].raw_error, "fixture-error-36");
        assert_eq!(snapshot[63].raw_error, "fixture-error-99");
    }
    #[tokio::test]
    async fn concurrent_attempts_have_distinct_ids_and_keep_operation_and_stage() {
        let work = |operation, timeout, hops| {
            scope(operation, timeout, hops, async {
                let first = event(Stage::Handshake, vec!["russh::Error::HUP".into()]);
                tokio::task::yield_now().await;
                let second = event(
                    Stage::Authentication,
                    vec!["SshError::AuthenticationRejected".into()],
                );
                (first, second)
            })
        };
        let (left, right) = tokio::join!(
            work(Operation::Connect, 12000, 0),
            work(Operation::HostKeyInspection, 5000, 2)
        );
        assert_eq!(left.0.attempt_id, left.1.attempt_id);
        assert_ne!(left.0.attempt_id, right.0.attempt_id);
        let value = serde_json::to_value(&right.0).unwrap();
        assert_eq!(value["operation"], "hostKeyInspection");
        assert_eq!(value["stage"], "handshake");
        assert_eq!(value["timeoutMs"], 5000);
        assert_eq!(value["jumpHops"], 2);
        assert!(value.get("host").is_none());
        assert!(value.get("username").is_none());
    }
    #[tokio::test]
    async fn auth_rejection_exports_server_methods_once_per_attempt() {
        scope(Operation::Connect, 12000, 0, async {
            let attempt = CONTEXT.with(|context| context.attempt_id.clone());
            let result = russh::client::AuthResult::Failure {
                remaining_methods: russh::MethodSet::from(
                    &[russh::MethodKind::Password, russh::MethodKind::PublicKey][..],
                ),
                partial_success: false,
            };
            record_auth_failure("password", &result);
            record_error(Stage::Connect, &SshError::AuthenticationRejected);
            let own: Vec<_> = snapshot()
                .failures
                .into_iter()
                .filter(|failure| failure.attempt_id == attempt)
                .collect();
            assert_eq!(
                own.len(),
                1,
                "do not duplicate the same rejection at connect and auth stages"
            );
            let value = serde_json::to_value(&own[0]).unwrap();
            assert_eq!(value["authentication"]["attemptedMethod"], "password");
            assert_eq!(
                value["authentication"]["remainingMethods"],
                serde_json::json!(["password", "publickey"])
            );
            assert_eq!(value["authentication"]["partialSuccess"], false);
            assert!(
                value["rawError"]
                    .as_str()
                    .unwrap()
                    .contains("AuthResult::Failure")
            );
        })
        .await;
    }

    #[test]
    fn authentication_and_agent_details_never_serialize_secret_responses() {
        for error in [
            SshError::Agent("fixture-secret".into()),
            SshError::UnsupportedKeyAlgorithm("fixture-secret".into()),
            SshError::HostKeyRejected {
                fingerprint: "fixture-private-fingerprint".into(),
            },
        ] {
            let value = serde_json::to_string(&event(Stage::Authentication, vec![ssh_raw(&error)]))
                .unwrap();
            assert!(!value.contains("fixture-secret"));
            assert!(!value.contains("fixture-private-fingerprint"));
        }
        assert_eq!(
            ssh_raw(&SshError::AuthenticationRejected),
            "SshError::AuthenticationRejected"
        );
    }
}
