use parking_lot::RwLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::Manager;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW, CreateSolidBrush,
    DeleteDC, DeleteObject, DrawTextW, EndPaint, FillRect, GetMonitorInfoW, InvalidateRect,
    MonitorFromWindow, SelectObject, SetBkMode, SetTextColor, BACKGROUND_MODE, DT_LEFT,
    DT_SINGLELINE, DT_VCENTER, FW_SEMIBOLD, HDC, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    PAINTSTRUCT, SRCCOPY, TRANSPARENT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
    DispatchMessageW, FindWindowExW, FindWindowW, GetClassNameW, GetClientRect, GetCursorPos,
    GetDesktopWindow, GetForegroundWindow, GetMessageW, GetSystemMetrics, GetWindowRect, IsIconic,
    IsWindowVisible, KillTimer, PostMessageW, PostQuitMessage, RegisterClassExW, SetLayeredWindowAttributes,
    SetTimer, SetWindowPos, ShowWindow, SystemParametersInfoW, TrackPopupMenu, TranslateMessage, CS_DBLCLKS,
    CS_HREDRAW, CS_VREDRAW, HWND_TOPMOST, LWA_COLORKEY, MF_DISABLED, MF_GRAYED, MF_SEPARATOR,
    MF_STRING, SM_CXSCREEN, SM_CYSCREEN, SPI_GETWORKAREA, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNOACTIVATE, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    TPM_BOTTOMALIGN, TPM_LEFTALIGN, TPM_RIGHTBUTTON, WM_COMMAND, WM_DESTROY, WM_LBUTTONDBLCLK,
    WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT, WM_RBUTTONUP, WM_TIMER, WM_USER, WNDCLASSEXW,
    WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
};

pub const WM_TASKBAR_SPEED_UPDATE: u32 = WM_USER + 301;

// Color key for 100% true transparent window background
const TRANSPARENT_COLOR_KEY: COLORREF = COLORREF(0x00000000); // Pure Black RGB(0, 0, 0)

const MENU_SPEED_INFO: usize = 1001;
const MENU_RESET_POS: usize = 1002;
const MENU_TOGGLE_WIN: usize = 1003;
const MENU_QUIT_APP: usize = 1004;

#[derive(Clone, Copy, Default)]
struct SendHwnd(isize);
unsafe impl Send for SendHwnd {}
unsafe impl Sync for SendHwnd {}

impl SendHwnd {
    fn from_hwnd(hwnd: HWND) -> Self {
        Self(hwnd.0 as isize)
    }
    fn to_hwnd(self) -> HWND {
        HWND(self.0 as *mut _)
    }
}

#[derive(Clone, Copy)]
struct DragContext {
    cursor_x: i32,
    cursor_y: i32,
    win_x: i32,
    win_y: i32,
}

static DRAG_STATE: parking_lot::Mutex<Option<DragContext>> = parking_lot::Mutex::new(None);

#[derive(Clone)]
pub struct TaskbarState {
    pub upload_str: String,
    pub download_str: String,
}

pub struct TaskbarSpeedBar {
    hwnd: Arc<parking_lot::Mutex<Option<SendHwnd>>>,
    speed_state: Arc<RwLock<TaskbarState>>,
    is_alive: Arc<AtomicBool>,
}

// Global thread-safe references for WinProc dispatch
static GLOBAL_SPEED_STATE: OnceLock<Arc<RwLock<TaskbarState>>> = OnceLock::new();
static GLOBAL_TAURI_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

