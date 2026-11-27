use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{
    CloseHandle, COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM,
};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetMonitorInfoW, MonitorFromRect,
    SelectObject, AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION,
    DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, FindWindowExW, FindWindowW,
    GetMessageW, GetWindowLongPtrW, GetWindowRect, IsWindowVisible, KillTimer, PostMessageW,
    PostQuitMessage, RegisterClassExW, SetTimer, SetWindowDisplayAffinity, SetWindowLongPtrW,
    SetWindowPos, ShowWindow, SystemParametersInfoW, TranslateMessage, UpdateLayeredWindow,
    CREATESTRUCTW, GWLP_USERDATA, HWND_MESSAGE, HWND_TOPMOST, MSG, SPI_GETWORKAREA, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    ULW_ALPHA, WDA_EXCLUDEFROMCAPTURE, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_CLOSE, WM_DESTROY,
    WM_DISPLAYCHANGE, WM_NCCREATE, WM_TIMER, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

const CONTROLLER_CLASS: PCWSTR = w!("A8DevToolsScreenAlertController");
const OVERLAY_CLASS: PCWSTR = w!("A8DevToolsScreenAlertRibbon");

const WM_ALERT_SYNC: u32 = WM_APP + 401;
const TIMER_ANIMATE: usize = 401;
const ANIMATE_INTERVAL_MS: u32 = 33; // ~30 FPS smooth flowing wave
const LAYOUT_RECHECK_TICKS: u32 = 45; // Re-verify taskbar bounds / topmost every ~1.5s

