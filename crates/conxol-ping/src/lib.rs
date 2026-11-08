//! Native IPv4 ICMP transport and ping scheduler. No system commands or shells.
//! Blocking APIs belong on a worker. MTR reuses the same echo transport with TTLs.
use serde::Serialize;
use std::collections::VecDeque;
use std::io;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use thiserror::Error;

#[cfg(any(target_os = "macos", test))]
mod packet;
#[cfg(target_os = "macos")]
#[path = "platform/macos.rs"]
mod platform;
#[cfg(windows)]
#[path = "platform/windows.rs"]
mod platform;

#[derive(Debug, Error)]
pub enum Error {
    #[error("native ICMP options are outside the supported bounds")]
    InvalidOptions,
    #[error("native ICMP requires an explicit unicast IPv4 destination")]
    InvalidTarget,
    #[error("native ICMP currently supports Windows and macOS")]
    UnsupportedPlatform,
    #[error("native ICMP was cancelled")]
    Cancelled,
    #[error("native ICMP probe failed: {0}")]
    Io(#[from] io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplyKind {
    TimeExceeded,
    Destination,
    Unreachable,
}

#[derive(Debug, Clone, Copy)]
pub struct Reply {
    pub address: Ipv4Addr,
    pub latency: Duration,
    pub kind: ReplyKind,
}

/// A timeout is Ok(None); local/permission failures must be errors, never loss.
pub trait Probe {
    fn probe(
        &mut self,
        target: Ipv4Addr,
        ttl: u8,
        timeout: Duration,
        cancel: &AtomicBool,
    ) -> Result<Option<Reply>, Error>;
}

/// Owns the native ICMP resource; payload size excludes IP and ICMP headers.
pub struct Session {
    #[cfg(any(windows, target_os = "macos"))]
    inner: platform::NativeProbe,
}
impl Session {
    pub fn new(payload_size: u16) -> Result<Self, Error> {
        if payload_size > 65500 {
            return Err(Error::InvalidOptions);
        }
        #[cfg(any(windows, target_os = "macos"))]
        {
            Ok(Self {
                inner: platform::NativeProbe::new(payload_size)?,
            })
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            Err(Error::UnsupportedPlatform)
        }
    }
}
impl Probe for Session {
    fn probe(
        &mut self,
        target: Ipv4Addr,
        ttl: u8,
        timeout: Duration,
        cancel: &AtomicBool,
    ) -> Result<Option<Reply>, Error> {
        check_cancel(cancel)?;
        validate_target(target)?;
        if ttl == 0 || !(Duration::from_millis(1)..=Duration::from_secs(60)).contains(&timeout) {
            return Err(Error::InvalidOptions);
        }
        #[cfg(any(windows, target_os = "macos"))]
        {
            let result = self.inner.probe(target, ttl, timeout, cancel)?;
            check_cancel(cancel)?;
            Ok(result)
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            Err(Error::UnsupportedPlatform)
        }
    }
}

#[derive(Debug, Clone)]
pub struct Options {
    pub target: Ipv4Addr,
    pub timeout: Duration,
    pub interval: Duration,
    pub payload_size: u16,
    pub count: u32,
}
impl Options {
    pub fn new(target: Ipv4Addr) -> Self {
        Self {
            target,
            timeout: Duration::from_secs(1),
            interval: Duration::from_secs(1),
            payload_size: 32,
            count: 5,
        }
    }
    pub fn validate(&self) -> Result<(), Error> {
        validate_target(self.target)?;
        if !(Duration::from_millis(1)..=Duration::from_secs(60)).contains(&self.timeout)
            || !(Duration::from_millis(200)..=Duration::from_secs(60)).contains(&self.interval)
            || self.payload_size > 65500
            || !(1..=10000).contains(&self.count)
        {
            return Err(Error::InvalidOptions);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub target: Ipv4Addr,
    pub sent: u64,
    pub received: u64,
    pub elapsed_ms: u64,
    pub interval_ms: u64,
    pub payload_size: u16,
    pub last_ms: Option<f64>,
    pub average_ms: Option<f64>,
    pub best_ms: Option<f64>,
    pub worst_ms: Option<f64>,
    pub lines: VecDeque<String>,
}

pub fn run(
    options: &Options,
    cancel: &AtomicBool,
    progress: impl FnMut(&Report),
) -> Result<Report, Error> {
    run_native(options, cancel, progress, false)
}
pub fn run_live(
    options: &Options,
    cancel: &AtomicBool,
    progress: impl FnMut(&Report),
) -> Result<Report, Error> {
    run_native(options, cancel, progress, true)
}
fn run_native(
    options: &Options,
    cancel: &AtomicBool,
    progress: impl FnMut(&Report),
    live: bool,
) -> Result<Report, Error> {
    options.validate()?;
    check_cancel(cancel)?;
    run_with(
        options,
        cancel,
        &mut Session::new(options.payload_size)?,
        progress,
        live,
    )
}

pub fn run_with(
    options: &Options,
    cancel: &AtomicBool,
    probe: &mut impl Probe,
    mut progress: impl FnMut(&Report),
    live: bool,
) -> Result<Report, Error> {
    options.validate()?;
    check_cancel(cancel)?;
    let started = Instant::now();
    let mut sum = 0.0;
    let mut report = Report {
        target: options.target,
        sent: 0,
        received: 0,
        elapsed_ms: 0,
        interval_ms: options.interval.as_millis() as u64,
        payload_size: options.payload_size,
        last_ms: None,
        average_ms: None,
        best_ms: None,
        worst_ms: None,
        lines: VecDeque::new(),
    };
    loop {
        check_cancel(cancel)?;
        let cycle = Instant::now();
        let reply = probe.probe(options.target, 64, options.timeout, cancel)?;
        check_cancel(cancel)?;
        report.sent += 1;
        let message = match reply {
            Some(reply)
                if reply.kind == ReplyKind::Destination && reply.address == options.target =>
            {
                report.received += 1;
                let ms = reply.latency.as_secs_f64() * 1000.0;
                sum += ms;
                report.last_ms = Some(ms);
                report.average_ms = Some(sum / report.received as f64);
                report.best_ms = Some(report.best_ms.map_or(ms, |n| n.min(ms)));
                report.worst_ms = Some(report.worst_ms.map_or(ms, |n| n.max(ms)));
                format!(
                    "Reply from {}: bytes={} time={ms:.3} ms",
                    reply.address, options.payload_size
                )
            }
            Some(reply) => {
                report.last_ms = None;
                format!(
                    "Reply from {}: {}",
                    reply.address,
                    if reply.kind == ReplyKind::TimeExceeded {
                        "TTL expired"
                    } else {
                        "Destination unreachable"
                    }
                )
            }
            None => {
                report.last_ms = None;
                "Request timed out.".into()
            }
        };
        report
            .lines
            .push_back(format!("seq={}  {message}", report.sent));
        if report.lines.len() > 200 {
            report.lines.pop_front();
        }
        report.elapsed_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        progress(&report);
        check_cancel(cancel)?;
        if !live && report.sent >= u64::from(options.count) {
            return Ok(report);
        }
        while cycle.elapsed() < options.interval {
            check_cancel(cancel)?;
            std::thread::sleep(
                (options.interval - cycle.elapsed().min(options.interval))
                    .min(Duration::from_millis(20)),
            );
        }
    }
}

fn validate_target(target: Ipv4Addr) -> Result<(), Error> {
    if target.is_unspecified() || target.is_multicast() || target.is_broadcast() {
        Err(Error::InvalidTarget)
    } else {
        Ok(())
    }
}
fn check_cancel(cancel: &AtomicBool) -> Result<(), Error> {
    if cancel.load(Ordering::Relaxed) {
        Err(Error::Cancelled)
    } else {
        Ok(())
    }
}
