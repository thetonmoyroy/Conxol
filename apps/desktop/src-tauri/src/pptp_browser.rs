//! A separate, unprivileged webview behind a tunnel-only SOCKS5 proxy.
use conxol_pptp::transport::Connector;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::{io, net::Ipv4Addr, time::Duration};
use tauri::{Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

type Shared = Arc<Mutex<BrowserSnapshot>>;
#[derive(Default)]
pub struct BrowserManager(Mutex<HashMap<String, Shared>>);
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSnapshot {
    url: String,
    title: String,
    active_tab: String,
    tabs: Vec<BrowserTab>,
    #[serde(skip)]
    proxy_port: u16,
    #[serde(skip)]
    data_directory: std::path::PathBuf,
    profile_id: String,
    profile_name: String,
    tunnel_server: String,
    loading: bool,
    navigation_error: String,
    http_status: Option<i32>,
    devtools_available: bool,
    diagnostics: bool,
    error: String,
    events: VecDeque<Trace>,
}
#[derive(Clone, Serialize)]
struct BrowserTab {
    id: String,
    url: String,
    title: String,
    loading: bool,
    error: String,
    http_status: Option<i32>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Trace {
    sequence: u64,
    host: String,
    ip: String,
    port: u16,
    stage: String,
    detail: String,
    elapsed_ms: u128,
}
fn trace(
    state: &Shared,
    host: &str,
    ip: &str,
    port: u16,
    stage: &str,
    detail: &str,
    started: std::time::Instant,
) {
    let mut state = state.lock().unwrap();
    let sequence = state.events.back().map_or(1, |e| e.sequence + 1);
    if state.events.len() >= 128 {
        state.events.pop_front();
    }
    let ip = if ip.is_empty() && stage == "Failed" {
        state
            .events
            .iter()
            .rev()
            .find(|event| event.host == host && event.port == port && !event.ip.is_empty())
            .map(|event| event.ip.clone())
            .unwrap_or_default()
    } else {
        ip.into()
    };
    state.events.push_back(Trace {
        sequence,
        host: host.into(),
        ip,
        port,
        stage: stage.into(),
        detail: detail.into(),
        elapsed_ms: started.elapsed().as_millis(),
    });
    if stage == "Failed" {
        state.error = format!("{host}:{port}: {detail}");
    }
}
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn resize_content(child: &tauri::Webview, diagnostics: bool) -> tauri::Result<()> {
    let size = child.window().inner_size()?;
    let scale = child.window().scale_factor()?;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    child.set_bounds(tauri::Rect {
        position: tauri::LogicalPosition::new(0., 100.).into(),
        size: tauri::LogicalSize::new(
            (width - if diagnostics { 360. } else { 0. }).max(100.),
            (height - 128.).max(50.),
        )
        .into(),
    })
}

struct ProxyTask(
    tauri::async_runtime::JoinHandle<()>,
    tauri::AppHandle,
    String,
);
impl Drop for ProxyTask {
    fn drop(&mut self) {
        self.0.abort();
        self.1
            .state::<BrowserManager>()
            .0
            .lock()
            .unwrap()
            .remove(&self.2);
    }
}

fn invalid() -> io::Error {
    io::Error::other("PPTP browser request failed")
}

async fn resolve(connector: &Connector, host: &str) -> io::Result<Ipv4Addr> {
    if let Ok(ip) = host.parse() {
        return Ok(ip);
    }
    use hickory_proto::{
        op::{Message, MessageType, Query},
        rr::{Name, RData, RecordType},
    };
    let mut query = Message::query();
    query.metadata.id =
        u16::from_be_bytes(uuid::Uuid::new_v4().as_bytes()[..2].try_into().unwrap());
    query.metadata.recursion_desired = true;
    let mut name = Name::from_ascii(host).map_err(|_| invalid())?;
    name.set_fqdn(true);
    query.add_query(Query::query(name, RecordType::A));
    let wire = query.to_vec().map_err(|_| invalid())?;
    let mut dns = connector.connect("8.8.8.8", 53).await?;
    dns.write_u16(wire.len() as u16).await?;
    dns.write_all(&wire).await?;
    let len = dns.read_u16().await? as usize;
    let mut bytes = vec![0; len];
    dns.read_exact(&mut bytes).await?;
    let reply = Message::from_vec(&bytes).map_err(|_| invalid())?;
    if reply.metadata.id != query.metadata.id
        || reply.metadata.message_type != MessageType::Response
        || reply.metadata.truncation
        || reply.queries != query.queries
    {
        return Err(invalid());
    }
    reply
        .answers
        .iter()
        .find_map(|r| match &r.data {
            RData::A(a) => Some(a.0),
            _ => None,
        })
        .ok_or_else(invalid)
}

async fn serve(
    mut socket: tokio::net::TcpStream,
    connector: Connector,
    state: Option<Shared>,
) -> io::Result<()> {
    let mut header = [0; 2];
    socket.read_exact(&mut header).await?;
    if header[0] != 5 {
        return Err(invalid());
    }
    let mut methods = vec![0; header[1] as usize];
    socket.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        return Err(invalid());
    }
    socket.write_all(&[5, 0]).await?;
    let mut request = [0; 4];
    socket.read_exact(&mut request).await?;
    if request[..3] != [5, 1, 0] {
        return Err(invalid());
    }
    let host = match request[3] {
        1 => {
            let mut bytes = [0; 4];
            socket.read_exact(&mut bytes).await?;
            Ipv4Addr::from(bytes).to_string()
        }
        3 => {
            let len = socket.read_u8().await?;
            let mut bytes = vec![0; len as usize];
            socket.read_exact(&mut bytes).await?;
            String::from_utf8(bytes).map_err(|_| invalid())?
        }
        _ => return Err(invalid()),
    };
    let port = socket.read_u16().await?;
    let started = std::time::Instant::now();
    if let Some(state) = &state {
        trace(
            state,
            &host,
            "",
            port,
            "Resolving",
            "DNS over PPTP · 8.8.8.8:53 (IPv4 literals skip DNS)",
            started,
        );
    }
    let mut ip = String::new();
    let connected = tokio::time::timeout(Duration::from_secs(30), async {
        let target = resolve(&connector, &host)
            .await
            .map_err(|e| io::Error::new(e.kind(), format!("DNS resolution failed: {e}")))?;
        ip = target.to_string();
        if let Some(state) = &state {
            trace(
                state,
                &host,
                &ip,
                port,
                "Connecting",
                "Opening TCP through selected PPTP tunnel",
                started,
            );
        }
        connector
            .connect(&ip, port)
            .await
            .map_err(|e| io::Error::new(e.kind(), format!("Tunnel TCP connection failed: {e}")))
    })
    .await;
    let mut remote = match connected {
        Ok(Ok(remote)) => remote,
        failure => {
            let detail = match failure {
                Ok(Err(e)) => e.to_string(),
                _ => "DNS or TCP connection timed out after 30 seconds".into(),
            };
            if let Some(state) = &state {
                trace(state, &host, &ip, port, "Failed", &detail, started);
            }
            socket.write_all(&[5, 4, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
            return Err(invalid());
        }
    };
    socket.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
    if let Some(state) = &state {
        trace(
            state,
            &host,
            &ip,
            port,
            "Connected",
            "TCP established · forwarding browser traffic",
            started,
        );
    }
    match tokio::io::copy_bidirectional(&mut socket, &mut remote).await {
        Ok((sent, received)) => {
            if let Some(state) = &state {
                trace(
                    state,
                    &host,
                    &ip,
                    port,
                    "Closed",
                    &format!("{sent} bytes sent · {received} bytes received"),
                    started,
                );
            }
        }
        Err(e) => {
            if let Some(state) = &state {
                trace(
                    state,
                    &host,
                    &ip,
                    port,
                    "Failed",
                    &format!("Forwarding interrupted: {e}"),
                    started,
                );
            }
            return Err(e);
        }
    }
    Ok(())
}

fn web_url(input: &str) -> Result<tauri::Url, String> {
    if input.len() > 8192 {
        return Err("URL must be at most 8192 bytes.".into());
    }
    let url = tauri::Url::parse(input).map_err(|_| "Enter a valid HTTP or HTTPS URL.")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only HTTP and HTTPS URLs without embedded credentials are supported.".into());
    }
    Ok(url)
}

fn remove_tab(snapshot: &mut BrowserSnapshot, id: &str) -> Result<(), String> {
    let index = snapshot
        .tabs
        .iter()
        .position(|tab| tab.id == id)
        .ok_or("Tab not found")?;
    if snapshot.tabs.len() <= 1 {
        return Err("Close the browser window to close its final tab".into());
    }
    snapshot.tabs.remove(index);
    if snapshot.active_tab == id {
        snapshot.active_tab = snapshot.tabs[index.min(snapshot.tabs.len() - 1)].id.clone();
    }
    Ok(())
}

fn show_active(app: &tauri::AppHandle, state: &Shared) -> Result<(), String> {
    let (tabs, active, diagnostics) = {
        let state = state.lock().unwrap();
        (
            state.tabs.clone(),
            state.active_tab.clone(),
            state.diagnostics,
        )
    };
    for tab in tabs {
        if let Some(child) = app.get_webview(&tab.id) {
            if tab.id == active {
                resize_content(&child, diagnostics).map_err(|e| e.to_string())?;
                child.show().map_err(|e| e.to_string())?;
            } else {
                child.hide().map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn create_tab(
    app: &tauri::AppHandle,
    label: &str,
    state: &Shared,
    destination: &str,
) -> Result<(), String> {
    let destination = web_url(destination)?;
    let id = format!("{label}-content-{}", uuid::Uuid::new_v4());
    let (port, directory) = {
        let mut snapshot = state.lock().unwrap();
        if snapshot.tabs.len() >= 12 {
            return Err("This browser supports up to 12 tabs. Close a tab to open another.".into());
        }
        snapshot.tabs.push(BrowserTab {
            id: id.clone(),
            url: destination.to_string(),
            title: "New tab".into(),
            loading: true,
            error: String::new(),
            http_status: None,
        });
        (snapshot.proxy_port, snapshot.data_directory.clone())
    };
    let navigation_state = state.clone();
    let navigation_id = id.clone();
    let load_state = state.clone();
    let load_id = id.clone();
    let title_state = state.clone();
    let title_id = id.clone();
    let child = tauri::webview::WebviewBuilder::new(&id, tauri::WebviewUrl::External(destination))
        .proxy_url(tauri::Url::parse(&format!("socks5://127.0.0.1:{port}")).unwrap())
        .data_directory(directory).incognito(true)
        // Additional arguments replace Wry's generated proxy arguments.
        .additional_browser_args(&format!("--proxy-server=socks5://127.0.0.1:{port} --proxy-bypass-list=<-loopback> --force-webrtc-ip-handling-policy=disable_non_proxied_udp --disable-quic --disable-background-networking --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,DnsOverHttps,AsyncDns --host-resolver-rules=\"MAP * ~NOTFOUND, EXCLUDE 127.0.0.1\""))
        .on_navigation(move |url| {
            if !matches!(url.scheme(), "http" | "https") { return false; }
            let mut snapshot = navigation_state.lock().unwrap();
            if let Some(tab) = snapshot.tabs.iter_mut().find(|tab| tab.id == navigation_id) { tab.url = url.as_str().chars().take(8192).collect(); tab.loading = true; tab.error.clear(); tab.http_status = None; }
            true
        })
        .on_page_load(move |_, payload| {
            if let Some(tab) = load_state.lock().unwrap().tabs.iter_mut().find(|tab| tab.id == load_id) {
                tab.loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
                if matches!(payload.url().scheme(), "http" | "https") { tab.url = payload.url().as_str().chars().take(8192).collect(); }
            }
        })
        .on_document_title_changed(move |_, title| { if let Some(tab) = title_state.lock().unwrap().tabs.iter_mut().find(|tab| tab.id == title_id) { tab.title = title.chars().take(256).collect(); } })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    let result = app
        .get_window(label)
        .ok_or("Browser window unavailable")?
        .add_child(
            child,
            tauri::LogicalPosition::new(0., 100.),
            tauri::LogicalSize::new(800., 600.),
        );
    if let Err(error) = result {
        state.lock().unwrap().tabs.retain(|tab| tab.id != id);
        return Err(error.to_string());
    }
    #[cfg(windows)]
    attach_navigation_diagnostics(
        &app.get_webview(&id).ok_or("Tab unavailable")?,
        state.clone(),
        id.clone(),
    )
    .map_err(|e| e.to_string())?;
    state.lock().unwrap().active_tab = id;
    show_active(app, state)
}

#[cfg(windows)]
fn attach_navigation_diagnostics(
    child: &tauri::Webview,
    state: Shared,
    id: String,
) -> tauri::Result<()> {
    child.with_webview(move |platform| {
        use webview2_com::{Microsoft::Web::WebView2::Win32::*, NavigationCompletedEventHandler};
        use windows::core::Interface;
        // All COM calls and callbacks stay on WebView2's owning UI thread.
        let hook_state = state.clone();
        let hook_id = id.clone();
        let result = (|| -> windows::core::Result<()> {
            unsafe {
                let core = platform.controller().CoreWebView2()?;
                let mut token = 0;
                core.add_NavigationCompleted(
                    &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                        if let Some(args) = args {
                            let mut success = Default::default();
                            args.IsSuccess(&mut success)?;
                            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                            args.WebErrorStatus(&mut status)?;
                            let mut http = 0;
                            if let Ok(args) =
                                args.cast::<ICoreWebView2NavigationCompletedEventArgs2>()
                            {
                                let _ = args.HttpStatusCode(&mut http);
                            }
                            let failure = if !success.as_bool() {
                                format!("WebView2 navigation failed: {status:?}")
                            } else if http >= 400 {
                                format!("Server returned HTTP {http}")
                            } else {
                                String::new()
                            };
                            let url = {
                                let mut snapshot = state.lock().unwrap();
                                if let Some(tab) = snapshot.tabs.iter_mut().find(|tab| tab.id == id)
                                {
                                    tab.loading = false;
                                    tab.http_status = (http > 0).then_some(http);
                                    tab.error = failure.clone();
                                    tab.url.clone()
                                } else {
                                    return Ok(());
                                }
                            };
                            if !failure.is_empty() {
                                if let Ok(url) = tauri::Url::parse(&url) {
                                    trace(
                                        &state,
                                        url.host_str().unwrap_or("Unknown host"),
                                        "",
                                        url.port_or_known_default().unwrap_or(0),
                                        "Failed",
                                        &format!("{failure} · URL: {url}"),
                                        std::time::Instant::now(),
                                    );
                                }
                            }
                        }
                        Ok(())
                    })),
                    &mut token,
                )?;
                Ok(())
            }
        })();
        if let Err(error) = result {
            if let Some(tab) = hook_state
                .lock()
                .unwrap()
                .tabs
                .iter_mut()
                .find(|tab| tab.id == hook_id)
            {
                tab.error = format!("Navigation diagnostics unavailable: {error}");
            }
        }
    })
}

#[tauri::command]
pub async fn pptp_browser_open(
    app: tauri::AppHandle,
    pptp: State<'_, crate::pptp::PptpManager>,
    id: uuid::Uuid,
    url: Option<String>,
) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("The PPTP browser currently requires Windows WebView2.".into());
    }
    if app
        .state::<crate::workspace_lock::WorkspaceLock>()
        .is_locked()
    {
        return Err("Unlock the workspace first.".into());
    }
    let destination = url.as_deref().unwrap_or("https://www.google.com");
    web_url(destination)?;
    let connector = pptp.connector(id)?;
    let (profile_name, tunnel_server) = pptp.browser_route(id)?;
    let label = format!("pptp-browser-{id}");
    if let Some(window) = app.get_webview_window(&label) {
        if url.is_some() {
            let state = app
                .state::<BrowserManager>()
                .0
                .lock()
                .unwrap()
                .get(&label)
                .cloned()
                .ok_or("Browser state unavailable")?;
            create_tab(&app, &label, &state, destination)?;
        }
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let directory = tempfile::tempdir().map_err(|e| e.to_string())?;
    let data_directory = directory.path().to_path_buf();
    let state = Arc::new(Mutex::new(BrowserSnapshot {
        url: "https://www.google.com".into(),
        title: "New page".into(),
        active_tab: String::new(),
        tabs: Vec::new(),
        proxy_port: port,
        data_directory,
        profile_id: id.to_string(),
        profile_name,
        tunnel_server,
        loading: true,
        navigation_error: String::new(),
        http_status: None,
        devtools_available: true,
        diagnostics: true,
        error: String::new(),
        events: VecDeque::new(),
    }));
    app.state::<BrowserManager>()
        .0
        .lock()
        .unwrap()
        .insert(label.clone(), state.clone());
    let proxy_state = state.clone();

    // Accept proxy connections before WebView2 starts its first navigation.
    let proxy_app = app.clone();
    let proxy_label = label.clone();
    let proxy_task = ProxyTask(
        tauri::async_runtime::spawn(async move {
            let _directory = directory;
            let mut clients = tokio::task::JoinSet::new();
            let mut health = tokio::time::interval(Duration::from_millis(250));
            loop {
                tokio::select! {
                    _ = health.tick() => {
                        if proxy_app.state::<crate::workspace_lock::WorkspaceLock>().is_locked()
                            || proxy_app.state::<crate::pptp::PptpManager>().connector(id).is_err() {
                            if let Some(window) = proxy_app.get_webview_window(&proxy_label) { let _ = window.close(); }
                            break;
                        }
                    },
                    Some(_) = clients.join_next(), if !clients.is_empty() => {},
                    accepted = listener.accept(), if clients.len() < 48 => {
                        match accepted {
                            Ok((socket, _)) => {
                                let connector = connector.clone();
                                let state = proxy_state.clone();
                                clients.spawn(async move {
                                    let _ = tokio::time::timeout(Duration::from_secs(300), serve(socket, connector, Some(state))).await;
                                });
                            },
                            Err(_) => break,
                        }
                    }
                }
            }
        }),
        app.clone(),
        label.clone(),
    );
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App("index.html?pptp-browser".into()),
    )
    .title("PPTP browser")
    .inner_size(1280., 820.)
    .min_inner_size(800., 500.)
    .build()
    .map_err(|e| e.to_string())?;
    if let Err(error) = create_tab(&app, &label, &state, destination) {
        let _ = window.close();
        return Err(error);
    }
    let resize_app = app.clone();
    let resize_state = state.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
        ) {
            let state = resize_state.lock().unwrap();
            for tab in &state.tabs {
                if let Some(child) = resize_app.get_webview(&tab.id) {
                    let _ = resize_content(&child, state.diagnostics);
                }
            }
        }
    });
    let proxy_task = std::sync::Mutex::new(Some(proxy_task));
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            proxy_task.lock().unwrap().take();
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn pptp_browser_navigate(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    url: String,
) -> Result<(), String> {
    let state = browser_state(&app, &webview)?;
    let url = web_url(&url)?;
    let active = state.lock().unwrap().active_tab.clone();
    app.get_webview(&active)
        .ok_or("Browser closed")?
        .navigate(url)
        .map_err(|e| e.to_string())
}

