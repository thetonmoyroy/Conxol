#[cfg(any(windows, target_os = "linux", target_os = "macos", test))]
mod auth;
pub mod control;
#[cfg(windows)]
pub mod elevation;
#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
pub mod gre;
pub mod l2tp;
#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
pub mod link;
#[cfg(any(windows, target_os = "linux", target_os = "macos", test))]
mod mppe;
#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
pub mod ppp;
pub mod stack;
pub mod transport;

pub mod diagnostic;

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[path = "elevation_unix.rs"]
pub mod elevation;

pub const SUPPORTED: bool = cfg!(any(windows, target_os = "linux", target_os = "macos"));

/// Maximum inner IPv4 packet size for PPTP; the peer MRU can lower this.
pub const PPTP_MTU: usize = 1450;
/// MPPE header and encrypted, uncompressed PPP protocol field.
pub(crate) const MPPE_OVERHEAD: usize = 4;
pub(crate) const PPTP_MRU: usize = PPTP_MTU + MPPE_OVERHEAD;
pub const MAX_PING_PAYLOAD: usize = PPTP_MTU - 20 - 8;

pub mod ipsec;
