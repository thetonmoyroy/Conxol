# FTP/TFTP clients and read-only TFTP server

Tools > FTP / TFTP opens the Client and TFTP server tabs. FTP supports directory
listing and single-file upload/download; FTPS uses explicit TLS and normal
certificate verification. TFTP clients transfer binary files by name.

## Larger TFTP transfers

Both client and server allow files up to 1 GiB. Normal clients request 1468-byte
blocks and accept a server's fallback to 512 bytes. Compatibility mode disables
option requests (client) or ignores optional extensions (server), retaining
512-byte blocks. Block numbers roll from 65535 to 0 to 1. The peer must support
this convention once the transfer exceeds its block-number range; increasing
our size cap cannot add that capability to old router firmware.

TFTP client deadlines are 30 minutes overall, 10 seconds for initial connection
and a 30-second idle watchdog. FTP keeps its five-minute overall deadline.

## TFTP server

1. Select TFTP server, choose the firmware/file, and configure the listen IP and
   UDP port (default `0.0.0.0:69`). Optionally restrict requests to one device IP.
2. Confirm sharing, then Start server. Only the selected filename is served.
3. On the switch/router, request that exact filename from this PC's reachable
   LAN address. Use the configured port if it differs from 69. The listen address
   `0.0.0.0` means all IPv4 interfaces, not an address to enter on the router.
4. Stop server when finished. Closing the dialog leaves it running, with a
   persistent top-bar indicator to reopen the controls. Exiting Conxol stops it.

This is an octet/binary, read-only server: WRQ uploads and unshared filenames are
rejected. A private immutable snapshot of the explicitly selected file is held
until server shutdown; changes to the original do not affect active transfers.
There is no directory root to traverse. Paths, separators and control characters
are rejected in requested filenames. No personal folders are enumerated.

The listener and transfer sockets are Rust-owned. Standard block-size, transfer
size and timeout negotiation are supported; block sizes are capped at 1468 bytes
and timeout negotiation at five seconds. Empty files omit the optional tsize
response for interoperability with clients that reject tsize=0. Duplicate RRQs
are coalesced per client endpoint, duplicate/stale ACKs do not advance the file,
and unacknowledged packets have bounded retries. Two transfer workers maximum,
30 minutes per transfer, 100 ms cancellation checks. Stop joins the listener and
workers and releases the selected-file snapshot and UDP sockets.

TFTP has no encryption or authentication. The UI requires explicit sharing
consent and provides an optional source-IP restriction. No firewall settings are
changed automatically. The OS/network must allow the listen port and ephemeral
UDP transfer ports. Privileged ports can require OS permission on Unix.

## FTP/TFTP client boundary

`FileTransferClient.tsx` uses native `file_transfer.rs`, with the platform curl
transport (`System32/curl.exe` on Windows, `/usr/bin/curl` on Unix). The installed
curl must support the selected protocol. Missing/unsupported transports return an
error. FTP paths are relative to the login directory. Select a listing name and
use List folder or Download. Native single-file/destination pickers own selection.

Passwords remain transient and reach curl via stdin configuration, never process
arguments or disk. Default curlrc/netrc, proxies and certificate overrides are
disabled. FTP passive data connections use the control host. Plain FTP/TFTP
require explicit consent. Uploads require consent to replace the remote file;
interrupted remote uploads may leave partial files. Existing local destinations
are refused, and temporary downloads are promoted without clobber only after
success. Uploads use bounded private snapshots. Client concurrency is two jobs;
FTP listings are limited to 1 MiB and 10000 entries. App exit cancels client jobs.

## Local validation

`cargo xtask test-file-transfers` runs both client and server tests in isolated
homes. Fixtures use only OS-assigned loopback ports, disposable files and synthetic
credentials. Tests cover FTP list/upload/download, FTPS refusal to fall back to
plaintext, TFTP empty/exact-block/multi-block transfers and transfer-port changes,
negotiation, a file above 32 MiB crossing block-number rollover, stale ACK retries,
selected-file snapshots, path/WRQ refusal, IP restrictions, concurrency bounds,
stop during transfer and port release, local no-clobber and cancellation cleanup.

Verified on Windows: native protocol fixtures, frontend unit tests, TypeScript,
lint and frontend build. Real router/switch acceptance, successful FTPS TLS
handshake, firewall behavior and non-Windows runtime remain separate checks.
No release binaries/installers or version bump were created for this feature.
