use std::ffi::c_void;
use std::path::{Path, PathBuf};
use windows::core::{implement, BOOL, GUID, HRESULT, IUnknown, Interface, PCWSTR, PWSTR, Ref};
use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, E_FAIL, E_POINTER, S_FALSE, S_OK};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW, HKEY,
    HKEY_LOCAL_MACHINE, KEY_ALL_ACCESS, REG_OPTION_NON_VOLATILE, REG_SZ,
};
use windows::Win32::UI::Shell::{IShellIconOverlayIdentifier, IShellIconOverlayIdentifier_Impl};

// Make windows_core available for windows::core macros
pub use windows::core as windows_core;

// CLSID: {55F87E2C-255B-4C2E-893A-A7E004B50341}
pub const CLSID_COWLINK_OVERLAY: GUID = GUID::from_u128(0x55f87e2c_255b_4c2e_893a_a7e004b50341);
pub const CLSID_STR: &str = "{55F87E2C-255B-4C2E-893A-A7E004B50341}";
pub const OVERLAY_REG_NAME: &str = "   A8CowFsOverlay";

#[derive(Default)]
#[implement(IShellIconOverlayIdentifier)]
struct CowlinkOverlay;

impl IShellIconOverlayIdentifier_Impl for CowlinkOverlay_Impl {
    fn IsMemberOf(&self, pwszpath: &PCWSTR, _dwattrib: u32) -> windows::core::Result<()> {
        let path_str = unsafe { pwszpath.to_string() }.unwrap_or_default();
        if is_registered_workspace(&path_str) {
            Ok(())
        } else {
            Err(windows::core::Error::from(S_FALSE))
        }
    }

    fn GetOverlayInfo(&self, pwsziconfile: PWSTR, cchmax: i32, pindex: *mut i32, pdwflags: *mut u32) -> windows::core::Result<()> {
        if pindex.is_null() || pdwflags.is_null() || pwsziconfile.is_null() {
            return Err(windows::core::Error::from(E_POINTER));
        }

        let icon_path = resolve_icon_path();
        let wide: Vec<u16> = icon_path.encode_utf16().chain(std::iter::once(0)).collect();

        if wide.len() as i32 > cchmax {
            return Err(windows::core::Error::from(E_FAIL));
        }

        unsafe {
            std::ptr::copy_nonoverlapping(wide.as_ptr(), pwsziconfile.as_ptr(), wide.len());
            *pindex = 0;
            // ISIOI_ICONFILE (0x00000001) | ISIOI_ICONINDEX (0x00000002)
            *pdwflags = 0x00000001 | 0x00000002;
        }

        Ok(())
    }

    fn GetPriority(&self) -> windows::core::Result<i32> {
        Ok(0)
    }
}

fn resolve_icon_path() -> String {
    let candidates = [
        r"E:\a8-devtools\modules\devtools\icons\folder-workspace.ico",
        r"E:\a8-devtools\modules\devtools\icons\icon.ico",
        r"E:\a8-devtools\target\release\a8-devtools.exe",
        r"E:\a8-devtools\target\debug\a8-devtools.exe",
    ];
    for p in &candidates {
        if Path::new(p).exists() {
            return p.to_string();
        }
    }
    r"E:\a8-devtools\modules\devtools\icons\folder-workspace.ico".to_string()
}

fn is_registered_workspace(path: &str) -> bool {
    let target = Path::new(path);
    if !target.is_dir() {
        return false;
    }

    let base = match std::env::var("LOCALAPPDATA") {
        Ok(b) => PathBuf::from(b),
        Err(_) => return false,
    };
    let workspaces_root = base.join("cowlink").join("workspaces");
    if !workspaces_root.exists() {
        return false;
    }

    if let Ok(entries) = std::fs::read_dir(workspaces_root) {
        let norm_path = path.trim_end_matches('\\').to_lowercase();
        for entry in entries.flatten() {
            let meta_file = entry.path().join("meta.json");
            if let Ok(content) = std::fs::read_to_string(&meta_file) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(target_dir) = v.get("target_dir").and_then(|t| t.as_str()) {
                        if target_dir.trim_end_matches('\\').to_lowercase() == norm_path {
                            return true;
                        }
                    }
                }
            }
        }
    }

    false
}

#[derive(Default)]
#[implement(IClassFactory)]
struct CowlinkClassFactory;

impl IClassFactory_Impl for CowlinkClassFactory_Impl {
    fn CreateInstance(&self, punkouter: Ref<'_, IUnknown>, riid: *const GUID, ppvobject: *mut *mut c_void) -> windows::core::Result<()> {
        if punkouter.is_some() {
            return Err(windows::core::Error::from(CLASS_E_CLASSNOTAVAILABLE));
        }
        if ppvobject.is_null() || riid.is_null() {
            return Err(windows::core::Error::from(E_POINTER));
        }

        let overlay: IShellIconOverlayIdentifier = CowlinkOverlay.into();
        unsafe {
            overlay.query(riid, ppvobject).ok()
        }
    }