impl TaskbarSpeedBar {
    pub fn start(app_handle: tauri::AppHandle) -> Arc<Self> {
        let speed_state = Arc::new(RwLock::new(TaskbarState {
            upload_str: "▲ 0 B/s".to_string(),
            download_str: "▼ 0 B/s".to_string(),
        }));
        let hwnd_holder = Arc::new(parking_lot::Mutex::new(None));
        let is_alive = Arc::new(AtomicBool::new(true));

        let _ = GLOBAL_SPEED_STATE.set(speed_state.clone());
        let _ = GLOBAL_TAURI_APP.set(app_handle);

        let hwnd_clone = hwnd_holder.clone();
        let is_alive_clone = is_alive.clone();

        std::thread::spawn(move || {
            run_win32_taskbar_window(hwnd_clone, is_alive_clone);
        });

        Arc::new(Self {
            hwnd: hwnd_holder,
            speed_state,
            is_alive,
        })
    }

    pub fn update_speed(&self, upload: &str, download: &str) {
        {
            let mut state = self.speed_state.write();
            state.upload_str = format!("▲ {}", upload);
            state.download_str = format!("▼ {}", download);
        }
        if let Some(send_hwnd) = *self.hwnd.lock() {
            unsafe {
                let _ = PostMessageW(
                    Some(send_hwnd.to_hwnd()),
                    WM_TASKBAR_SPEED_UPDATE,
                    WPARAM(0),
                    LPARAM(0),
                );
            }
        }
    }
}

impl Drop for TaskbarSpeedBar {
    fn drop(&mut self) {
        self.is_alive.store(false, Ordering::SeqCst);
        if let Some(send_hwnd) = *self.hwnd.lock() {
            unsafe {
                let _ = PostMessageW(
                    Some(send_hwnd.to_hwnd()),
                    windows::Win32::UI::WindowsAndMessaging::WM_CLOSE,
                    WPARAM(0),
                    LPARAM(0),
                );
            }
        }
    }
}

/// Detects if an active foreground application is currently in fullscreen mode (e.g. video, game, slides)
unsafe fn is_fullscreen_app_active(my_hwnd: HWND) -> bool {
    unsafe {
        let fg_hwnd = GetForegroundWindow();
        if fg_hwnd.is_invalid() || fg_hwnd == my_hwnd {
            return false;
        }

        let desktop_hwnd = GetDesktopWindow();
        if fg_hwnd == desktop_hwnd {
            return false;
        }

        // Exclude taskbar itself
        let tray_hwnd = FindWindowW(w!("Shell_TrayWnd"), None).unwrap_or_default();
        if fg_hwnd == tray_hwnd {
            return false;
        }

        // Filter desktop shell background windows
        let mut class_buf = [0u16; 64];
        let class_len = GetClassNameW(fg_hwnd, &mut class_buf) as usize;
        if class_len > 0 {
            let class_str = String::from_utf16_lossy(&class_buf[..class_len]);
            if class_str == "WorkerW" || class_str == "Progman" || class_str == "Shell_TrayWnd" {
                return false;
            }
        }

        if !IsWindowVisible(fg_hwnd).as_bool() || IsIconic(fg_hwnd).as_bool() {
            return false;
        }

        let mut fg_rect = RECT::default();
        if GetWindowRect(fg_hwnd, &mut fg_rect).is_err() {
            return false;
        }

        let monitor = MonitorFromWindow(fg_hwnd, MONITOR_DEFAULTTOPRIMARY);
        if monitor.is_invalid() {
            return false;
        }

        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut mi).as_bool() {
            // Foreground window covers entire physical screen bounds (tolerating ±2px window borders)
            if fg_rect.left <= mi.rcMonitor.left + 2
                && fg_rect.top <= mi.rcMonitor.top + 2
                && fg_rect.right >= mi.rcMonitor.right - 2
                && fg_rect.bottom >= mi.rcMonitor.bottom - 2
            {
                return true;
            }
        }

        false
    }
}

