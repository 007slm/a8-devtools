use std::collections::HashSet;
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
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
// 7 leading spaces ensure it sorts ahead of other 6-space/3-space shell overlays within Windows' 15-slot cap
pub const OVERLAY_REG_NAME: &str = "       A8CowFsOverlay";

const FILE_ATTRIBUTE_DIRECTORY_FLAG: u32 = 0x10;
const CACHE_TTL: Duration = Duration::from_millis(1500);

struct OverlayCache {
    last_refresh: Instant,
    active_targets: HashSet<String>,
}

static WORKSPACE_CACHE: OnceLock<Mutex<OverlayCache>> = OnceLock::new();

#[derive(Default)]
#[implement(IShellIconOverlayIdentifier)]
struct CowlinkOverlay;

impl IShellIconOverlayIdentifier_Impl for CowlinkOverlay_Impl {
    fn IsMemberOf(&self, pwszpath: &PCWSTR, dwattrib: u32) -> windows::core::Result<()> {
        if dwattrib != 0 && (dwattrib & FILE_ATTRIBUTE_DIRECTORY_FLAG) == 0 {
            return Err(windows::core::Error::from(S_FALSE));
        }
        let path_str = unsafe { pwszpath.to_string() }.unwrap_or_default();
        if path_str.is_empty() {
            return Err(windows::core::Error::from(S_FALSE));
        }
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

const OVERLAY_ICO_BYTES: &[u8] = include_bytes!("../../devtools/icons/overlay-badge.ico");

fn resolve_icon_path() -> String {
    // 1. Prefer overlay-badge.ico placed alongside cowlink_overlay.dll
    let mut dll_path = [0u16; 260];
    let len = unsafe { GetModuleFileNameW(Some(G_HMODULE), &mut dll_path) };
    if len > 0 {
        let dll_str = String::from_utf16_lossy(&dll_path[..len as usize]);
        if let Some(dir) = Path::new(&dll_str).parent() {
            let sibling = dir.join("overlay-badge.ico");
            if sibling.is_file() {
                return sibling.to_string_lossy().to_string();
            }
        }
    }

    // 2. Fallback: extract embedded overlay-badge.ico into %LOCALAPPDATA%\cowlink\overlay-badge.ico
    if let Ok(base) = std::env::var("LOCALAPPDATA") {
        let dir = PathBuf::from(base).join("cowlink");
        let target = dir.join("overlay-badge.ico");
        let need_write = match std::fs::metadata(&target) {
            Ok(meta) => meta.len() != OVERLAY_ICO_BYTES.len() as u64,
            Err(_) => true,
        };
        if need_write {
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(&target, OVERLAY_ICO_BYTES);
        }
        return target.to_string_lossy().to_string();
    }

    String::new()
}

fn load_active_targets() -> HashSet<String> {
    let mut set = HashSet::new();
    let base = match std::env::var("LOCALAPPDATA") {
        Ok(b) => PathBuf::from(b),
        Err(_) => return set,
    };
    let workspaces_root = base.join("cowlink").join("workspaces");
    if let Ok(entries) = std::fs::read_dir(workspaces_root) {
        for entry in entries.flatten() {
            let meta_file = entry.path().join("meta.json");
            if let Ok(content) = std::fs::read_to_string(&meta_file) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    let is_active = v.get("active").and_then(|a| a.as_bool()).unwrap_or(false);
                    if is_active {
                        if let Some(target_dir) = v.get("target_dir").and_then(|t| t.as_str()) {
                            set.insert(target_dir.trim_end_matches('\\').to_lowercase());
                        }
                    }
                }
            }
        }
    }
    set
}

fn is_registered_workspace(path: &str) -> bool {
    let norm_path = path.trim_end_matches('\\').to_lowercase();
    let cache = WORKSPACE_CACHE.get_or_init(|| {
        Mutex::new(OverlayCache {
            last_refresh: Instant::now() - CACHE_TTL,
            active_targets: HashSet::new(),
        })
    });

    if let Ok(mut guard) = cache.lock() {
        if guard.last_refresh.elapsed() >= CACHE_TTL {
            guard.active_targets = load_active_targets();
            guard.last_refresh = Instant::now();
        }
        return guard.active_targets.contains(&norm_path);
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
        for name in [OVERLAY_REG_NAME, "   A8CowFsOverlay"] {
            let overlay_reg_path = format!(
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\ShellIconOverlayIdentifiers\{}",
                name
            );
            let wide_overlay: Vec<u16> = overlay_reg_path.encode_utf16().chain(std::iter::once(0)).collect();
            unsafe {
                let _ = RegDeleteTreeW(root, PCWSTR(wide_overlay.as_ptr()));
            }
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
