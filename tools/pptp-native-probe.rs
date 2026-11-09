//! Standalone Windows GRE feasibility probe. No external crates or remote targets.
//! Build with rustc --edition=2024 tools/pptp-native-probe.rs -o target/pptp-native-probe.exe

#[cfg(windows)]
mod probe {
    use std::{
        io,
        mem::size_of,
        net::UdpSocket,
        time::{Duration, Instant},
    };

    #[repr(C)]
    struct Address {
        family: u16,
        port: u16,
        ip: [u8; 4],
        padding: [u8; 8],
    }

    #[link(name = "ws2_32")]
    unsafe extern "system" {
        fn socket(af: i32, kind: i32, protocol: i32) -> usize;
        fn closesocket(socket: usize) -> i32;
        fn bind(socket: usize, address: *const Address, length: i32) -> i32;
        fn setsockopt(
            socket: usize,
            level: i32,
            option: i32,
            value: *const u32,
            length: i32,
        ) -> i32;
        fn sendto(
            socket: usize,
            bytes: *const u8,
            length: i32,
            flags: i32,
            address: *const Address,
            address_length: i32,
        ) -> i32;
        fn recv(socket: usize, bytes: *mut u8, length: i32, flags: i32) -> i32;
        fn WSAGetLastError() -> i32;
    }

    struct Socket(usize);
    impl Drop for Socket {
        fn drop(&mut self) {
            // SAFETY: this guard uniquely owns a valid Winsock socket.
            unsafe {
                closesocket(self.0);
            }
        }
    }

    fn error(stage: &str) -> String {
        // SAFETY: reads the calling thread's Winsock error immediately after failure.
        let code = unsafe { WSAGetLastError() };
        let detail = if code == 10013 {
            "Windows denied raw-socket access; an elevated administrator token is required".into()
        } else {
            io::Error::from_raw_os_error(code).to_string()
        };
        format!("{stage}: Winsock {code}: {detail}")
    }

    pub fn run() -> Result<(), String> {
        // std initializes Winsock for the process. This fixture binds loopback only.
        let _winsock = UdpSocket::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        // SAFETY: AF_INET=2, SOCK_RAW=3, GRE IP protocol=47; no pointer arguments.
        let raw = unsafe { socket(2, 3, 47) };
        if raw == usize::MAX {
            return Err(error("create GRE socket"));
        }
        let socket = Socket(raw);
        println!("PASS: native GRE socket created without an installed helper or driver.");
        let address = Address {
            family: 2,
            port: 0,
            ip: [127, 0, 0, 1],
            padding: [0; 8],
        };
        // SAFETY: address has the sockaddr_in layout and remains valid during the call.
        if unsafe { bind(socket.0, &address, size_of::<Address>() as i32) } != 0 {
            return Err(error("bind GRE socket to loopback"));
        }
        let timeout_ms: u32 = 250;
        // SAFETY: SOL_SOCKET/SO_RCVTIMEO accepts a DWORD timeout on Windows.
        if unsafe { setsockopt(socket.0, 0xffff, 0x1006, &timeout_ms, 4) } != 0 {
            return Err(error("set bounded receive timeout"));
        }
        // RFC 2637 enhanced GRE: K+S, version 1, PPP, payload length, synthetic
        // call ID and sequence. PPP payload is a synthetic LCP Echo-Request.
        let packet: [u8; 24] = [
            0x30, 1, 0x88, 0x0b, 0, 12, 0x7a, 0x31, 0, 0, 0, 1, 0xff, 3, 0xc0, 0x21, 9, 0x42, 0, 8,
            0x43, 0x58, 0x4f, 0x4c,
        ];
        // SAFETY: byte slice and destination are valid for the supplied lengths.
        let sent = unsafe {
            sendto(
                socket.0,
                packet.as_ptr(),
                packet.len() as i32,
                0,
                &address,
                size_of::<Address>() as i32,
            )
        };
        if sent == -1 {
            return Err(error("send synthetic GRE on loopback"));
        }
        if sent as usize != packet.len() {
            return Err("short GRE datagram send".into());
        }
        println!("PASS: synthetic GRE datagram sent to 127.0.0.1.");
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut buffer = [0u8; 2048];
        while Instant::now() < deadline {
            // SAFETY: buffer is writable and bounded by its actual allocation.
            let received = unsafe { recv(socket.0, buffer.as_mut_ptr(), buffer.len() as i32, 0) };
            if received == -1 {
                // SAFETY: immediate Winsock error lookup, no intervening socket calls.
                let code = unsafe { WSAGetLastError() };
                if code == 10060 {
                    continue;
                }
                return Err(format!("receive GRE: Winsock {code}"));
            }
            if matches_packet(&buffer[..received as usize], &packet) {
                println!("PASS: matching GRE datagram received on loopback.");
                println!(
                    "This proves local GRE transport only, not PPTP authentication or remote interoperability."
                );
                return Ok(());
            }
        }
        Err("No matching loopback GRE received within two seconds. No firewall or routing changes attempted.".into())
    }

    fn matches_packet(bytes: &[u8], packet: &[u8]) -> bool {
        if bytes.len() < 20 || bytes[0] >> 4 != 4 || bytes[9] != 47 {
            return false;
        }
        let header = usize::from(bytes[0] & 15) * 4;
        header >= 20
            && bytes.get(12..16) == Some(&[127, 0, 0, 1])
            && bytes.get(16..20) == Some(&[127, 0, 0, 1])
            && bytes.get(header..) == Some(packet)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn validates_ipv4_header_and_exact_fixture() {
            let packet = [0x30, 1, 0x88, 0x0b];
            let mut bytes = vec![0; 20];
            bytes[0] = 0x45;
            bytes[9] = 47;
            bytes[12..20].copy_from_slice(&[127, 0, 0, 1, 127, 0, 0, 1]);
            bytes.extend_from_slice(&packet);
            assert!(matches_packet(&bytes, &packet));
            for length in 0..bytes.len() {
                assert!(!matches_packet(&bytes[..length], &packet));
            }
            bytes[9] = 6;
            assert!(!matches_packet(&bytes, &packet));
        }
    }
}

fn main() {
    #[cfg(windows)]
    if let Err(error) = probe::run() {
        eprintln!("GRE feasibility probe failed: {error}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    {
        eprintln!("This feasibility probe targets Windows only.");
        std::process::exit(2);
    }
}
