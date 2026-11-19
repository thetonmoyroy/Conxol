# SFTP external editors

On desktop, select a regular file in the SFTP sidebar and use **Edit selected
file in external editor**, or right-click and choose **Edit in external editor**.
The full Remote files view has an external-editor action on each regular file.
The file opens directly in the selected editor. On first use, a native picker
asks for the editor executable, for example `notepad++.exe`. The choice is
saved in the workspace's machine-local `external-editor.json` and reused after
restart. If the executable is removed or moved, the picker appears again.
Launch failures show retry and editor selection. Executable preferences are not
exported in workspace backups, since another machine may have different programs.

Normal editing has no persistent panel. Files are watched quietly in the
background; an attention panel appears only for errors or cleanup warnings.
Multiple files can be edited at once, up to the native eight-file bound.
Saves settle across two 1.2-second checks before
uploading through the existing SFTP revision check and recovery-copy save path.
The local copy is UTF-8; remote UTF-8 or Windows-1252 encoding is retained on
upload. Files are limited to 4 MiB. Android does not offer this action.

Read/upload errors and connection generation changes
pause syncing and preserve the local copy. There is no automatic overwrite on a
remote conflict: use Save As in the external editor to preserve the local work,
then reopen the remote file and reconcile the changes. Workspace lock suspends
checks. An upload already submitted may finish before a pause or lock.

Notepad++ launches with `-multiInst -nosession` in a dedicated window. Closing
that window triggers a final file check and upload of any last save before
temporary-file cleanup. Failures retain the local copy for recovery. Closing a
tab while its editor window remains open does not signal process exit.
Other editors may hand files to existing processes; their launcher exit is not
treated as file closure. These files remain watched silently until app shutdown.
Temporary directories are removed on normal shutdown; an app crash can leave a
temporary directory behind. Error-panel Stop asks before deleting the local copy.

Run `cargo xtask test-external-editor` for isolated bounded UTF-8 local-file
checks (plus symlink refusal on Unix). Run frontend unit, type and lint checks
for shared editor behavior. Manual acceptance uses a disposable loopback SSH
fixture: select an installed editor, save twice, confirm remote content, modify
the remote fixture independently and verify conflict refusal, then test pause,
disconnect/reconnect, lock/unlock and Stop cleanup. Never use real credentials
or production files for automated verification.