    fn LockServer(&self, _flock: BOOL) -> windows::core::Result<()> {
        Ok(())
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn DllGetClassObject(rclsid: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> HRESULT {
    if rclsid.is_null() || riid.is_null() || ppv.is_null() {
        return E_POINTER;
    }

    unsafe {
        if *rclsid != CLSID_COWLINK_OVERLAY {
            return CLASS_E_CLASSNOTAVAILABLE;
        }

        let factory: IClassFactory = CowlinkClassFactory.into();
        factory.query(riid, ppv)
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_OK
}

static mut G_HMODULE: windows::Win32::Foundation::HMODULE =
    windows::Win32::Foundation::HMODULE(std::ptr::null_mut());

#[unsafe(no_mangle)]
pub unsafe extern "system" fn DllMain(
    hinst_dll: windows::Win32::Foundation::HINSTANCE,
    fdw_reason: u32,
    _lpv_reserved: *mut c_void,
) -> BOOL {
    if fdw_reason == 1 {
        // DLL_PROCESS_ATTACH
        unsafe {
            G_HMODULE = windows::Win32::Foundation::HMODULE(hinst_dll.0);
        }
    }
    BOOL(1)
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn DllRegisterServer() -> HRESULT {
    let mut dll_path = [0u16; 260];
    let len = unsafe { GetModuleFileNameW(Some(G_HMODULE), &mut dll_path) };
    if len == 0 {
        return E_FAIL;
    }
    let dll_str = String::from_utf16_lossy(&dll_path[..len as usize]);

    // Try HKLM first; if access denied, fallback to HKCU (Per-User COM, no admin required)
    let roots = [windows::Win32::System::Registry::HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE];
    let mut any_success = false;

    for &root in &roots {
        let clsid_key_path = format!(r"Software\Classes\CLSID\{}", CLSID_STR);
        if !set_reg_string(root, &clsid_key_path, "", "A8 Cowlink Overlay Identifier") {
            continue;
        }

        let inproc_key_path = format!(r"{}\InProcServer32", clsid_key_path);
        if !set_reg_string(root, &inproc_key_path, "", &dll_str) {
            continue;
        }
        if !set_reg_string(root, &inproc_key_path, "ThreadingModel", "Apartment") {
            continue;
        }

        let overlay_reg_path = format!(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\ShellIconOverlayIdentifiers\{}",
            OVERLAY_REG_NAME
        );
        if set_reg_string(root, &overlay_reg_path, "", CLSID_STR) {
            any_success = true;
        }
    }

    if any_success {
        S_OK
    } else {
        E_FAIL
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn DllUnregisterServer() -> HRESULT {
    let roots = [windows::Win32::System::Registry::HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE];
    for &root in &roots {
        let overlay_reg_path = format!(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\ShellIconOverlayIdentifiers\{}",
            OVERLAY_REG_NAME
        );
        let wide_overlay: Vec<u16> = overlay_reg_path.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let _ = RegDeleteTreeW(root, PCWSTR(wide_overlay.as_ptr()));
        }

        let clsid_key_path = format!(r"Software\Classes\CLSID\{}", CLSID_STR);
        let wide_clsid: Vec<u16> = clsid_key_path.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let _ = RegDeleteTreeW(root, PCWSTR(wide_clsid.as_ptr()));
        }
    }

    S_OK
}

fn set_reg_string(hkey: HKEY, subkey: &str, value_name: &str, data: &str) -> bool {
    let wide_sub: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
    let mut h_sub = HKEY::default();

    let res = unsafe {
        RegCreateKeyExW(
            hkey,
            PCWSTR(wide_sub.as_ptr()),
            None,
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_ALL_ACCESS,
            None,
            &mut h_sub,
            None,
        )
    };

    if res.is_err() {
        return false;
    }

    let wide_val: Vec<u16> = value_name.encode_utf16().chain(std::iter::once(0)).collect();
    let wide_data: Vec<u16> = data.encode_utf16().chain(std::iter::once(0)).collect();

    let set_res = unsafe {
        RegSetValueExW(
            h_sub,
            if value_name.is_empty() {
                PCWSTR::null()
            } else {
                PCWSTR(wide_val.as_ptr())
            },
            None,
            REG_SZ,
            Some(std::slice::from_raw_parts(
                wide_data.as_ptr() as *const u8,
                wide_data.len() * 2,
            )),
        )
    };

    unsafe {
        let _ = RegCloseKey(h_sub);
    }

    set_res.is_ok()
}
