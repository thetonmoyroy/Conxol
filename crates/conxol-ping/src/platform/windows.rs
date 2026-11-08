use super::*;
use std::mem::size_of;
use windows_sys::Win32::Foundation::{GetLastError, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::NetworkManagement::IpHelper::*;

pub(super) struct NativeProbe(HANDLE, Vec<u8>);

impl NativeProbe {
    pub fn new(payload_size: u16) -> Result<Self, Error> {
        // SAFETY: no arguments; the returned handle is owned and closed by Drop.
        let handle = unsafe { IcmpCreateFile() };
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error().into());
        }
        Ok(Self(handle, vec![0x63; usize::from(payload_size)]))
    }
}

impl Drop for NativeProbe {
    fn drop(&mut self) {
        // SAFETY: handle is valid, exclusively owned, and no send is in flight.
        unsafe {
            IcmpCloseHandle(self.0);
        }
    }
}

impl Probe for NativeProbe {
    fn probe(
        &mut self,
        target: Ipv4Addr,
        ttl: u8,
        timeout: Duration,
        cancel: &AtomicBool,
    ) -> Result<Option<Reply>, Error> {
        check_cancel(cancel)?;
        let payload = &self.1;
        let options = IP_OPTION_INFORMATION {
            Ttl: ttl,
            ..Default::default()
        };
        // Word storage provides sufficient alignment and space for the API reply,
        // options, request payload and the additional ICMP error header.
        let bytes = size_of::<ICMP_ECHO_REPLY>() + payload.len() + 256;
        let mut buffer = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        // SAFETY: handle and input buffers remain alive for the synchronous call;
        // output is aligned, writable, and sized in bytes as required by the API.
        let count = unsafe {
            IcmpSendEcho(
                self.0,
                u32::from_ne_bytes(target.octets()),
                payload.as_ptr().cast(),
                payload.len() as u16,
                &options,
                buffer.as_mut_ptr().cast(),
                (buffer.len() * size_of::<usize>()) as u32,
                timeout.as_millis().clamp(1, 60000) as u32,
            )
        };
        if count == 0 {
            // SAFETY: read immediately after the failing API call.
            let code = unsafe { GetLastError() };
            if code == IP_REQ_TIMED_OUT {
                return Ok(None);
            }
            return Err(io::Error::from_raw_os_error(code as i32).into());
        }
        // SAFETY: API returned at least one reply into sufficiently sized/aligned
        // storage. No returned data pointers are dereferenced.
        let reply = unsafe { std::ptr::read_unaligned(buffer.as_ptr().cast::<ICMP_ECHO_REPLY>()) };
        debug_assert!(size_of::<ICMP_ECHO_REPLY>() <= buffer.len() * size_of::<usize>());
        let kind = match reply.Status {
            IP_SUCCESS => ReplyKind::Destination,
            IP_TTL_EXPIRED_TRANSIT => ReplyKind::TimeExceeded,
            IP_DEST_NET_UNREACHABLE
            | IP_DEST_HOST_UNREACHABLE
            | IP_DEST_PROT_UNREACHABLE
            | IP_DEST_PORT_UNREACHABLE => ReplyKind::Unreachable,
            IP_REQ_TIMED_OUT => return Ok(None),
            code => return Err(io::Error::from_raw_os_error(code as i32).into()),
        };
        Ok(Some(Reply {
            address: Ipv4Addr::from(reply.Address.to_ne_bytes()),
            latency: Duration::from_millis(u64::from(reply.RoundTripTime)),
            kind,
        }))
    }
}