/// Calculate the optimal docking position and size directly in Windows Taskbar
/// Returns (x, y, width, height)
fn calculate_dock_position() -> (i32, i32, i32, i32) {
    unsafe {
        // 1. Try FindWindow Shell_TrayWnd & TrayNotifyWnd
        let tray_hwnd = FindWindowW(w!("Shell_TrayWnd"), None).unwrap_or_default();
        if !tray_hwnd.is_invalid() {
            let mut tray_rect = RECT::default();
            let _ = GetWindowRect(tray_hwnd, &mut tray_rect);

            let tray_h = (tray_rect.bottom - tray_rect.top).max(36);
            let bar_h = (tray_h - 4).clamp(36, 56);
            // Enlarged width (136px) for larger typography
            let bar_w = ((bar_h as f32) * 3.5).clamp(132.0, 190.0) as i32;

            let notify_hwnd = FindWindowExW(Some(tray_hwnd), None, w!("TrayNotifyWnd"), None)
                .unwrap_or_default();
            if !notify_hwnd.is_invalid() {
                let mut notify_rect = RECT::default();
                let _ = GetWindowRect(notify_hwnd, &mut notify_rect);

                if notify_rect.left > 100 {
                    let target_x = notify_rect.left - bar_w - 6;
                    let target_y = tray_rect.top + (tray_h - bar_h) / 2;
                    return (target_x, target_y, bar_w, bar_h);
                }
            }

            if tray_rect.right > 200 {
                let target_x = tray_rect.right - bar_w - (bar_w * 2);
                let target_y = tray_rect.top + (tray_h - bar_h) / 2;
                return (target_x, target_y, bar_w, bar_h);
            }
        }

        // 2. Fallback to SPI_GETWORKAREA
        let mut work_area = RECT::default();
        let spi_res = SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(&mut work_area as *mut _ as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
        if spi_res.is_ok() && work_area.right > 0 {
            let _screen_w = GetSystemMetrics(SM_CXSCREEN);
            let screen_h = GetSystemMetrics(SM_CYSCREEN);
            let taskbar_h = (screen_h - work_area.bottom).max(36);
            let bar_h = (taskbar_h - 4).clamp(36, 56);
            let bar_w = ((bar_h as f32) * 3.5).clamp(132.0, 190.0) as i32;

            let target_x = work_area.right - bar_w - 240;
            let target_y = work_area.bottom + (taskbar_h - bar_h) / 2;
            return (target_x, target_y, bar_w, bar_h);
        }

        // 3. Fallback standard
        (1560, 1038, 136, 38)
    }
}

fn run_win32_taskbar_window(
    hwnd_out: Arc<parking_lot::Mutex<Option<SendHwnd>>>,
    is_alive: Arc<AtomicBool>,
) {
    unsafe {
        let class_name = w!("A8DevToolsTaskbarSpeedBar");
        let hinstance: HINSTANCE = GetModuleHandleW(None).unwrap_or_default().into();

        let wnd_class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS,
            lpfnWndProc: Some(taskbar_wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: windows::Win32::UI::WindowsAndMessaging::HICON::default(),
            hCursor: windows::Win32::UI::WindowsAndMessaging::LoadCursorW(
                None,
                windows::Win32::UI::WindowsAndMessaging::IDC_ARROW,
            )
            .unwrap_or_default(),
            hbrBackground: windows::Win32::Graphics::Gdi::HBRUSH::default(),
            lpszMenuName: PCWSTR::null(),
            lpszClassName: class_name,
            hIconSm: windows::Win32::UI::WindowsAndMessaging::HICON::default(),
        };

        let _ = RegisterClassExW(&wnd_class);

        let (init_x, init_y, init_w, init_h) = calculate_dock_position();

        // WS_EX_LAYERED: enable per-pixel color-key transparency
        // WS_EX_TOOLWINDOW: don't show in Alt-Tab or taskbar icon list
        // WS_EX_TOPMOST: stay on top of taskbar
        // WS_EX_NOACTIVATE: don't steal focus when clicked or dragged
        let ex_style = WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE;
        let style = WS_POPUP | WS_VISIBLE;

        // Make window owned by Shell_TrayWnd so it can NEVER sink below the taskbar
        let tray_hwnd = FindWindowW(w!("Shell_TrayWnd"), None).unwrap_or_default();
        let owner_hwnd = if !tray_hwnd.is_invalid() {
            Some(tray_hwnd)
        } else {
            None
        };

        let hwnd = match CreateWindowExW(
            ex_style,
            class_name,
            w!("a8-devtools-taskbar-speed"),
            style,
            init_x,
            init_y,
            init_w,
            init_h,
            owner_hwnd,
            None,
            Some(hinstance),
            None,
        ) {
            Ok(h) => h,
            Err(_) => return,
        };

        // Enable 100% transparent background
        let _ = SetLayeredWindowAttributes(hwnd, TRANSPARENT_COLOR_KEY, 0, LWA_COLORKEY);

        *hwnd_out.lock() = Some(SendHwnd::from_hwnd(hwnd));

        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            init_x,
            init_y,
            init_w,
            init_h,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );

        // Timer for lightweight 1-second fullscreen detection (pure user-space, zero IO)
        let _ = SetTimer(Some(hwnd), 101, 1000, None);

        let mut msg = windows::Win32::UI::WindowsAndMessaging::MSG::default();
        while is_alive.load(Ordering::Relaxed) && GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let _ = DestroyWindow(hwnd);
    }
}

