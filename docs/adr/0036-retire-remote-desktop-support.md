# Retire RDP and VNC support

Status: accepted.

Conxol no longer implements RDP or VNC connections. Session creation, connection
links, native IPC commands, rendering/input/clipboard code, helper executables,
their separate workspaces, protocol fuzzing, staging and packaging requirements
have been removed. Supported session types are SSH, Telnet, serial, local shell
and Web; Web sessions use an assigned private PPTP connection.

Existing session libraries must still load without discarding user data. The
`RDP` and `VNC` protocol tags remain readable only for compatibility, and their
`remote_desktop_profile` is preserved as opaque JSON. Old entries show as
unsupported and cannot connect. Rename, folder, favorite and deletion actions
remain available, and backup/export preserves their original metadata. No
retired credentials are read or sent by a connection path.

Historical release notes and test receipts describe earlier versions, not
current capabilities. The removed implementation remains available in Git
history. No replacement remote-desktop engine or external launcher is introduced.
