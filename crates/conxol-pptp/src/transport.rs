//! Bounded, process-private async TCP streams serviced by the owning IP worker.
//! No host listener, adapter, DNS lookup, or direct-network fallback exists here.
use crate::stack::Stack;
use smoltcp::{iface::SocketHandle, socket::tcp};
use std::{
    io,
    net::Ipv4Addr,
    pin::Pin,
    task::{Context, Poll, Waker},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncWrite, DuplexStream, ReadBuf},
    sync::{mpsc, oneshot},
};

const LIMIT: usize = 64;
const TIMEOUT: Duration = Duration::from_secs(15);
struct Request {
    target: Ipv4Addr,
    port: u16,
    reply: oneshot::Sender<io::Result<DuplexStream>>,
}

#[derive(Clone)]
pub struct Connector {
    tcp: mpsc::Sender<Request>,
    pub diagnostics: crate::diagnostic::DiagnosticConnector,
}
pub struct TcpRouter {
    requests: mpsc::Receiver<Request>,
    streams: Vec<Stream>,
    next_port: u16,
    diagnostics: crate::diagnostic::DiagnosticRouter,
}
struct Stream {
    socket: SocketHandle,
    io: DuplexStream,
    client: Option<DuplexStream>,
    reply: Option<oneshot::Sender<io::Result<DuplexStream>>>,
    started: Instant,
    eof: bool,
}
impl Connector {
    pub async fn connect(&self, host: &str, port: u16) -> io::Result<DuplexStream> {
        let target: Ipv4Addr = host.parse().map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "PPTP destinations must be IPv4 addresses; DNS is not routed through PPTP yet.",
            )
        })?;
        if port == 0 || target.is_unspecified() || target.is_multicast() || target.is_broadcast() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid PPTP TCP destination.",
            ));
        }
        let (reply, response) = oneshot::channel();
        self.tcp
            .try_send(Request {
                target,
                port,
                reply,
            })
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::NotConnected,
                    "PPTP tunnel is unavailable or busy. Connect it in Tools > PPTP manager.",
                )
            })?;
        tokio::time::timeout(TIMEOUT, response)
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "PPTP TCP connection timed out."))?
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::ConnectionAborted,
                    "PPTP tunnel disconnected.",
                )
            })?
    }
}
impl TcpRouter {
    pub fn new() -> (Connector, Self) {
        let (tx, requests) = mpsc::channel(LIMIT);
        let (diagnostics, router) = crate::diagnostic::DiagnosticRouter::new();
        (
            Connector {
                tcp: tx,
                diagnostics,
            },
            Self {
                requests,
                streams: Vec::new(),
                next_port: 49152,
                diagnostics: router,
            },
        )
    }
    pub fn poll(&mut self, stack: &mut Stack) {
        self.diagnostics.poll(stack);
        while let Ok(request) = self.requests.try_recv() {
            if request.reply.is_closed() {
                continue;
            }
            if self.streams.len() >= LIMIT {
                let _ = request.reply.send(Err(io::Error::other(
                    "PPTP tunnel has reached its 64 TCP connection limit.",
                )));
                continue;
            }
            // Do not reuse a live local port when the counter wraps.
            let port = loop {
                let port = self.next_port;
                self.next_port = if port == u16::MAX { 49152 } else { port + 1 };
                if !self.streams.iter().any(|s| {
                    stack
                        .sockets
                        .get::<tcp::Socket>(s.socket)
                        .local_endpoint()
                        .is_some_and(|e| e.port == port)
                }) {
                    break port;
                }
            };
            match stack.connect_tcp(request.target, request.port, port) {
                Ok(socket) => {
                    let (client, io) = tokio::io::duplex(65536);
                    self.streams.push(Stream {
                        socket,
                        io,
                        client: Some(client),
                        reply: Some(request.reply),
                        started: Instant::now(),
                        eof: false,
                    });
                }
                Err(_) => {
                    let _ = request.reply.send(Err(io::Error::other(
                        "Private TCP connection could not start.",
                    )));
                }
            }
        }
        let mut cx = Context::from_waker(Waker::noop());
        self.streams.retain_mut(|stream| {
            let tcp = stack.sockets.get_mut::<tcp::Socket>(stream.socket);
            let mut remove = false;
            let mut failure_kind = io::ErrorKind::ConnectionAborted;
            if let Some(reply) = stream.reply.as_ref() {
                if reply.is_closed() || stream.started.elapsed() >= TIMEOUT || !tcp.is_open() {
                    remove = true;
                    failure_kind = if stream.started.elapsed() >= TIMEOUT {
                        io::ErrorKind::TimedOut
                    } else if !tcp.is_open() {
                        io::ErrorKind::ConnectionRefused
                    } else {
                        io::ErrorKind::ConnectionAborted
                    };
                } else if tcp.state() == tcp::State::Established {
                    let reply = stream.reply.take().unwrap();
                    if reply.send(Ok(stream.client.take().unwrap())).is_err() {
                        remove = true;
                    }
                }
            }
            if stream.reply.is_none() && !remove {
                // Peek so backpressure never discards remote bytes.
                if tcp.can_recv() {
                    let bytes = tcp.peek(16384).unwrap();
                    match Pin::new(&mut stream.io).poll_write(&mut cx, bytes) {
                        Poll::Ready(Ok(n)) if n > 0 => {
                            let _ = tcp.recv(|_| (n, ()));
                        }
                        Poll::Ready(_) => remove = true,
                        Poll::Pending => {}
                    }
                }
                if !stream.eof && tcp.can_send() {
                    let mut bytes = [0u8; 16384];
                    let capacity = tcp.send_capacity() - tcp.send_queue();
                    let mut buf = ReadBuf::new(&mut bytes[..capacity.min(16384)]);
                    match Pin::new(&mut stream.io).poll_read(&mut cx, &mut buf) {
                        Poll::Ready(Ok(())) if buf.filled().is_empty() => {
                            stream.eof = true;
                            tcp.close();
                        }
                        Poll::Ready(Ok(())) => {
                            let _ = tcp.send_slice(buf.filled());
                        }
                        Poll::Ready(Err(_)) => remove = true,
                        Poll::Pending => {}
                    }
                }
                if !tcp.may_recv() && !tcp.can_recv() {
                    let _ = Pin::new(&mut stream.io).poll_shutdown(&mut cx);
                }
                if !tcp.is_open() || tcp.state() == tcp::State::TimeWait {
                    remove = true;
                }
            }
            if remove {
                tcp.abort();
                if let Some(reply) = stream.reply.take() {
                    let _ = reply.send(Err(io::Error::new(
                        failure_kind,
                        "Private PPTP TCP connection failed or was cancelled.",
                    )));
                }
                stack.sockets.remove(stream.socket);
            }
            !remove
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mppe::{Codec, Keys};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use zeroize::Zeroizing;

    fn exchange(a: &mut Stack, b: &mut Stack, send: &mut Codec, receive: &mut Codec) {
        while let Some(ip) = a.outgoing() {
            let encrypted = send.encrypt_ipv4(&ip).unwrap();
            assert!(b.ingest(receive.decrypt_ipv4(&encrypted).unwrap().unwrap()));
        }
    }

    #[tokio::test]
    async fn pptp_private_stream_encrypted_bidirectional_backpressure_and_disconnect() {
        let a = Ipv4Addr::new(192, 0, 2, 1);
        let b = Ipv4Addr::new(192, 0, 2, 2);
        let mut client = Stack::new(a, b, 1360, 1);
        let mut server = Stack::new(b, a, 1360, 2);
        let listener = server.tcp_socket();
        server
            .sockets
            .get_mut::<tcp::Socket>(listener)
            .listen(22)
            .unwrap();
        let mut send = Codec::new(Keys {
            send: Zeroizing::new([1; 16]),
            receive: Zeroizing::new([2; 16]),
        });
        let mut receive = Codec::new(Keys {
            send: Zeroizing::new([2; 16]),
            receive: Zeroizing::new([1; 16]),
        });
        let (connector, mut router) = TcpRouter::new();
        // This documentation-only address must never be resolved or opened on host TCP.
        let opening =
            tokio::spawn(async move { connector.connect("192.0.2.2", 22).await.unwrap() });
        let mut tick = 0;
        while !opening.is_finished() {
            router.poll(&mut client);
            client.poll(tick);
            exchange(&mut client, &mut server, &mut send, &mut receive);
            server.poll(tick);
            exchange(&mut server, &mut client, &mut receive, &mut send);
            tick += 10;
            assert!(tick < 10000);
            tokio::task::yield_now().await;
        }
        let mut stream = opening.await.unwrap();
        let expected = (0..262144).map(|i| (i % 251) as u8).collect::<Vec<_>>();
        let send_data = expected.clone();
        let session = tokio::spawn(async move {
            stream.write_all(&send_data).await.unwrap();
            let mut got = vec![0; send_data.len()];
            stream.read_exact(&mut got).await.unwrap();
            assert_eq!(got, send_data);
            // A tunnel failure closes the process-private transport.
            let mut tail = [0];
            assert_eq!(stream.read(&mut tail).await.unwrap(), 0);
        });
        let mut received = Vec::new();
        let mut sent = 0;
        for _ in 0..20000 {
            router.poll(&mut client);
            client.poll(tick);
            exchange(&mut client, &mut server, &mut send, &mut receive);
            server.poll(tick);
            exchange(&mut server, &mut client, &mut receive, &mut send);
            let tcp = server.sockets.get_mut::<tcp::Socket>(listener);
            if tcp.can_recv() {
                tcp.recv(|bytes| {
                    received.extend_from_slice(bytes);
                    (bytes.len(), ())
                })
                .unwrap();
            }
            if received.len() == expected.len() && tcp.can_send() {
                sent += tcp.send_slice(&expected[sent..]).unwrap();
            }
            tick += 1;
            tokio::task::yield_now().await;
            if sent == expected.len()
                && client
                    .sockets
                    .get::<tcp::Socket>(router.streams[0].socket)
                    .recv_queue()
                    == 0
            {
                // Let the final in-flight frames reach the application before disconnect.
                if tick > 5000 {
                    break;
                }
            }
        }
        assert_eq!(received, expected);
        assert_eq!(sent, expected.len());
        drop(router);
        tokio::time::timeout(Duration::from_secs(2), session)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn pptp_private_stream_rejects_dns_cancelled_open_and_dead_tunnel() {
        let (connector, mut router) = TcpRouter::new();
        assert_eq!(
            connector
                .connect("fixture.invalid", 22)
                .await
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidInput
        );
        let waiting = {
            let c = connector.clone();
            tokio::spawn(async move { c.connect("192.0.2.2", 22).await })
        };
        tokio::task::yield_now().await;
        let mut stack = Stack::new(
            "192.0.2.1".parse().unwrap(),
            "192.0.2.2".parse().unwrap(),
            1360,
            1,
        );
        router.poll(&mut stack);
        assert_eq!(router.streams.len(), 1);
        waiting.abort();
        let _ = waiting.await;
        router.poll(&mut stack);
        assert!(router.streams.is_empty());
        assert_eq!(stack.sockets.iter().count(), 1); // only ICMP remains
        drop(router);
        assert!(connector.connect("192.0.2.2", 22).await.is_err());
    }
}