/// Open the persisted bookmark, never a renderer-supplied replacement route.
#[tauri::command]
pub async fn session_open_web(
    app: tauri::AppHandle,
    store: State<'_, Mutex<conxol_store::SessionStore>>,
    pptp: State<'_, crate::pptp::PptpManager>,
    vault: State<'_, crate::workspace_lock::NativeVault>,
    session_id: conxol_core::SessionId,
) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("Saved Web sessions currently require Windows WebView2.".into());
    }
    let session = store
        .lock()
        .map_err(|_| "Session store unavailable")?
        .list()
        .iter()
        .find(|session| session.id == session_id)
        .cloned()
        .ok_or("Saved Web session not found")?;
    if session.protocol != conxol_core::Protocol::Web {
        return Err("Select a saved Web session.".into());
    }
    session.validate().map_err(|error| error.to_string())?;
    let profile_id = session
        .pptp_profile_id
        .ok_or("Assign a PPTP profile to this Web session.")?;
    pptp.ensure_connected(profile_id, &vault).await?;
    pptp_browser_open(app, pptp, profile_id, Some(session.hostname)).await
}

fn browser_state(app: &tauri::AppHandle, webview: &tauri::Webview) -> Result<Shared, String> {
    let label = webview.label();
    if !label.starts_with("pptp-browser-") || label.contains("-content") {
        return Err("Browser toolbar required".into());
    }
    app.state::<BrowserManager>()
        .0
        .lock()
        .unwrap()
        .get(label)
        .cloned()
        .ok_or("Browser closed".into())
}

