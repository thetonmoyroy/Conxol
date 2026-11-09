//! A private IP-only device. It has no access to host adapters, routing, or DNS.
use smoltcp::{
    iface::{Config, Interface, SocketHandle, SocketSet},
    phy::{Device, DeviceCapabilities, Medium, RxToken, TxToken},
    socket::{icmp, tcp},
    time::Instant,
    wire::{HardwareAddress, Icmpv4Packet, Icmpv4Repr, IpAddress, IpCidr},
};
use std::{collections::VecDeque, net::Ipv4Addr};
const QUEUE: usize = 32;
pub struct IpDevice {
    incoming: VecDeque<Vec<u8>>,
    outgoing: VecDeque<Vec<u8>>,
    mtu: usize,
}
pub struct Rx(Vec<u8>);
pub struct Tx<'a>(&'a mut VecDeque<Vec<u8>>);
impl RxToken for Rx {
    fn consume<R, F: FnOnce(&[u8]) -> R>(self, f: F) -> R {
        f(&self.0)
    }
}
impl TxToken for Tx<'_> {
    fn consume<R, F: FnOnce(&mut [u8]) -> R>(self, len: usize, f: F) -> R {
        let mut bytes = vec![0u8; len];
        let r = f(&mut bytes);
        self.0.push_back(bytes);
        r
    }
}
impl Device for IpDevice {
    type RxToken<'a> = Rx;
    type TxToken<'a> = Tx<'a>;
    fn receive(&mut self, _: Instant) -> Option<(Rx, Tx<'_>)> {
        if self.outgoing.len() >= QUEUE {
            return None;
        }
        self.incoming
            .pop_front()
            .map(|p| (Rx(p), Tx(&mut self.outgoing)))
    }
    fn transmit(&mut self, _: Instant) -> Option<Tx<'_>> {
        if self.outgoing.len() >= QUEUE {
            None
        } else {
            Some(Tx(&mut self.outgoing))
        }
    }
    fn capabilities(&self) -> DeviceCapabilities {
        let mut caps = DeviceCapabilities::default();
        caps.medium = Medium::Ip;
        caps.max_transmission_unit = self.mtu;
        caps.max_burst_size = Some(QUEUE);
        caps
    }
}
pub struct Stack {
    pub interface: Interface,
    pub sockets: SocketSet<'static>,
    device: IpDevice,
    icmp: SocketHandle,
    ping: Option<(Ipv4Addr, u16, [u8; 16])>,
}
impl Stack {
    pub fn new(local: Ipv4Addr, peer: Ipv4Addr, mtu: usize, seed: u64) -> Self {
        let mut device = IpDevice {
            incoming: VecDeque::new(),
            outgoing: VecDeque::new(),
            mtu,
        };
        let mut config = Config::new(HardwareAddress::Ip);
        config.random_seed = seed;
        let mut interface = Interface::new(config, &mut device, Instant::from_millis(0));
        interface.update_ip_addrs(|ips| {
            ips.push(IpCidr::new(local.into(), 32)).unwrap();
        });
        interface.routes_mut().add_default_ipv4_route(peer).unwrap();
        let icmp = icmp::Socket::new(
            icmp::PacketBuffer::new(vec![icmp::PacketMetadata::EMPTY; 4], vec![0; 2048]),
            icmp::PacketBuffer::new(vec![icmp::PacketMetadata::EMPTY; 4], vec![0; 2048]),
        );
        let mut sockets = SocketSet::new(vec![]);
        let icmp = sockets.add(icmp);
        Self {
            interface,
            sockets,
            device,
            icmp,
            ping: None,
        }
    }
    pub fn ingest(&mut self, bytes: Vec<u8>) -> bool {
        if bytes.len() > self.device.mtu || self.device.incoming.len() >= QUEUE {
            return false;
        }
        self.device.incoming.push_back(bytes);
        true
    }
    pub fn outgoing(&mut self) -> Option<Vec<u8>> {
        self.device.outgoing.pop_front()
    }
    pub fn poll(&mut self, millis: i64) {
        self.interface.poll(
            Instant::from_millis(millis),
            &mut self.device,
            &mut self.sockets,
        );
    }
    pub fn start_ping(
        &mut self,
        target: Ipv4Addr,
        ident: u16,
        nonce: [u8; 16],
    ) -> Result<(), String> {
        let socket = self.sockets.get_mut::<icmp::Socket>(self.icmp);
        if !socket.is_open() {
            socket
                .bind(icmp::Endpoint::Ident(ident))
                .map_err(|_| "private ICMP bind failed")?;
        }
        let repr = Icmpv4Repr::EchoRequest {
            ident,
            seq_no: 1,
            data: &nonce,
        };
        let bytes = socket
            .send(repr.buffer_len(), IpAddress::Ipv4(target))
            .map_err(|_| "private ICMP send failed")?;
        repr.emit(
            &mut Icmpv4Packet::new_unchecked(bytes),
            &self.device.capabilities().checksum,
        );
        self.ping = Some((target, ident, nonce));
        Ok(())
    }
    pub fn ping_done(&mut self) -> bool {
        let Some((target, ident, nonce)) = self.ping else {
            return false;
        };
        let socket = self.sockets.get_mut::<icmp::Socket>(self.icmp);
        while socket.can_recv() {
            let Ok((bytes, remote)) = socket.recv() else {
                break;
            };
            let Ok(packet) = Icmpv4Packet::new_checked(bytes) else {
                continue;
            };
            if remote == IpAddress::Ipv4(target)
                && matches!(Icmpv4Repr::parse(&packet,&self.device.capabilities().checksum),Ok(Icmpv4Repr::EchoReply {ident:i,seq_no:1,data}) if i==ident && data==nonce)
            {
                return true;
            }
        }
        false
    }
    pub fn tcp_socket(&mut self) -> SocketHandle {
        let mut socket = tcp::Socket::new(
            tcp::SocketBuffer::new(vec![0; 65536]),
            tcp::SocketBuffer::new(vec![0; 65536]),
        );
        socket.set_timeout(Some(smoltcp::time::Duration::from_secs(15)));
        socket.set_keep_alive(Some(smoltcp::time::Duration::from_secs(10)));
        self.sockets.add(socket)
    }
    pub fn connect_tcp(
        &mut self,
        target: Ipv4Addr,
        port: u16,
        local_port: u16,
    ) -> Result<SocketHandle, String> {
        let handle = self.tcp_socket();
        self.sockets
            .get_mut::<tcp::Socket>(handle)
            .connect(self.interface.context(), (target, port), local_port)
            .map_err(|_| "private TCP connect failed")?;
        Ok(handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mppe::{Codec, Keys};
    use zeroize::Zeroizing;
    fn codecs() -> (Codec, Codec) {
        (
            Codec::new(Keys {
                send: Zeroizing::new([1; 16]),
                receive: Zeroizing::new([2; 16]),
            }),
            Codec::new(Keys {
                send: Zeroizing::new([2; 16]),
                receive: Zeroizing::new([1; 16]),
            }),
        )
    }
    fn exchange(from: &mut Stack, to: &mut Stack, send: &mut Codec, receive: &mut Codec) {
        while let Some(ip) = from.outgoing() {
            let encrypted = send.encrypt_ipv4(&ip).unwrap();
            let decoded = receive.decrypt_ipv4(&encrypted).unwrap().unwrap();
            assert!(to.ingest(decoded));
        }
    }
    #[test]
    fn private_tcp_handshake_and_data_over_encrypted_ip() {
        let a = Ipv4Addr::new(192, 0, 2, 1);
        let b = Ipv4Addr::new(192, 0, 2, 2);
        let mut client = Stack::new(a, b, 1360, 1);
        let mut server = Stack::new(b, a, 1360, 2);
        let (mut c, mut s) = codecs();
        let listener = server.tcp_socket();
        server
            .sockets
            .get_mut::<tcp::Socket>(listener)
            .listen(2222)
            .unwrap();
        let connection = client.connect_tcp(b, 2222, 49152).unwrap();
        let mut sent = false;
        let mut delivered = false;
        for tick in 0..100 {
            client.poll(tick * 10);
            exchange(&mut client, &mut server, &mut c, &mut s);
            server.poll(tick * 10);
            exchange(&mut server, &mut client, &mut s, &mut c);
            let tcp = client.sockets.get_mut::<tcp::Socket>(connection);
            if !sent && tcp.can_send() {
                tcp.send_slice(b"SSH-2.0-synthetic-fixture\r\n").unwrap();
                sent = true;
            }
            let tcp = server.sockets.get_mut::<tcp::Socket>(listener);
            if tcp.can_recv() {
                let mut bytes = [0u8; 64];
                let n = tcp.recv_slice(&mut bytes).unwrap();
                assert_eq!(&bytes[..n], b"SSH-2.0-synthetic-fixture\r\n");
                delivered = true;
                break;
            }
        }
        assert!(sent && delivered);
    }
    #[test]
    fn encrypted_echo_and_bounded_inbound_queue() {
        let a = Ipv4Addr::new(192, 0, 2, 1);
        let b = Ipv4Addr::new(192, 0, 2, 2);
        let mut client = Stack::new(a, b, 1360, 3);
        let mut server = Stack::new(b, a, 1360, 4);
        let (mut c, mut s) = codecs();
        client.start_ping(b, 123, [42; 16]).unwrap();
        let mut replied = false;
        for tick in 0..10 {
            client.poll(tick);
            exchange(&mut client, &mut server, &mut c, &mut s);
            server.poll(tick);
            exchange(&mut server, &mut client, &mut s, &mut c);
            client.poll(tick);
            if client.ping_done() {
                replied = true;
                break;
            }
        }
        assert!(replied);
        assert!(!client.ingest(vec![0; 1361]));
        for _ in 0..QUEUE {
            assert!(client.ingest(vec![0; 20]));
        }
        assert!(!client.ingest(vec![0; 20]));
    }
}
