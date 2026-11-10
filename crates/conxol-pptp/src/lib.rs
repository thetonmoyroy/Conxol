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

pub mod ipsec;