#[tauri::command]
pub fn pptp_browser_snapshot(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<BrowserSnapshot, String> {
    let mut snapshot = browser_state(&app, &webview)?.lock().unwrap().clone();
    if let Some(tab) = snapshot
        .tabs
        .iter()
        .find(|tab| tab.id == snapshot.active_tab)
    {
        snapshot.url = tab.url.clone();
        snapshot.title = tab.title.clone();
        snapshot.loading = tab.loading;
        snapshot.navigation_error = tab.error.clone();
        snapshot.http_status = tab.http_status;
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn pptp_browser_control(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    action: String,
    tab_id: Option<String>,
) -> Result<(), String> {
    let state = browser_state(&app, &webview)?;
    if action == "new_tab" {
        return create_tab(&app, webview.label(), &state, "https://www.google.com");
    }
    if action == "select_tab" || action == "close_tab" {
        let id = tab_id.ok_or("Tab required")?;
        {
            let state = state.lock().unwrap();
            if !state.tabs.iter().any(|tab| tab.id == id) {
                return Err("Tab not found".into());
            }
        }
        if action == "close_tab" {
            // Closing the final tab closes only this browser window.
            if state.lock().unwrap().tabs.len() == 1 {
                return webview.window().close().map_err(|e| e.to_string());
            }
            if let Some(child) = app.get_webview(&id) {
                child.close().map_err(|e| e.to_string())?;
            }
            let mut snapshot = state.lock().unwrap();
            remove_tab(&mut snapshot, &id)?;
        } else {
            state.lock().unwrap().active_tab = id;
        }
        return show_active(&app, &state);
    }
    let active = state.lock().unwrap().active_tab.clone();
    let child = app.get_webview(&active).ok_or("Browser closed")?;
    let result = match action.as_str() {
        "devtools" => {
            child.open_devtools();
            Ok(())
        }
        "back" => child.eval("window.history.back()"),
        "forward" => child.eval("window.history.forward()"),
        "reload" => {
            state.lock().unwrap().error.clear();
            child.reload()
        }
        "stop" => {
            if let Some(tab) = state
                .lock()
                .unwrap()
                .tabs
                .iter_mut()
                .find(|tab| tab.id == active)
            {
                tab.loading = false;
            }
            child.eval("window.stop()")
        }
        "diagnostics" => {
            let mut state = state.lock().unwrap();
            state.diagnostics = !state.diagnostics;
            resize_content(&child, state.diagnostics)
        }
        "clear" => {
            let mut state = state.lock().unwrap();
            state.events.clear();
            state.error.clear();
            Ok(())
        }
        _ => return Err("Unknown browser action".into()),
    };
    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> BrowserSnapshot {
        BrowserSnapshot {
            active_tab: "b".into(),
            tabs: ["a", "b", "c"]
                .into_iter()
                .map(|id| BrowserTab {
                    id: id.into(),
                    url: format!("http://{id}.example/"),
                    title: id.into(),
                    loading: false,
                    error: String::new(),
                    http_status: None,
                })
                .collect(),
            ..Default::default()
        }
    }

    #[test]
    fn closing_tabs_keeps_valid_selection_and_independent_urls() {
        let mut state = fixture();
        remove_tab(&mut state, "a").unwrap();
        assert_eq!(state.active_tab, "b");
        assert_eq!(state.tabs[0].url, "http://b.example/");
        remove_tab(&mut state, "b").unwrap();
        assert_eq!(state.active_tab, "c");
        assert!(remove_tab(&mut state, "c").is_err());
        assert_eq!(state.tabs.len(), 1);
        assert!(remove_tab(&mut state, "unknown").is_err());
    }

    #[test]
    fn diagnostics_are_bounded_and_preserve_resolved_ip_on_navigation_error() {
        let state = Arc::new(Mutex::new(fixture()));
        let started = std::time::Instant::now();
        for _ in 0..150 {
            trace(
                &state,
                "router.example",
                "192.0.2.1",
                80,
                "Connected",
                "TCP established",
                started,
            );
        }
        trace(
            &state,
            "router.example",
            "",
            80,
            "Failed",
            "HTTP 500",
            started,
        );
        let state = state.lock().unwrap();
        assert_eq!(state.events.len(), 128);
        assert_eq!(state.events.back().unwrap().ip, "192.0.2.1");
        assert_eq!(state.events.back().unwrap().sequence, 151);
        assert!(state.error.contains("HTTP 500"));
    }

    #[test]
    fn navigation_rejects_non_web_urls_and_credentials() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://user:secret@example.com",
            "not a URL",
        ] {
            assert!(web_url(url).is_err());
        }
        assert_eq!(web_url("http://192.0.2.1:8080/").unwrap().scheme(), "http");
    }

    #[tokio::test]
    async fn socks_handshake_fails_closed_without_tunnel() {
        // A disposable loopback proxy and a disconnected synthetic connector.
        // Never connect a host socket to the requested destination.
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let (connector, router) = conxol_pptp::transport::TcpRouter::new();
        drop(router);
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            serve(socket, connector, None).await
        });
        let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
        client.write_all(&[5, 1, 0]).await.unwrap();
        let mut greeting = [0; 2];
        client.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 0]);
        client
            .write_all(&[5, 1, 0, 1, 192, 0, 2, 1, 0, 80])
            .await
            .unwrap();
        let mut reply = [0; 10];
        tokio::time::timeout(Duration::from_secs(2), client.read_exact(&mut reply))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reply, [5, 4, 0, 1, 0, 0, 0, 0, 0, 0]);
        assert!(server.await.unwrap().is_err());
    }
}

// Child webviews and their proxy/bounds APIs are desktop-only in Tauri.
#[cfg(any(target_os = "android", target_os = "ios"))]
fn resize_content(_child: &tauri::Webview, _diagnostics: bool) -> tauri::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "PPTP browser requires Windows WebView2").into())
}
#[cfg(any(target_os = "android", target_os = "ios"))]
fn create_tab(_app: &tauri::AppHandle, _label: &str, _state: &Shared, _destination: &str) -> Result<(), String> {
    Err("PPTP browser requires Windows WebView2".into())
}
