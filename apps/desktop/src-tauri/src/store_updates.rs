//! Microsoft Store owns update discovery, consent, download and installation.
//! Never use these APIs for sideloaded or standalone desktop installations.
#[tauri::command]
pub async fn store_update_supported(window: tauri::WebviewWindow) -> bool {
    #[cfg(windows)]
    {
        windows_store::on_ui(window, |_| Ok(windows_store::supported()))
            .await
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        false
    }
}

#[tauri::command]
pub async fn store_update(window: tauri::WebviewWindow, install: bool) -> Result<String, String> {
    #[cfg(windows)]
    {
        windows_store::run(window, install).await
    }
    #[cfg(not(windows))]
    {
        let _ = (window, install);
        Ok("unsupported".into())
    }
}

#[cfg(windows)]
mod windows_store {
    use std::sync::atomic::{AtomicBool, Ordering};
    use windows::{
        ApplicationModel::{Package, PackageSignatureKind},
        Services::Store::{StoreContext, StorePackageUpdate, StorePackageUpdateState},
        Win32::{Foundation::HWND, UI::Shell::IInitializeWithWindow},
        core::Interface,
    };

    static BUSY: AtomicBool = AtomicBool::new(false);
    struct BusyGuard;
    impl Drop for BusyGuard {
        fn drop(&mut self) {
            BUSY.store(false, Ordering::Release);
        }
    }

    fn matches_identity(store_signed: bool, name: &str, publisher: &str) -> bool {
        store_signed
            && name == "TonmoyRoy.Conxol"
            && publisher == "CN=26381B29-EA81-454D-B9CC-CEFCA1E6792D"
    }

    pub fn supported() -> bool {
        let Ok(package) = Package::Current() else {
            return false;
        };
        let Ok(id) = package.Id() else {
            return false;
        };
        let (Ok(name), Ok(publisher)) = (id.Name(), id.Publisher()) else {
            return false;
        };
        matches_identity(
            package.SignatureKind().ok() == Some(PackageSignatureKind::Store),
            &name.to_string(),
            &publisher.to_string(),
        )
    }

    // Only create Store UI operations on the owning window's UI thread. Await
    // them off-thread so the native message pump remains responsive.
    pub async fn on_ui<T: Send + 'static>(
        window: tauri::WebviewWindow,
        action: impl FnOnce(tauri::WebviewWindow) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let (send, receive) = tokio::sync::oneshot::channel();
        let owner = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = send.send(action(owner));
            })
            .map_err(|_| "Could not open Microsoft Store update UI.".to_owned())?;
        receive
            .await
            .map_err(|_| "The update window was closed.".to_owned())?
    }

    fn store_error(error: windows::core::Error) -> String {
        format!(
            "Microsoft Store update failed ({}). Try again from Help or Microsoft Store Library.",
            error.code()
        )
    }

    pub async fn run(window: tauri::WebviewWindow, install: bool) -> Result<String, String> {
        if !on_ui(window.clone(), |_| Ok(supported())).await? {
            return Ok("unsupported".into());
        }
        BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                "A Microsoft Store update check or installation is already running.".to_owned()
            })?;
        let _guard = BusyGuard;
        let (context, query) = on_ui(window.clone(), |owner| {
            let context = StoreContext::GetDefault().map_err(store_error)?;
            let hwnd = owner
                .hwnd()
                .map_err(|_| "Update window is unavailable.".to_owned())?;
            // SAFETY: Tauri supplies a live HWND; this runs on its owning thread.
            unsafe {
                context
                    .cast::<IInitializeWithWindow>()
                    .map_err(store_error)?
                    .Initialize(HWND(hwnd.0))
                    .map_err(store_error)?;
            }
            let query = context
                .GetAppAndOptionalStorePackageUpdatesAsync()
                .map_err(store_error)?;
            Ok((context, query))
        })
        .await?;
        let updates = {
            let view = tokio::time::timeout(std::time::Duration::from_secs(30), query)
                .await
                .map_err(|_| {
                    "Microsoft Store update check timed out. Try again from Help.".to_owned()
                })?
                .map_err(store_error)?;
            let count = view.Size().map_err(store_error)?;
            let mut items = Vec::new();
            for index in 0..count {
                items.push(Some(view.GetAt(index).map_err(store_error)?));
            }
            items
        };
        if updates.is_empty() {
            return Ok("upToDate".into());
        }
        if !install {
            return Ok("available".into());
        }
        let operation = on_ui(window, move |owner| {
            use tauri::Manager;
            if !owner
                .state::<crate::workspace_lock::WorkspaceLock>()
                .allows("store_update")
            {
                return Err("Workspace is locked. Unlock before updating.".into());
            }
            let iterable: windows_collections::IIterable<StorePackageUpdate> = updates.into();
            context
                .RequestDownloadAndInstallStorePackageUpdatesAsync(&iterable)
                .map_err(store_error)
        })
        .await?;
        // This is intentionally the consent-based API, never a silent install.
        let result = operation.await.map_err(store_error)?;
        update_result(result.OverallState().map_err(store_error)?)
    }

    fn update_result(state: StorePackageUpdateState) -> Result<String, String> {
        match state {
            StorePackageUpdateState::Completed => Ok("completed".into()),
            StorePackageUpdateState::Canceled => Ok("canceled".into()),
            StorePackageUpdateState::ErrorLowBattery => Err("Charge your device before installing the Store update.".into()),
            StorePackageUpdateState::ErrorWiFiRequired | StorePackageUpdateState::ErrorWiFiRecommended =>
                Err("Connect to Wi-Fi and retry the Store update.".into()),
            _ => Err("Microsoft Store could not finish the update. Try again from Microsoft Store Library.".into()),
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn only_exact_store_signed_identity_is_eligible() {
            let publisher = "CN=26381B29-EA81-454D-B9CC-CEFCA1E6792D";
            assert!(matches_identity(true, "TonmoyRoy.Conxol", publisher));
            assert!(!matches_identity(false, "TonmoyRoy.Conxol", publisher));
            assert!(!matches_identity(true, "Other.App", publisher));
            assert!(!matches_identity(true, "TonmoyRoy.Conxol", "CN=Other"));
        }
        #[test]
        fn cancellation_and_install_failures_never_report_success() {
            assert_eq!(
                update_result(StorePackageUpdateState::Completed).unwrap(),
                "completed"
            );
            assert_eq!(
                update_result(StorePackageUpdateState::Canceled).unwrap(),
                "canceled"
            );
            for state in [
                StorePackageUpdateState::Pending,
                StorePackageUpdateState::Downloading,
                StorePackageUpdateState::Deploying,
                StorePackageUpdateState::OtherError,
                StorePackageUpdateState::ErrorLowBattery,
                StorePackageUpdateState::ErrorWiFiRequired,
                StorePackageUpdateState::ErrorWiFiRecommended,
                StorePackageUpdateState(999),
            ] {
                assert!(update_result(state).is_err());
            }
        }
        #[test]
        fn single_flight_guard_is_released_on_drop() {
            assert!(
                BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            );
            let guard = BusyGuard;
            assert!(
                BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_err()
            );
            drop(guard);
            assert!(!BUSY.load(Ordering::Acquire));
        }
    }
}
