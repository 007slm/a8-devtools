use cowfs::config::WorkspaceMeta;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use windows::core::{w, PCWSTR};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_SZ,
};

const RUN_KEY_PATH: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
const APP_REG_NAME: PCWSTR = w!("a8-devtools");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub autostart: bool,
    pub taskbar_speed_enabled: bool,
    pub sample_interval_secs: u64,
    pub fullscreen_hide: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            autostart: false,
            taskbar_speed_enabled: true,
            sample_interval_secs: 5,
            fullscreen_hide: true,
        }
    }
}

pub fn check_autostart_registry() -> bool {
    unsafe {
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            RUN_KEY_PATH,
            Some(0),
            KEY_QUERY_VALUE,
            &mut hkey,
        )
        .is_ok()
        {
            let mut buf = [0u16; 1024];
            let mut buf_len = (buf.len() * 2) as u32;
            let res = RegQueryValueExW(
                hkey,
                APP_REG_NAME,
                None,
                None,
                Some(buf.as_mut_ptr() as *mut _),
                Some(&mut buf_len),
            );
            let _ = RegCloseKey(hkey);
            res.is_ok()
        } else {
            false
        }
    }
}

pub fn set_autostart_registry(enable: bool) -> Result<(), String> {
    unsafe {
        let mut hkey = HKEY::default();
        if enable {
            let exe_path =
                std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
            let formatted_path = format!("\"{}\"", exe_path.display());
            let wide_path: Vec<u16> = formatted_path
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();

            let open_res = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                RUN_KEY_PATH,
                Some(0),
                KEY_SET_VALUE,
                &mut hkey,
            );
            if open_res.is_err() {
                return Err(format!("打开注册表 Run 键失败: 0x{:X}", open_res.0));
            }

            let byte_slice = std::slice::from_raw_parts(
                wide_path.as_ptr() as *const u8,
                wide_path.len() * std::mem::size_of::<u16>(),
            );

            let set_res = RegSetValueExW(
                hkey,
                APP_REG_NAME,
                Some(0),
                REG_SZ,
                Some(byte_slice),
            );
            let _ = RegCloseKey(hkey);
            if set_res.is_err() {
                return Err(format!("写入自启动注册表项失败: 0x{:X}", set_res.0));
            }
        } else {
            let open_res = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                RUN_KEY_PATH,
                Some(0),
                KEY_SET_VALUE,
                &mut hkey,
            );
            if open_res.is_ok() {
                let _ = RegDeleteValueW(hkey, APP_REG_NAME);
                let _ = RegCloseKey(hkey);
            }
        }
        Ok(())
    }
}

fn get_settings_file_path() -> PathBuf {
    let base = WorkspaceMeta::global_root();
    let _ = std::fs::create_dir_all(&base);
    base.join("devtools_settings.json")
}

pub fn load_settings() -> AppSettings {
    let p = get_settings_file_path();
    let mut s: AppSettings = if p.exists() {
        std::fs::read_to_string(&p)
            .ok()
            .and_then(|str| serde_json::from_str(&str).ok())
            .unwrap_or_default()
    } else {
        AppSettings::default()
    };
    // Sync with actual registry state
    s.autostart = check_autostart_registry();
    s
}

pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    // 1. Sync autostart to registry
    set_autostart_registry(settings.autostart)?;

    // 2. Persist to JSON
    let p = get_settings_file_path();
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    std::fs::write(&p, json).map_err(|e| format!("写入配置文件失败: {}", e))?;
    Ok(())
}
