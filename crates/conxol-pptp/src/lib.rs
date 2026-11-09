#[cfg(any(windows, test))]
mod auth;
pub mod control;
#[cfg(windows)]
pub mod elevation;
#[cfg(windows)]
pub mod gre;
#[cfg(windows)]
pub mod link;
#[cfg(any(windows, test))]
mod mppe;
#[cfg(windows)]
pub mod ppp;
pub mod stack;
pub mod transport;

pub mod diagnostic;
