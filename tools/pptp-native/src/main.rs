#[cfg(windows)]
use conxol_pptp::{control, gre, link, ppp, stack};

#[cfg(windows)]
fn run() -> Result<(), Box<dyn std::error::Error>> {
    use std::{io::Read, net::Ipv4Addr};
    use zeroize::Zeroizing;
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if !matches!(args.len(), 4 | 6)
        || args[0] != "--server"
        || args[2] != "--credential-pipe"
        || !args[3].starts_with("conxol-pptp-")
        || !args[3]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(
            "Usage: --server IPv4 --credential-pipe conxol-pptp-UNIQUE (use run-live.ps1)".into(),
        );
    }
    let server: Ipv4Addr = args[1].parse()?;
    let tcp_target = if args.len() == 6 {
        if args[4] != "--tcp-target" {
            return Err("expected --tcp-target IPv4:port".into());
        }
        let target: std::net::SocketAddrV4 = args[5].parse()?;
        if target.port() == 0
            || target.ip().is_loopback()
            || target.ip().is_unspecified()
            || target.ip().is_multicast()
            || target.ip().is_broadcast()
        {
            return Err("invalid explicit tunnel TCP target".into());
        }
        Some(target)
    } else {
        None
    };
    let mut secrets = Zeroizing::new(String::new());
    let pipe = std::fs::File::open(format!(r"\\.\pipe\{}", args[3]))?;
    pipe.take(2049).read_to_string(&mut secrets)?;
    if secrets.len() > 2048 {
        return Err("credential input too large".into());
    }
    let (user, password) = secrets.split_once('\n').ok_or("invalid credential input")?;
    if user.is_empty()
        || user.len() > 256
        || password.is_empty()
        || password.encode_utf16().count() > 256
        || password.contains(['\r', '\n'])
    {
        return Err("invalid credential sizes".into());
    }
    let mut control = control::Control::connect(server)?;
    println!("PASS: TCP connection to supplied PPTP server on port 1723.");
    let mut random = [0u8; 2];
    getrandom::fill(&mut random)?;
    let call = u16::from_ne_bytes(random).max(1);
    let mut gre = gre::Gre::open(control.local()?, server, call)?;
    println!("PASS: native GRE socket opened under current token.");
    let peer = control.start(call)?;
    let authenticated = ppp::authenticate(&mut control, &mut gre, peer, user, password)?;
    // Discard credentials before IP traffic starts.
    drop(secrets);
    let mut link = link::Link::negotiate(&mut control, &mut gre, peer, authenticated)?;
    let mut random = [0u8; 26];
    getrandom::fill(&mut random)?;
    let mut stack = stack::Stack::new(
        link.local_ip,
        link.peer_ip,
        link.mtu,
        u64::from_ne_bytes(random[..8].try_into()?),
    );
    let ident = u16::from_ne_bytes(random[8..10].try_into()?);
    let nonce = random[10..].try_into()?;
    let tcp = if let Some(target) = tcp_target {
        Some(stack.connect_tcp(*target.ip(), target.port(), 49152 + (ident % 16384))?)
    } else {
        None
    };
    let start = std::time::Instant::now();
    let mut replied = false;
    let mut ping_count = 0;
    let mut tcp_connected = false;
    let mut ssh_banner = false;
    let mut banner = zeroize::Zeroizing::new(Vec::new());
    while start.elapsed() < std::time::Duration::from_secs(10) {
        if tcp.is_none() && ping_count < 3 && start.elapsed().as_secs() >= ping_count * 2 {
            stack.start_ping(link.peer_ip, ident, nonce)?;
            ping_count += 1;
        }
        stack.poll(start.elapsed().as_millis() as i64);
        while let Some(ip) = stack.outgoing() {
            link.send_ipv4(&ip)?;
        }
        if let Some(ip) = link.poll()? {
            stack.ingest(ip);
        }
        stack.poll(start.elapsed().as_millis() as i64);
        if tcp.is_none() && stack.ping_done() {
            replied = true;
            break;
        }
        if let Some(handle) = tcp {
            let socket = stack
                .sockets
                .get_mut::<smoltcp::socket::tcp::Socket>(handle);
            if socket.may_send() {
                tcp_connected = true;
            }
            if socket.can_recv() {
                let mut buffer = [0u8; 256];
                let n = socket
                    .recv_slice(&mut buffer)
                    .map_err(|_| "private TCP receive failed")?;
                if banner.len() + n > 1024 {
                    return Err("TCP banner exceeds probe bound".into());
                }
                banner.extend_from_slice(&buffer[..n]);
                ssh_banner = banner.starts_with(b"SSH-2.0-") && banner.contains(&b'\n');
            }
            if tcp_connected && (ssh_banner || start.elapsed().as_secs() >= 3) {
                socket.close();
                replied = true;
                break;
            }
        }
    }
    if !replied {
        return Err(format!("encrypted traffic deadline exceeded: sent={}, decrypted={}, encrypted packets={}, control packets={}",link.sent,link.received,link.encrypted_received,link.other_received).into());
    }
    stack.poll(start.elapsed().as_millis() as i64);
    while let Some(ip) = stack.outgoing() {
        link.send_ipv4(&ip)?;
    }
    if tcp_connected {
        println!("PASS: private TCP connection established through encrypted IP.");
        if ssh_banner {
            println!(
                "PASS: SSH protocol banner received through encrypted IP (contents not logged)."
            );
        }
    } else {
        println!("PASS: encrypted IPv4 ICMP echo request/reply through the private IP stack.");
    }
    println!("SUCCESS: native PPTP encrypted IP traffic verified. Disconnecting test call.");
    println!(
        "No host VPN profile, routes, or DNS changes were created. No SSH authentication was attempted."
    );
    Ok(())
}
fn main() {
    #[cfg(windows)]
    {
        let args = std::env::args().skip(1).collect::<Vec<_>>();
        if let Some(code) = conxol_pptp::elevation::broker_entry(&args) {
            std::process::exit(code);
        }
        if args == ["--test-elevation"] {
            let result = (|| -> Result<(), Box<dyn std::error::Error>> {
                use std::{
                    net::{Ipv4Addr, UdpSocket},
                    sync::{Arc, atomic::AtomicBool},
                    time::{Duration, Instant},
                };
                let _winsock = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))?;
                let mut gre = conxol_pptp::elevation::open_gre(
                    Ipv4Addr::LOCALHOST,
                    Ipv4Addr::LOCALHOST,
                    0x7a31,
                    Arc::new(AtomicBool::new(false)),
                )?;
                let echo = [9, 1, 0, 8, 0x43, 0x58, 0x4f, 0x4c];
                gre.send(0x7a31, 0xc021, &echo)?;
                let expected = [0xff, 3, 0xc0, 0x21, 9, 1, 0, 8, 0x43, 0x58, 0x4f, 0x4c];
                let start = Instant::now();
                while start.elapsed() < Duration::from_secs(2) {
                    if gre.receive(0x7a31)?.as_deref() == Some(&expected[..]) {
                        println!("PASS: first elevated socket handoff and loopback send/receive.");
                        let pid = conxol_pptp::elevation::helper_process_id()
                            .ok_or("missing helper process")?;
                        drop(gre);
                        println!("Checking permission reuse after 31 seconds disconnected…");
                        std::thread::sleep(Duration::from_secs(31));
                        let mut second = conxol_pptp::elevation::open_gre(
                            Ipv4Addr::LOCALHOST,
                            Ipv4Addr::LOCALHOST,
                            0x7a32,
                            Arc::new(AtomicBool::new(false)),
                        )?;
                        if conxol_pptp::elevation::helper_process_id() != Some(pid) {
                            return Err("elevated helper was not reused".into());
                        }
                        second.send(0x7a32, 0xc021, &echo)?;
                        let second_start = Instant::now();
                        let mut received = false;
                        while second_start.elapsed() < Duration::from_secs(2) {
                            if second.receive(0x7a32)?.as_deref() == Some(&expected[..]) {
                                received = true;
                                break;
                            }
                        }
                        if !received {
                            return Err("reused socket loopback receive timed out".into());
                        }
                        println!(
                            "PASS: same elevated helper reused for a new connection after idle; no second elevation launch."
                        );
                        drop(second);
                        conxol_pptp::elevation::shutdown()?;
                        println!("PASS: elevated helper exited when the app session closed.");
                        return Ok(());
                    }
                }
                Err("elevated socket loopback deadline exceeded".into())
            })();
            if let Err(e) = result {
                eprintln!("Elevation test failed: {e}");
                std::process::exit(1);
            }
            return;
        }
    }
    #[cfg(windows)]
    if let Err(e) = run() {
        eprintln!("Native PPTP attempt failed: {e}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    {
        eprintln!("Windows-only prototype");
        std::process::exit(2);
    }
}
