//! Native, bounded MTR diagnostics. No external executables or shell invocation.
//! The first backend milestone supports IPv4. Call `run` on a dedicated worker:
//! it blocks, checking cancellation between probes and during interval waits.
pub use conxol_ping::{Error, Probe, Reply, ReplyKind};
use serde::Serialize;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct Options {
    pub target: Ipv4Addr,
    pub max_hops: u8,
    pub cycles: u32,
    pub timeout: Duration,
    /// Minimum duration of a complete sweep; probes are never overlapped.
    pub interval: Duration,
}

impl Options {
    pub fn new(target: Ipv4Addr) -> Self {
        Self {
            target,
            max_hops: 30,
            cycles: 5,
            timeout: Duration::from_secs(1),
            interval: Duration::from_secs(1),
        }
    }

    pub fn validate(&self) -> Result<(), Error> {
        if self.target.is_unspecified() || self.target.is_multicast() || self.target.is_broadcast()
        {
            return Err(Error::InvalidTarget);
        }
        if !(1..=32).contains(&self.max_hops)
            || !(1..=10_000).contains(&self.cycles)
            || !(Duration::from_millis(1)..=Duration::from_secs(2)).contains(&self.timeout)
            || !(Duration::from_millis(100)..=Duration::from_secs(10)).contains(&self.interval)
        {
            return Err(Error::InvalidOptions);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hop {
    pub ttl: u8,
    pub address: Option<Ipv4Addr>,
    pub sent: u64,
    pub received: u64,
    pub loss_percent: f64,
    pub last_ms: Option<f64>,
    pub average_ms: Option<f64>,
    pub best_ms: Option<f64>,
    pub worst_ms: Option<f64>,
    pub reply_kind: Option<ReplyKind>,
    #[serde(skip)]
    sum_ms: f64,
}

impl Hop {
    fn new(ttl: u8) -> Self {
        Self {
            ttl,
            address: None,
            sent: 0,
            received: 0,
            loss_percent: 0.0,
            last_ms: None,
            average_ms: None,
            best_ms: None,
            worst_ms: None,
            reply_kind: None,
            sum_ms: 0.0,
        }
    }

    fn record(&mut self, reply: Option<Reply>) {
        if let Some(reply) = reply {
            if self.address.is_some_and(|address| address != reply.address) {
                *self = Self::new(self.ttl);
            }
            self.address = Some(reply.address);
            self.reply_kind = Some(reply.kind);
            self.received += 1;
            let ms = reply.latency.as_secs_f64() * 1000.0;
            self.sum_ms += ms;
            self.last_ms = Some(ms);
            self.average_ms = Some(self.sum_ms / self.received as f64);
            self.best_ms = Some(self.best_ms.map_or(ms, |best| best.min(ms)));
            self.worst_ms = Some(self.worst_ms.map_or(ms, |worst| worst.max(ms)));
        }
        self.sent += 1;
        self.loss_percent = 100.0 * (self.sent - self.received) as f64 / self.sent as f64;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub target: Ipv4Addr,
    pub completed_cycles: u64,
    /// Whether the destination answered in the most recent sweep.
    pub reached: bool,
    pub elapsed_ms: u64,
    pub hops: Vec<Hop>,
}

/// Reports partial sweeps after every probe. Storage never exceeds 32 hop rows.
pub fn run_with<P: Probe>(
    options: &Options,
    cancel: &AtomicBool,
    probe: &mut P,
    progress: impl FnMut(&Report),
) -> Result<Report, Error> {
    run_with_mode(options, cancel, probe, progress, false)
}

fn run_with_mode<P: Probe>(
    options: &Options,
    cancel: &AtomicBool,
    probe: &mut P,
    mut progress: impl FnMut(&Report),
    live: bool,
) -> Result<Report, Error> {
    options.validate()?;
    check_cancel(cancel)?;
    let started = Instant::now();
    let mut report = Report {
        target: options.target,
        completed_cycles: 0,
        reached: false,
        elapsed_ms: 0,
        hops: Vec::new(),
    };
    loop {
        let cycle_started = Instant::now();
        report.reached = false;
        for ttl in 1..=options.max_hops {
            check_cancel(cancel)?;
            let reply = probe.probe(options.target, ttl, options.timeout, cancel)?;
            check_cancel(cancel)?;
            let terminal = reply.is_some_and(|r| {
                r.kind == ReplyKind::Unreachable
                    || (r.kind == ReplyKind::Destination && r.address == options.target)
            });
            report.reached = reply
                .is_some_and(|r| r.kind == ReplyKind::Destination && r.address == options.target);
            if report.hops.len() < usize::from(ttl) {
                report.hops.push(Hop::new(ttl));
            }
            report.hops[usize::from(ttl - 1)].record(reply);
            if terminal {
                report.hops.truncate(usize::from(ttl));
            }
            report.elapsed_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            progress(&report);
            check_cancel(cancel)?;
            if terminal {
                break;
            }
        }
        report.completed_cycles += 1;
        progress(&report);
        check_cancel(cancel)?;
        if !live && report.completed_cycles >= u64::from(options.cycles) {
            return Ok(report);
        }
        {
            while cycle_started.elapsed() < options.interval {
                check_cancel(cancel)?;
                std::thread::sleep(
                    (options.interval - cycle_started.elapsed().min(options.interval))
                        .min(Duration::from_millis(20)),
                );
            }
        }
    }
}

pub fn run(
    options: &Options,
    cancel: &AtomicBool,
    progress: impl FnMut(&Report),
) -> Result<Report, Error> {
    run_native(options, cancel, progress, false)
}

/// Probe continuously until cancellation, without resetting cumulative counters.
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
    #[cfg(any(windows, target_os = "macos", target_os = "android"))]
    {
        run_with_mode(
            options,
            cancel,
            &mut conxol_ping::Session::new(32)?,
            progress,
            live,
        )
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "android")))]
    {
        let _ = (progress, live);
        Err(Error::UnsupportedPlatform)
    }
}

fn check_cancel(cancel: &AtomicBool) -> Result<(), Error> {
    if cancel.load(Ordering::Relaxed) {
        Err(Error::Cancelled)
    } else {
        Ok(())
    }
}