unsafe extern "system" fn taskbar_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_TIMER => {
            unsafe {
                let is_fullscreen = is_fullscreen_app_active(hwnd);
                let is_visible = IsWindowVisible(hwnd).as_bool();
                if is_fullscreen {
                    if is_visible {
                        let _ = ShowWindow(hwnd, SW_HIDE);
                    }
                } else if !is_visible {
                    let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                }
            }
            LRESULT(0)
        }
        WM_TASKBAR_SPEED_UPDATE => {
            unsafe {
                let is_fullscreen = is_fullscreen_app_active(hwnd);
                let is_visible = IsWindowVisible(hwnd).as_bool();

                if is_fullscreen {
                    // Fullscreen video/game detected: auto-hide to avoid blocking content
                    if is_visible {
                        let _ = ShowWindow(hwnd, SW_HIDE);
                    }
                } else {
                    // Exit fullscreen: auto-restore
                    if !is_visible {
                        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                    }
                    let _ = InvalidateRect(Some(hwnd), None, false);
                    let _ = SetWindowPos(
                        hwnd,
                        Some(HWND_TOPMOST),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    );
                }
            }
            LRESULT(0)
        }
        WM_PAINT => {
            unsafe {
                let mut ps = PAINTSTRUCT::default();
                let hdc = BeginPaint(hwnd, &mut ps);

                paint_speed_bar(hwnd, hdc);

                let _ = EndPaint(hwnd, &ps);
            }
            LRESULT(0)
        }
        WM_LBUTTONDOWN => {
            unsafe {
                // Record mouse down coordinates for smooth dragging
                let mut pt = POINT::default();
                let _ = GetCursorPos(&mut pt);
                let mut win_rect = RECT::default();
                let _ = GetWindowRect(hwnd, &mut win_rect);

                *DRAG_STATE.lock() = Some(DragContext {
                    cursor_x: pt.x,
                    cursor_y: pt.y,
                    win_x: win_rect.left,
                    win_y: win_rect.top,
                });
                let _ = SetCapture(hwnd);

                // Keep topmost immediately on click
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
            LRESULT(0)
        }
        WM_MOUSEMOVE => {
            unsafe {
                if let Some(ctx) = *DRAG_STATE.lock() {
                    let mut pt = POINT::default();
                    let _ = GetCursorPos(&mut pt);
                    let dx = pt.x - ctx.cursor_x;
                    let dy = pt.y - ctx.cursor_y;

                    // Apply displacement if moved
                    if dx.abs() > 1 || dy.abs() > 1 {
                        let _ = SetWindowPos(
                            hwnd,
                            Some(HWND_TOPMOST),
                            ctx.win_x + dx,
                            ctx.win_y + dy,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOACTIVATE,
                        );
                    }
                }
            }
            LRESULT(0)
        }
        WM_LBUTTONUP => {
            unsafe {
                let _ = ReleaseCapture();
                *DRAG_STATE.lock() = None;

                // Ensure topmost state after releasing mouse
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
            LRESULT(0)
        }
        WM_LBUTTONDBLCLK => {
            // Double click: open/restore main window
            if let Some(app) = GLOBAL_TAURI_APP.get() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            LRESULT(0)
        }
        WM_RBUTTONUP => {
            unsafe {
                show_taskbar_context_menu(hwnd);
            }
            LRESULT(0)
        }
        WM_COMMAND => {
            let cmd_id = wparam.0 as usize;
            match cmd_id {
                MENU_RESET_POS => unsafe {
                    let (x, y, w, h) = calculate_dock_position();
                    let _ = SetWindowPos(
                        hwnd,
                        Some(HWND_TOPMOST),
                        x,
                        y,
                        w,
                        h,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW,
                    );
                },
                MENU_TOGGLE_WIN => {
                    if let Some(app) = GLOBAL_TAURI_APP.get() {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                }
                MENU_QUIT_APP => {
                    if let Some(app) = GLOBAL_TAURI_APP.get() {
                        app.exit(0);
                    }
                }
                _ => {}
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            unsafe {
                let _ = KillTimer(Some(hwnd), 101);
                PostQuitMessage(0);
            }
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

unsafe fn paint_speed_bar(hwnd: HWND, hdc: HDC) {
    let mut rect = RECT::default();
    let _ = unsafe { GetClientRect(hwnd, &mut rect) };
    let w = rect.right - rect.left;
    let h = rect.bottom - rect.top;

    // Double buffering for 100% flicker-free rendering
    let mem_dc = match unsafe { CreateCompatibleDC(Some(hdc)) } {
        dc if !dc.is_invalid() => dc,
        _ => return,
    };
    let mem_bmp = match unsafe { CreateCompatibleBitmap(hdc, w, h) } {
        bmp if !bmp.is_invalid() => bmp,
        _ => {
            let _ = unsafe { DeleteDC(mem_dc) };
            return;
        }
    };
    let old_bmp = unsafe { SelectObject(mem_dc, mem_bmp.into()) };

    // 1. Fill background with TRANSPARENT_COLOR_KEY (Pure Black) -> Becomes 100% transparent via DWM
    let bg_brush = unsafe { CreateSolidBrush(TRANSPARENT_COLOR_KEY) };
    unsafe {
        FillRect(mem_dc, &rect, bg_brush);
    }

    // 2. Setup text rendering with larger and bolder font
    let _ = unsafe { SetBkMode(mem_dc, BACKGROUND_MODE(TRANSPARENT.0)) };

    // Larger font height: 16px (FW_SEMIBOLD 600 weight)
    let font_size = ((h / 2) - 1).clamp(15, 24);
    let font_name = w!("Microsoft YaHei UI");
    let hfont = unsafe {
        CreateFontW(
            font_size,
            0,
            0,
            0,
            FW_SEMIBOLD.0 as i32,
            0,
            0,
            0,
            windows::Win32::Graphics::Gdi::DEFAULT_CHARSET,
            windows::Win32::Graphics::Gdi::OUT_DEFAULT_PRECIS,
            windows::Win32::Graphics::Gdi::CLIP_DEFAULT_PRECIS,
            windows::Win32::Graphics::Gdi::CLEARTYPE_QUALITY,
            windows::Win32::Graphics::Gdi::DEFAULT_PITCH.0 as u32,
            font_name,
        )
    };
    let old_font = unsafe { SelectObject(mem_dc, hfont.into()) };

    let (up_text, down_text) = if let Some(state_arc) = GLOBAL_SPEED_STATE.get() {
        let guard = state_arc.read();
        (guard.upload_str.clone(), guard.download_str.clone())
    } else {
        ("▲ 0 B/s".to_string(), "▼ 0 B/s".to_string())
    };

    let mid_y = h / 2;

    // Row 1: Upload (Vibrant Amber Gold: RGB 255, 191, 0 -> BGR: 0x0000BFFF)
    let _ = unsafe { SetTextColor(mem_dc, COLORREF(0x0000BFFF)) };
    let mut up_rect = RECT {
        left: 2,
        top: 0,
        right: w,
        bottom: mid_y,
    };
    let mut up_wide: Vec<u16> = up_text.encode_utf16().chain(std::iter::once(0)).collect();
    let up_len = up_wide.len().saturating_sub(1);
    let _ = unsafe {
        DrawTextW(
            mem_dc,
            &mut up_wide[..up_len],
            &mut up_rect,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE,
        )
    };

    // Row 2: Download (Sky Blue: RGB 56, 189, 248 -> BGR: 0x00F8BD38)
    let _ = unsafe { SetTextColor(mem_dc, COLORREF(0x00F8BD38)) };
    let mut down_rect = RECT {
        left: 2,
        top: mid_y,
        right: w,
        bottom: h,
    };
    let mut down_wide: Vec<u16> = down_text.encode_utf16().chain(std::iter::once(0)).collect();
    let down_len = down_wide.len().saturating_sub(1);
    let _ = unsafe {
        DrawTextW(
            mem_dc,
            &mut down_wide[..down_len],
            &mut down_rect,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE,
        )
    };

    // BitBlt to display DC
    let _ = unsafe { BitBlt(hdc, 0, 0, w, h, Some(mem_dc), 0, 0, SRCCOPY) };

    // Cleanup GDI objects
    unsafe {
        SelectObject(mem_dc, old_font);
        SelectObject(mem_dc, old_bmp);

        let _ = DeleteObject(hfont.into());
        let _ = DeleteObject(bg_brush.into());
        let _ = DeleteObject(mem_bmp.into());
        let _ = DeleteDC(mem_dc);
    }
}

unsafe fn show_taskbar_context_menu(hwnd: HWND) {
    let mut pt = POINT::default();
    let _ = unsafe { GetCursorPos(&mut pt) };

    if let Ok(menu) = unsafe { CreatePopupMenu() } {
        let (up_text, down_text) = if let Some(state_arc) = GLOBAL_SPEED_STATE.get() {
            let guard = state_arc.read();
            (guard.upload_str.clone(), guard.download_str.clone())
        } else {
            ("▲ 0 B/s".to_string(), "▼ 0 B/s".to_string())
        };
        let summary = format!("实时网速: {}  {}", up_text, down_text);
        let summary_wide: Vec<u16> = summary.encode_utf16().chain(std::iter::once(0)).collect();

        unsafe {
            let _ = AppendMenuW(
                menu,
                MF_STRING | MF_DISABLED | MF_GRAYED,
                MENU_SPEED_INFO,
                PCWSTR(summary_wide.as_ptr()),
            );
            let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
            let _ = AppendMenuW(
                menu,
                MF_STRING,
                MENU_RESET_POS,
                w!("复位到任务栏通知区左侧"),
            );
            let _ = AppendMenuW(
                menu,
                MF_STRING,
                MENU_TOGGLE_WIN,
                w!("显示 / 隐藏 a8-devtools 工作台"),
            );
            let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
            let _ = AppendMenuW(menu, MF_STRING, MENU_QUIT_APP, w!("退出 a8-devtools"));

            let _ = TrackPopupMenu(
                menu,
                TPM_RIGHTBUTTON | TPM_BOTTOMALIGN | TPM_LEFTALIGN,
                pt.x,
                pt.y,
                Some(0),
                hwnd,
                None,
            );

            let _ = DestroyMenu(menu);
        }
    }
}
