use conxol_ping::{Error, Options, Probe, Reply, ReplyKind, Session, run, run_with};
use std::{
    collections::VecDeque,
    net::Ipv4Addr,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

struct Fixture(VecDeque<Result<Option<Reply>, Error>>);
impl Probe for Fixture {
    fn probe(
        &mut self,
        _: Ipv4Addr,
        ttl: u8,
        _: Duration,
        _: &AtomicBool,
    ) -> Result<Option<Reply>, Error> {
        assert_eq!(ttl, 64);
        self.0.pop_front().expect("unexpected extra probe")
    }
}
fn options() -> Options {
    let mut options = Options::new(Ipv4Addr::LOCALHOST);
    options.interval = Duration::from_millis(200);
    options.count = 3;
    options
}
fn reply(ms: u64, kind: ReplyKind) -> Result<Option<Reply>, Error> {
    Ok(Some(Reply {
        address: Ipv4Addr::LOCALHOST,
        latency: Duration::from_millis(ms),
        kind,
    }))
}

#[test]
fn serial_statistics_keep_timeout_distinct_from_latency() {
    let started = Instant::now();
    let mut fixture = Fixture(VecDeque::from([
        reply(2, ReplyKind::Destination),
        Ok(None),
        reply(4, ReplyKind::Destination),
    ]));
    let report = run_with(
        &options(),
        &AtomicBool::new(false),
        &mut fixture,
        |_| {},
        false,
    )
    .unwrap();
    assert!(started.elapsed() >= Duration::from_millis(400));
    assert_eq!(report.sent, 3);
    assert_eq!(report.received, 2);
    assert_eq!(report.average_ms, Some(3.0));
    assert_eq!(report.best_ms, Some(2.0));
    assert_eq!(report.worst_ms, Some(4.0));
    assert_eq!(report.last_ms, Some(4.0));
    assert!(report.lines[0].contains("seq=1"));
    assert!(report.lines[1].contains("timed out"));
    assert!(report.lines[2].contains("time=4.000 ms"));
}

#[test]
fn router_errors_are_not_successful_echoes() {
    let mut fixture = Fixture(VecDeque::from([
        reply(1, ReplyKind::Unreachable),
        reply(1, ReplyKind::TimeExceeded),
        Ok(None),
    ]));
    let report = run_with(
        &options(),
        &AtomicBool::new(false),
        &mut fixture,
        |_| {},
        false,
    )
    .unwrap();
    assert_eq!(report.received, 0);
    assert_eq!(report.last_ms, None);
    assert_eq!(report.average_ms, None);
    assert!(report.lines[0].contains("unreachable"));
    assert!(report.lines[1].contains("TTL expired"));
}

#[test]
fn local_failure_never_becomes_network_loss() {
    let mut fixture = Fixture(VecDeque::from([Err(std::io::Error::from(
        std::io::ErrorKind::PermissionDenied,
    )
    .into())]));
    let result = run_with(
        &options(),
        &AtomicBool::new(false),
        &mut fixture,
        |_| panic!("unexpected snapshot"),
        false,
    );
    assert!(matches!(result, Err(Error::Io(_))));
}

#[test]
fn cancellation_before_open_and_during_long_interval() {
    let cancel = AtomicBool::new(true);
    assert!(matches!(
        run(&options(), &cancel, |_| {}),
        Err(Error::Cancelled)
    ));
    cancel.store(false, Ordering::Relaxed);
    let mut options = options();
    options.interval = Duration::from_secs(60);
    let mut fixture = Fixture(VecDeque::from([Ok(None)]));
    let started = Instant::now();
    let result = run_with(
        &options,
        &cancel,
        &mut fixture,
        |_| cancel.store(true, Ordering::Relaxed),
        true,
    );
    assert!(matches!(result, Err(Error::Cancelled)));
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[test]
fn invalid_configuration_never_opens_backend() {
    for count in [0, 10001] {
        let mut options = options();
        options.count = count;
        assert!(matches!(
            run(&options, &AtomicBool::new(false), |_| {}),
            Err(Error::InvalidOptions)
        ));
    }
    assert!(matches!(Session::new(65501), Err(Error::InvalidOptions)));
    for target in [
        Ipv4Addr::UNSPECIFIED,
        Ipv4Addr::BROADCAST,
        Ipv4Addr::new(224, 0, 0, 1),
    ] {
        assert!(matches!(
            run(&Options::new(target), &AtomicBool::new(false), |_| {}),
            Err(Error::InvalidTarget)
        ));
    }
}

#[cfg(any(windows, target_os = "macos"))]
#[test]
fn native_loopback_payload_boundaries_without_external_commands() {
    for payload in [0, 1, 32, 65500] {
        let mut session = Session::new(payload).unwrap();
        let reply = session
            .probe(
                Ipv4Addr::LOCALHOST,
                64,
                Duration::from_secs(2),
                &AtomicBool::new(false),
            )
            .unwrap()
            .expect("loopback echo reply");
        assert_eq!(reply.address, Ipv4Addr::LOCALHOST);
        assert_eq!(reply.kind, ReplyKind::Destination);
    }
}