const RIBBON_CORE_PX: i32 = 6;
const RIBBON_GLOW_PX: i32 = 18;
const RIBBON_TOTAL_PX: i32 = RIBBON_CORE_PX + RIBBON_GLOW_PX;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchedProcessInfo {
    pub name: String,
    pub pids: Vec<u32>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenAlertStatusDto {
    pub active: bool,
    pub preview: bool,
    pub enabled: bool,
    pub matched_processes: Vec<String>,
    pub matched_details: Vec<MatchedProcessInfo>,
}

#[derive(Debug, Clone)]
struct SharedAlertState {
    config_version: u64,
    enabled: bool,
    watched_processes: Vec<String>,
    preview: bool,
    matched_details: Vec<MatchedProcessInfo>,
}

impl SharedAlertState {
    fn should_show(&self) -> bool {
        self.preview || (self.enabled && !self.matched_details.is_empty())
    }

    fn commit_scan_result(
        &mut self,
        expected_version: u64,
        next_matched: Vec<MatchedProcessInfo>,
    ) -> Option<bool> {
        if self.config_version != expected_version || !self.enabled {
            return None;
        }
        let changed = self.matched_details != next_matched;
        if changed {
            self.matched_details = next_matched;
        }
        Some(changed)
    }

    fn to_dto(&self) -> ScreenAlertStatusDto {
        ScreenAlertStatusDto {
            active: self.should_show(),
            preview: self.preview,
            enabled: self.enabled,
            matched_processes: self.matched_details.iter().map(|m| m.name.clone()).collect(),
            matched_details: self.matched_details.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RibbonEdge {
    Bottom,
    Top,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RibbonGeom {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
    edge: RibbonEdge,
}

struct RenderedRibbon {
    hwnd: HWND,
    geom: RibbonGeom,
    mem_dc: HDC,
    dib: HBITMAP,
    old_obj: HGDIOBJ,
    bits_ptr: *mut u32,
    buf_w: i32,
    buf_h: i32,
    visible: bool,
}

impl RenderedRibbon {
    unsafe fn release_surface(&mut self) {
        if !self.mem_dc.is_invalid() {
            if !self.old_obj.is_invalid() {
                unsafe {
                    SelectObject(self.mem_dc, self.old_obj);
                }
                self.old_obj = HGDIOBJ::default();
            }
            if !self.dib.is_invalid() {
                let _ = unsafe { DeleteObject(self.dib.into()) };
                self.dib = HBITMAP::default();
            }
            let _ = unsafe { DeleteDC(self.mem_dc) };
            self.mem_dc = HDC::default();
        }
        self.bits_ptr = std::ptr::null_mut();
        self.buf_w = 0;
        self.buf_h = 0;
    }

    unsafe fn ensure_surface(&mut self, width: i32, height: i32) -> bool {
        if width <= 0 || height <= 0 {
            return false;
        }
        if self.buf_w == width && self.buf_h == height && !self.bits_ptr.is_null() {
            return true;
        }

        unsafe { self.release_surface() };

        let mem_dc = unsafe { CreateCompatibleDC(None) };
        if mem_dc.is_invalid() {
            return false;
        }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // top-down 32-bit BGRA
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut raw_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let Ok(dib) =
            (unsafe { CreateDIBSection(Some(mem_dc), &bmi, DIB_RGB_COLORS, &mut raw_ptr, None, 0) })
        else {
            let _ = unsafe { DeleteDC(mem_dc) };
            return false;
        };

        if dib.is_invalid() || raw_ptr.is_null() {
            if !dib.is_invalid() {
                let _ = unsafe { DeleteObject(dib.into()) };
            }
            let _ = unsafe { DeleteDC(mem_dc) };
            return false;
        }

        let old_obj = unsafe { SelectObject(mem_dc, dib.into()) };
        self.mem_dc = mem_dc;
        self.dib = dib;
        self.old_obj = old_obj;
        self.bits_ptr = raw_ptr as *mut u32;
        self.buf_w = width;
        self.buf_h = height;
        true
    }

    unsafe fn destroy(&mut self) {
        unsafe { self.release_surface() };
        if !self.hwnd.is_invalid() {
            let _ = unsafe { DestroyWindow(self.hwnd) };
            self.hwnd = HWND::default();
        }
    }
}

struct ControllerCtx {
    state: Arc<RwLock<SharedAlertState>>,
    hinstance: HINSTANCE,
    ribbons: Vec<RenderedRibbon>,
    timer_running: bool,
    started_at: Instant,
    tick_counter: u32,
    wave_scratch: Vec<f32>,
}

pub struct ScreenAlertManager {
    state: Arc<RwLock<SharedAlertState>>,
    controller_hwnd: Arc<AtomicIsize>,
    running: Arc<AtomicBool>,
    app_handle: tauri::AppHandle,
}

impl ScreenAlertManager {
    pub fn start(
        app_handle: tauri::AppHandle,
        enabled: bool,
        processes: Vec<String>,
    ) -> Arc<Self> {
        let state = Arc::new(RwLock::new(SharedAlertState {
            config_version: 0,
            enabled,
            watched_processes: normalize_process_list(&processes),
            preview: false,
            matched_details: Vec::new(),
        }));
        let controller_hwnd = Arc::new(AtomicIsize::new(0));
        let running = Arc::new(AtomicBool::new(true));

        let manager = Arc::new(Self {
            state: state.clone(),
            controller_hwnd: controller_hwnd.clone(),
            running: running.clone(),
            app_handle: app_handle.clone(),
        });

        let ui_state = state.clone();
        let ui_hwnd = controller_hwnd.clone();
        std::thread::spawn(move || {
            run_overlay_message_loop(ui_state, ui_hwnd);
        });

        let poll_manager = manager.clone();
        std::thread::spawn(move || {
            run_process_poll_loop(poll_manager);
        });

        manager
    }

    pub fn apply_settings(&self, enabled: bool, processes: Vec<String>) {
        let normalized = normalize_process_list(&processes);
        {
            let mut guard = self.state.write();
            guard.config_version = guard.config_version.wrapping_add(1);
            guard.enabled = enabled;
            guard.watched_processes = normalized;
            if !enabled {
                guard.matched_details.clear();
            }
        }
        if enabled {
            self.scan_and_commit(true);
        } else {
            self.notify_overlay_sync();
            self.emit_status_if_visible();
        }
    }

    pub fn set_preview(&self, preview: bool) -> ScreenAlertStatusDto {
        let dto = {
            let mut guard = self.state.write();
            guard.preview = preview;
            guard.to_dto()
        };
        self.notify_overlay_sync();
        self.emit_status_if_visible();
        dto
    }

    pub fn get_status(&self) -> ScreenAlertStatusDto {
        self.state.read().to_dto()
    }

    pub fn shutdown(&self) {
        self.running.store(false, Ordering::SeqCst);
        let raw = self.controller_hwnd.swap(0, Ordering::SeqCst);
        if raw != 0 {
            unsafe {
                let _ = PostMessageW(
                    Some(HWND(raw as *mut _)),
                    WM_CLOSE,
                    WPARAM(0),
                    LPARAM(0),
                );
            }
        }
    }

    fn scan_and_commit(&self, force_notify: bool) {
        let (version, enabled, watched) = {
            let guard = self.state.read();
            (
                guard.config_version,
                guard.enabled,
                guard.watched_processes.clone(),
            )
        };
        if !enabled {
            return;
        }
        let next_matched = if watched.is_empty() {
            Vec::new()
        } else {
            let running = list_running_processes();
            find_matched_process_details(&running, &watched)
        };

        let commit_outcome = self
            .state
            .write()
            .commit_scan_result(version, next_matched);
        if let Some(changed) = commit_outcome {
            if force_notify || changed {
                self.notify_overlay_sync();
            }
            if changed {
                self.emit_status_if_visible();
            }
        }
    }

    fn notify_overlay_sync(&self) {
        let raw = self.controller_hwnd.load(Ordering::Acquire);
        if raw != 0 {
            unsafe {
                let _ = PostMessageW(
                    Some(HWND(raw as *mut _)),
                    WM_ALERT_SYNC,
                    WPARAM(0),
                    LPARAM(0),
                );
            }
        }
    }

    fn emit_status_if_visible(&self) {
        if let Some(window) = self.app_handle.get_webview_window("main") {
            if window.is_visible().unwrap_or(false) {
                let dto = self.get_status();
                let _ = self.app_handle.emit("screen-alert-status", &dto);
            }
        }
    }
}

impl Drop for ScreenAlertManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn run_process_poll_loop(manager: Arc<ScreenAlertManager>) {
    // Wait briefly so the Win32 overlay controller window registers first
    std::thread::sleep(Duration::from_millis(300));
    while manager.running.load(Ordering::Acquire) {
        manager.scan_and_commit(false);

        for _ in 0..20 {
            if !manager.running.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

pub fn normalize_process_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.ends_with(".exe") {
        Some(trimmed.to_string())
    } else {
        Some(format!("{}.exe", trimmed))
    }
}

pub fn normalize_process_list(list: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in list {
        if let Some(norm) = normalize_process_name(item) {
            let key = norm.to_ascii_lowercase();
            if seen.insert(key) {
                out.push(norm);
            }
        }
    }
    out
}

pub fn find_matched_process_details(
    running: &[(u32, String)],
    watched: &[String],
) -> Vec<MatchedProcessInfo> {
    let mut running_map: HashMap<String, Vec<u32>> = HashMap::new();
    for (pid, name) in running {
        let key = name.trim().to_ascii_lowercase();
        if !key.is_empty() {
            running_map.entry(key).or_default().push(*pid);
        }
    }

    let mut matched = Vec::new();
    let mut seen = HashSet::new();
    for item in watched {
        if let Some(norm) = normalize_process_name(item) {
            let key = norm.to_ascii_lowercase();
            if seen.insert(key.clone()) {
                if let Some(pids) = running_map.get(&key) {
                    let mut sorted_pids = pids.clone();
                    sorted_pids.sort_unstable();
                    sorted_pids.dedup();
                    matched.push(MatchedProcessInfo {
                        name: norm,
                        count: sorted_pids.len(),
                        pids: sorted_pids,
                    });
                }
            }
        }
    }
    matched
}

fn list_running_processes() -> Vec<(u32, String)> {
    let mut out = Vec::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return out;
        };
        if snapshot.is_invalid() {
            return out;
        }

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                if len > 0 {
                    out.push((
                        entry.th32ProcessID,
                        String::from_utf16_lossy(&entry.szExeFile[..len]),
                    ));
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
    }
    out
}

fn compute_taskbar_ribbon_geom(taskbar: RECT, monitor: RECT) -> Option<RibbonGeom> {
    let tb_w = taskbar.right - taskbar.left;
    let tb_h = taskbar.bottom - taskbar.top;
    if tb_w <= 0 || tb_h <= 0 {
        return None;
    }

    if tb_w >= tb_h {
        let mid_y = (taskbar.top + taskbar.bottom) / 2;
        let mon_mid_y = (monitor.top + monitor.bottom) / 2;
        if mid_y >= mon_mid_y {
            Some(RibbonGeom {
                left: taskbar.left,
                top: taskbar.top - RIBBON_TOTAL_PX,
                width: tb_w,
                height: RIBBON_TOTAL_PX,
                edge: RibbonEdge::Bottom,
            })
        } else {
            Some(RibbonGeom {
                left: taskbar.left,
                top: taskbar.bottom,
                width: tb_w,
                height: RIBBON_TOTAL_PX,
                edge: RibbonEdge::Top,
            })
        }
    } else {
        let mid_x = (taskbar.left + taskbar.right) / 2;
        let mon_mid_x = (monitor.left + monitor.right) / 2;
        if mid_x <= mon_mid_x {
            Some(RibbonGeom {
                left: taskbar.right,
                top: taskbar.top,
                width: RIBBON_TOTAL_PX,
                height: tb_h,
                edge: RibbonEdge::Left,
            })
        } else {
            Some(RibbonGeom {
                left: taskbar.left - RIBBON_TOTAL_PX,
                top: taskbar.top,
                width: RIBBON_TOTAL_PX,
                height: tb_h,
                edge: RibbonEdge::Right,
            })
        }
    }
}

unsafe fn collect_taskbar_ribbons() -> Vec<RibbonGeom> {
    let mut ribbons = Vec::new();
    let mut tray_hwnds = Vec::new();

    if let Ok(primary) = unsafe { FindWindowW(w!("Shell_TrayWnd"), None) } {
        if !primary.is_invalid() && unsafe { IsWindowVisible(primary) }.as_bool() {
            tray_hwnds.push(primary);
        }
    }

    let mut secondary = HWND::default();
    loop {
        match unsafe {
            FindWindowExW(
                None,
                if secondary.is_invalid() {
                    None
                } else {
                    Some(secondary)
                },
                w!("Shell_SecondaryTrayWnd"),
                None,
            )
        } {
            Ok(found) if !found.is_invalid() => {
                if unsafe { IsWindowVisible(found) }.as_bool() {
                    tray_hwnds.push(found);
                }
                secondary = found;
            }
            _ => break,
        }
    }

    for tray in tray_hwnds {
        let mut tb_rect = RECT::default();
        if unsafe { GetWindowRect(tray, &mut tb_rect) }.is_err() {
            continue;
        }
        let hmon = unsafe { MonitorFromRect(&tb_rect, MONITOR_DEFAULTTONEAREST) };
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let mon_rect = if !hmon.is_invalid() && unsafe { GetMonitorInfoW(hmon, &mut info) }.as_bool()
        {
            info.rcMonitor
        } else {
            tb_rect
        };
        if let Some(geom) = compute_taskbar_ribbon_geom(tb_rect, mon_rect) {
            ribbons.push(geom);
        }
    }

    if ribbons.is_empty() {
        let mut work_area = RECT::default();
        if unsafe {
            SystemParametersInfoW(
                SPI_GETWORKAREA,
                0,
                Some(&mut work_area as *mut _ as *mut _),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
        }
        .is_ok()
        {
            let width = work_area.right - work_area.left;
            if width > 0 {
                ribbons.push(RibbonGeom {
                    left: work_area.left,
                    top: work_area.bottom - RIBBON_TOTAL_PX,
                    width,
                    height: RIBBON_TOTAL_PX,
                    edge: RibbonEdge::Bottom,
                });
            }
        }
    }

    ribbons
}

#[inline]
fn premul_bgra(r: u8, g: u8, b: u8, a: u8) -> u32 {
    let af = a as u32;
    let pr = ((r as u32) * af + 127) / 255;
    let pg = ((g as u32) * af + 127) / 255;
    let pb = ((b as u32) * af + 127) / 255;
    (af << 24) | (pr << 16) | (pg << 8) | pb
}

/// Evaluates the dual traveling wave intensity in [0.0, 1.0] along normalized coordinate `u`.
#[inline]
fn wave_intensity(u: f32, phase: f32) -> f32 {
    let wrap_dist = |a: f32, b: f32| -> f32 {
        let d = (a - b).abs();
        d.min(1.0 - d)
    };
    let d1 = wrap_dist(u, phase) / 0.085;
    let primary = (-d1 * d1).exp();

    let p2 = (phase + 0.5).fract();
    let d2 = wrap_dist(u, p2) / 0.065;
    let secondary = 0.58 * (-d2 * d2).exp();

    (primary + secondary).min(1.0)
}

#[inline]
fn compute_ribbon_pixel(dist_from_taskbar: i32, wave: f32, breath: f32) -> u32 {
    if dist_from_taskbar < RIBBON_CORE_PX {
        // Intense neon red core; brightens toward warm-white highlight as the wave crest passes
        let edge_boost = if dist_from_taskbar <= 2 { 1.0 } else { 0.88 };
        let w = wave * edge_boost;
        let r = 255u8;
        let g = (18.0 + 148.0 * w).round().clamp(0.0, 255.0) as u8;
        let b = (42.0 + 140.0 * w).round().clamp(0.0, 255.0) as u8;
        let a = ((226.0 * breath + 29.0 * wave).round()).clamp(0.0, 255.0) as u8;
        premul_bgra(r, g, b, a)
    } else {
        let glow_idx = (dist_from_taskbar - RIBBON_CORE_PX).min(RIBBON_GLOW_PX);
        let t = 1.0 - (glow_idx as f32 / RIBBON_GLOW_PX as f32);
        // Wave crest expands both the brightness and visual reach of the upward glow
        let falloff = t.powf(2.15 - 0.55 * wave);
        let base_alpha = (118.0 * breath + 96.0 * wave) * falloff;
        let a = base_alpha.round().clamp(0.0, 255.0) as u8;
        let r = 255u8;
        let g = (26.0 + 68.0 * wave * t).round().clamp(0.0, 255.0) as u8;
        let b = (52.0 + 64.0 * wave * t).round().clamp(0.0, 255.0) as u8;
        premul_bgra(r, g, b, a)
    }
}

unsafe fn create_ribbon_window(hinstance: HINSTANCE) -> Option<HWND> {
    let ex_style =
        WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
    let hwnd = unsafe {
        CreateWindowExW(
            ex_style,
            OVERLAY_CLASS,
            w!("a8-screen-alert-ribbon"),
            WS_POPUP,
            0,
            0,
            1,
            1,
            None,
            None,
            Some(hinstance),
            None,
        )
    }
    .ok()?;

    // Exclude ribbon from screen capture so remote viewers never see local red alerts
    let _ = unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) };
    Some(hwnd)
}

unsafe fn render_ribbon_frame(
    ribbon: &mut RenderedRibbon,
    elapsed_secs: f32,
    wave_scratch: &mut Vec<f32>,
    force_topmost: bool,
) {
    let geom = ribbon.geom;
    if !unsafe { ribbon.ensure_surface(geom.width, geom.height) } {
        return;
    }

    let phase = (elapsed_secs * 0.42).fract();
    let breath = 0.90 + 0.10 * (elapsed_secs * 3.1415927).sin();
    let w = geom.width as usize;
    let h = geom.height as usize;
    let pixels = unsafe { std::slice::from_raw_parts_mut(ribbon.bits_ptr, w * h) };

    match geom.edge {
        RibbonEdge::Bottom | RibbonEdge::Top => {
            wave_scratch.clear();
            wave_scratch.reserve(w);
            let inv_w = 1.0 / (w.max(1) as f32);
            for x in 0..w {
                wave_scratch.push(wave_intensity(x as f32 * inv_w, phase));
            }
            for y in 0..h {
                let dist = match geom.edge {
                    RibbonEdge::Bottom => (geom.height - 1 - y as i32).max(0),
                    RibbonEdge::Top => y as i32,
                    _ => 0,
                };
                let row = &mut pixels[y * w..(y + 1) * w];
                for x in 0..w {
                    row[x] = compute_ribbon_pixel(dist, wave_scratch[x], breath);
                }
            }
        }
        RibbonEdge::Left | RibbonEdge::Right => {
            wave_scratch.clear();
            wave_scratch.reserve(h);
            let inv_h = 1.0 / (h.max(1) as f32);
            for y in 0..h {
                wave_scratch.push(wave_intensity(y as f32 * inv_h, phase));
            }
            for y in 0..h {
                let wave = wave_scratch[y];
                let row = &mut pixels[y * w..(y + 1) * w];
                for x in 0..w {
                    let dist = match geom.edge {
                        RibbonEdge::Left => x as i32,
                        RibbonEdge::Right => (geom.width - 1 - x as i32).max(0),
                        _ => 0,
                    };
                    row[x] = compute_ribbon_pixel(dist, wave, breath);
                }
            }
        }
    }

    let pt_dst = POINT {
        x: geom.left,
        y: geom.top,
    };
    let size = SIZE {
        cx: geom.width,
        cy: geom.height,
    };
    let pt_src = POINT { x: 0, y: 0 };
    let blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER as u8,
        BlendFlags: 0,
        SourceConstantAlpha: 255,
        AlphaFormat: AC_SRC_ALPHA as u8,
    };

    let _ = unsafe {
        UpdateLayeredWindow(
            ribbon.hwnd,
            None,
            Some(&pt_dst),
            Some(&size),
            Some(ribbon.mem_dc),
            Some(&pt_src),
            COLORREF(0),
            Some(&blend),
            ULW_ALPHA,
        )
    };

    if !ribbon.visible {
        let _ = unsafe {
            SetWindowPos(
                ribbon.hwnd,
                Some(HWND_TOPMOST),
                geom.left,
                geom.top,
                geom.width,
                geom.height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        };
        ribbon.visible = true;
    } else if force_topmost {
        let _ = unsafe {
            SetWindowPos(
                ribbon.hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        };
    }
}

unsafe fn sync_layout_and_visibility(controller_hwnd: HWND, ctx: &mut ControllerCtx) {
    let should_show = ctx.state.read().should_show();

    if !should_show {
        for item in &mut ctx.ribbons {
            if item.visible {
                let _ = unsafe { ShowWindow(item.hwnd, SW_HIDE) };
                item.visible = false;
            }
        }
        if ctx.timer_running {
            let _ = unsafe { KillTimer(Some(controller_hwnd), TIMER_ANIMATE) };
            ctx.timer_running = false;
        }
        return;
    }

    let target_ribbons = unsafe { collect_taskbar_ribbons() };

    while ctx.ribbons.len() > target_ribbons.len() {
        if let Some(mut extra) = ctx.ribbons.pop() {
            unsafe { extra.destroy() };
        }
    }

    for (idx, &geom) in target_ribbons.iter().enumerate() {
        if idx < ctx.ribbons.len() {
            let existing = &mut ctx.ribbons[idx];
            if existing.geom != geom {
                existing.geom = geom;
                existing.visible = false;
            }
        } else if let Some(hwnd) = unsafe { create_ribbon_window(ctx.hinstance) } {
            ctx.ribbons.push(RenderedRibbon {
                hwnd,
                geom,
                mem_dc: HDC::default(),
                dib: HBITMAP::default(),
                old_obj: HGDIOBJ::default(),
                bits_ptr: std::ptr::null_mut(),
                buf_w: 0,
                buf_h: 0,
                visible: false,
            });
        }
    }

    let elapsed = ctx.started_at.elapsed().as_secs_f32();
    for item in &mut ctx.ribbons {
        unsafe { render_ribbon_frame(item, elapsed, &mut ctx.wave_scratch, true) };
    }

    if !ctx.timer_running {
        let _ = unsafe { SetTimer(Some(controller_hwnd), TIMER_ANIMATE, ANIMATE_INTERVAL_MS, None) };
        ctx.timer_running = true;
        ctx.tick_counter = 0;
    }
}

fn run_overlay_message_loop(
    state: Arc<RwLock<SharedAlertState>>,
    hwnd_holder: Arc<AtomicIsize>,
) {
    unsafe {
        let hinstance: HINSTANCE = GetModuleHandleW(None).unwrap_or_default().into();

        let overlay_wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(overlay_ribbon_wnd_proc),
            hInstance: hinstance,
            lpszClassName: OVERLAY_CLASS,
            ..Default::default()
        };
        let _ = RegisterClassExW(&overlay_wc);

        let ctrl_wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(controller_wnd_proc),
            hInstance: hinstance,
            lpszClassName: CONTROLLER_CLASS,
            ..Default::default()
        };
        let _ = RegisterClassExW(&ctrl_wc);

        let ctx = Box::new(ControllerCtx {
            state,
            hinstance,
            ribbons: Vec::new(),
            timer_running: false,
            started_at: Instant::now(),
            tick_counter: 0,
            wave_scratch: Vec::new(),
        });
        let ctx_ptr = Box::into_raw(ctx);

        let Ok(ctrl_hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            CONTROLLER_CLASS,
            w!("a8-screen-alert-controller"),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(hinstance),
            Some(ctx_ptr as *const _),
        ) else {
            let _ = Box::from_raw(ctx_ptr);
            return;
        };

        hwnd_holder.store(ctrl_hwnd.0 as isize, Ordering::Release);
        let _ = PostMessageW(Some(ctrl_hwnd), WM_ALERT_SYNC, WPARAM(0), LPARAM(0));

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        hwnd_holder.store(0, Ordering::Release);
    }
}

unsafe extern "system" fn overlay_ribbon_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

unsafe extern "system" fn controller_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_NCCREATE {
        let cs = unsafe { &*(lparam.0 as *const CREATESTRUCTW) };
        unsafe {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, cs.lpCreateParams as isize);
        }
        return LRESULT(1);
    }

    let ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut ControllerCtx;
    if ptr.is_null() {
        return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
    }
    let ctx = unsafe { &mut *ptr };

    match msg {
        WM_ALERT_SYNC | WM_DISPLAYCHANGE => {
            unsafe { sync_layout_and_visibility(hwnd, ctx) };
            LRESULT(0)
        }
        WM_TIMER => {
            if wparam.0 == TIMER_ANIMATE {
                if !ctx.state.read().should_show() {
                    unsafe { sync_layout_and_visibility(hwnd, ctx) };
                    return LRESULT(0);
                }
                ctx.tick_counter = ctx.tick_counter.wrapping_add(1);
                if ctx.tick_counter % LAYOUT_RECHECK_TICKS == 0 {
                    unsafe { sync_layout_and_visibility(hwnd, ctx) };
                } else {
                    let elapsed = ctx.started_at.elapsed().as_secs_f32();
                    for item in &mut ctx.ribbons {
                        unsafe { render_ribbon_frame(item, elapsed, &mut ctx.wave_scratch, false) };
                    }
                }
            }
            LRESULT(0)
        }
        WM_CLOSE => {
            let _ = unsafe { DestroyWindow(hwnd) };
            LRESULT(0)
        }
        WM_DESTROY => {
            if ctx.timer_running {
                let _ = unsafe { KillTimer(Some(hwnd), TIMER_ANIMATE) };
                ctx.timer_running = false;
            }
            for mut item in ctx.ribbons.drain(..) {
                unsafe { item.destroy() };
            }
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                let _ = Box::from_raw(ptr);
                PostQuitMessage(0);
            }
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_and_match_process_details_with_pids() {
        let watched = normalize_process_list(&[
            " wemeetapp ".to_string(),
            "SunloginClient.exe".to_string(),
            "SUNLOGINCLIENT.EXE".to_string(),
            "".to_string(),
            "ToDesk".to_string(),
        ]);
        assert_eq!(
            watched,
            vec![
                "wemeetapp.exe".to_string(),
                "SunloginClient.exe".to_string(),
                "ToDesk.exe".to_string()
            ]
        );

        let running = vec![
            (100, "explorer.exe".to_string()),
            (2048, "WEMEETAPP.EXE".to_string()),
            (1024, "wemeetapp.exe".to_string()),
            (3000, "ToDesk.exe".to_string()),
        ];
        let matched = find_matched_process_details(&running, &watched);
        assert_eq!(
            matched,
            vec![
                MatchedProcessInfo {
                    name: "wemeetapp.exe".to_string(),
                    pids: vec![1024, 2048],
                    count: 2,
                },
                MatchedProcessInfo {
                    name: "ToDesk.exe".to_string(),
                    pids: vec![3000],
                    count: 1,
                },
            ]
        );
    }

    #[test]
    fn test_compute_taskbar_ribbon_sits_flush_above_bottom_taskbar() {
        let mon = RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        let tb = RECT {
            left: 0,
            top: 1032,
            right: 1920,
            bottom: 1080,
        };
        let geom = compute_taskbar_ribbon_geom(tb, mon).expect("should build ribbon");
        assert_eq!(geom.left, 0);
        assert_eq!(geom.width, 1920);
        assert_eq!(geom.top + geom.height, 1032);
        assert_eq!(geom.height, RIBBON_TOTAL_PX);
        assert_eq!(geom.edge, RibbonEdge::Bottom);
    }

    #[test]
    fn test_wave_intensity_peaks_at_phase_and_stays_bounded() {
        let peak = wave_intensity(0.35, 0.35);
        let trough = wave_intensity(0.10, 0.35);
        assert!(peak > 0.99 && peak <= 1.0);
        assert!(trough >= 0.0 && trough < 0.25);
    }

    #[test]
    fn test_commit_scan_result_discards_outdated_version_or_disabled_state() {
        let mut state = SharedAlertState {
            config_version: 2,
            enabled: true,
            watched_processes: vec!["wemeetapp.exe".to_string()],
            preview: false,
            matched_details: Vec::new(),
        };
        let hit = vec![MatchedProcessInfo {
            name: "wemeetapp.exe".to_string(),
            pids: vec![1234],
            count: 1,
        }];

        // Outdated snapshot from version 1 must be ignored
        assert_eq!(state.commit_scan_result(1, hit.clone()), None);
        assert!(state.matched_details.is_empty());

        // Matching version commits cleanly
        assert_eq!(state.commit_scan_result(2, hit.clone()), Some(true));
        assert_eq!(state.matched_details, hit);

        // Disabling bumps version and clears; in-flight version 2 scan cannot resurrect hits
        state.config_version = state.config_version.wrapping_add(1);
        state.enabled = false;
        state.matched_details.clear();
        assert_eq!(state.commit_scan_result(2, hit.clone()), None);
        assert_eq!(state.commit_scan_result(3, hit), None);
        assert!(state.matched_details.is_empty());
    }
}
