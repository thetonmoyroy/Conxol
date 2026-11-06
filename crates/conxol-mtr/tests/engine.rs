use conxol_mtr::{Error, Options, Probe, Reply, ReplyKind, run, run_with};
use std::collections::VecDeque;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

struct Fixture(VecDeque<Option<Reply>>);
impl Probe for Fixture {
    fn probe(
        &mut self,
        _: Ipv4Addr,
        _: u8,
        _: Duration,
        _: &AtomicBool,
    ) -> Result<Option<Reply>, Error> {
        Ok(self.0.pop_front().expect("unexpected extra probe"))
    }
}
fn reply(ip: [u8; 4], ms: u64, kind: ReplyKind) -> Option<Reply> {
    Some(Reply {
        address: ip.into(),
        latency: Duration::from_millis(ms),
        kind,
    })
}
fn options(cycles: u32) -> Options {
    let mut options = Options::new(Ipv4Addr::LOCALHOST);
    options.max_hops = 2;
    options.cycles = cycles;
    options.interval = Duration::from_millis(100);
    options
}

#[test]
fn cumulative_statistics_and_timeouts_retain_router_identity() {
    let mut fixture = Fixture(VecDeque::from([
        reply([192, 0, 2, 1], 10, ReplyKind::TimeExceeded),
        reply([127, 0, 0, 1], 2, ReplyKind::Destination),
        None,
        reply([127, 0, 0, 1], 4, ReplyKind::Destination),
    ]));
    let report = run_with(&options(2), &AtomicBool::new(false), &mut fixture, |_| {}).unwrap();
    assert!(report.reached);
    assert_eq!(report.completed_cycles, 2);
    assert_eq!(report.hops[0].address, Some(Ipv4Addr::new(192, 0, 2, 1)));
    assert_eq!(report.hops[0].loss_percent, 50.0);
    assert_eq!(report.hops[0].last_ms, Some(10.0));
    assert_eq!(report.hops[1].average_ms, Some(3.0));
    assert_eq!(report.hops[1].best_ms, Some(2.0));
    assert_eq!(report.hops[1].worst_ms, Some(4.0));
}

#[test]
fn router_change_resets_only_that_hop() {
    let mut fixture = Fixture(VecDeque::from([
        reply([192, 0, 2, 1], 10, ReplyKind::TimeExceeded),
        None,
        reply([192, 0, 2, 2], 5, ReplyKind::TimeExceeded),
        None,
    ]));
    let report = run_with(&options(2), &AtomicBool::new(false), &mut fixture, |_| {}).unwrap();
    assert!(!report.reached);
    assert_eq!(report.hops[0].sent, 1);
    assert_eq!(report.hops[0].average_ms, Some(5.0));
    assert_eq!(report.hops[1].sent, 2);
    assert_eq!(report.hops[1].loss_percent, 100.0);
    assert_eq!(report.hops[1].average_ms, None);
}

#[test]
fn route_shortening_prunes_old_rows_and_unreachable_is_not_reached() {
    let mut fixture = Fixture(VecDeque::from([
        reply([192, 0, 2, 1], 10, ReplyKind::TimeExceeded),
        None,
        reply([192, 0, 2, 1], 5, ReplyKind::Unreachable),
    ]));
    let report = run_with(&options(2), &AtomicBool::new(false), &mut fixture, |_| {}).unwrap();
    assert!(!report.reached);
    assert_eq!(report.hops.len(), 1);
    assert_eq!(report.hops[0].reply_kind, Some(ReplyKind::Unreachable));
}

#[test]
fn cancellation_before_start_and_from_progress_stops_next_probe() {
    let cancel = AtomicBool::new(true);
    assert!(matches!(
        run(&options(1), &cancel, |_| {}),
        Err(Error::Cancelled)
    ));
    cancel.store(false, Ordering::Relaxed);
    let mut fixture = Fixture(VecDeque::from([None]));
    assert!(matches!(
        run_with(&options(1), &cancel, &mut fixture, |_| cancel
            .store(true, Ordering::Relaxed)),
        Err(Error::Cancelled)
    ));
}

#[test]
fn invalid_options_never_open_backend() {
    let cancel = AtomicBool::new(false);
    for hops in [0, 33, 255] {
        let mut options = options(1);
        options.max_hops = hops;
        assert!(matches!(
            run(&options, &cancel, |_| {}),
            Err(Error::InvalidOptions)
        ));
    }
    for cycles in [0, 10_001] {
        assert!(matches!(
            run(&options(cycles), &cancel, |_| {}),
            Err(Error::InvalidOptions)
        ));
    }
    for target in [
        Ipv4Addr::UNSPECIFIED,
        Ipv4Addr::BROADCAST,
        Ipv4Addr::new(224, 0, 0, 1),
    ] {
        assert!(matches!(
            run(&Options::new(target), &cancel, |_| {}),
            Err(Error::InvalidTarget)
        ));
    }
}

#[test]
fn backend_failure_is_not_recorded_as_loss() {
    struct Broken;
    impl Probe for Broken {
        fn probe(
            &mut self,
            _: Ipv4Addr,
            _: u8,
            _: Duration,
            _: &AtomicBool,
        ) -> Result<Option<Reply>, Error> {
            Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied).into())
        }
    }
    let mut emitted = false;
    assert!(matches!(
        run_with(&options(1), &AtomicBool::new(false), &mut Broken, |_| {
            emitted = true
        }),
        Err(Error::Io(_))
    ));
    assert!(!emitted);
}

#[cfg(any(windows, target_os = "macos"))]
#[test]
fn native_loopback_uses_no_external_helper() {
    let report = run(&options(1), &AtomicBool::new(false), |_| {}).unwrap();
    assert!(report.reached);
    assert_eq!(report.hops.len(), 1);
    assert_eq!(report.hops[0].address, Some(Ipv4Addr::LOCALHOST));
    assert_eq!(report.hops[0].received, 1);
}
