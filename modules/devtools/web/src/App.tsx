import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { EChartsCoreOption } from 'echarts/core';
import { EChartBox } from './components/EChartBox';
import {
  Button,
  Chip,
  Description,
  InputGroup,
  Kbd,
  Label,
  Modal,
  Radio,
  RadioGroup,
  Switch,
  Tabs,
  TextField,
  Tooltip,
} from '@heroui/react';
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Command,
  Copy,
  ExternalLink,
  FolderGit2,
  FolderOpen,
  Globe,
  HardDrive,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';

interface ChangeItem {
  rel_path: string;
  change_type: string;
  size_bytes: number;
  size_kb: number;
}

interface WorkspaceCard {
  name: string;
  target_path: string;
  source_path: string;
  diff_path: string;
  mode: string;
  is_alive: boolean;
  pid: number | null;
  modified_count: number;
  added_count: number;
  deleted_count: number;
  total_diff_kb: number;
  changes: ChangeItem[];
}

interface SystemStatus {
  winfsp_driver_running: boolean;
  is_admin: boolean;
  total_workspaces: number;
  active_workspaces: number;
  total_diff_bytes: number;
  saved_disk_bytes: number;
}

interface AppSettings {
  autostart: boolean;
  taskbar_speed_enabled: boolean;
  sample_interval_secs: number;
  fullscreen_hide: boolean;
}

interface ToastItem {
  id: number;
  title: string;
  tone: 'success' | 'info' | 'danger';
}

async function callTauri<T = any>(command: string, args: Record<string, any> = {}): Promise<T | null> {
  const invoker = (window as any).__TAURI__?.core?.invoke || (window as any).__TAURI__?.invoke;
  if (invoker) {
    try {
      return await invoker(command, args);
    } catch (e) {
      console.error(`[Tauri] ${command} failed:`, e);
      throw e;
    }
  }
  console.warn(`[Mock] ${command}:`, args);
  return null;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0.0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function PathSegment({ path }: { path: string }) {
  const clean = path.replace(/^\\\\\?\\/, '').replace(/\\/g, '/');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length <= 2) {
    return <span className="font-mono text-[10.5px] text-foreground/80 truncate">{clean}</span>;
  }
  const root = parts[0];
  const middle = parts.slice(1, -1).join('/');
  const leaf = parts[parts.length - 1];

  return (
    <div className="flex items-center gap-0.5 font-mono text-[10.5px] truncate min-w-0">
      <span className="text-muted shrink-0">{root}/</span>
      <span className="text-foreground/60 truncate">{middle}/</span>
      <span className="font-semibold text-foreground shrink-0">{leaf}</span>
    </div>
  );
}

const NAV_ITEMS = [
  { id: 'mappings' as const, group: '核心特性', label: '虚拟镜像映射', icon: FolderGit2 },
  { id: 'hosts' as const, group: '核心特性', label: 'Hosts 维护', icon: Globe, badge: 'DNS' },
  { id: 'doctor' as const, group: '系统运维', label: '内核与驱动', icon: Activity },
  { id: 'settings' as const, group: '系统运维', label: '偏好设置', icon: Settings },
];

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('a8-devtools-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('a8-devtools-sidebar-collapsed') === 'true';
  });
  const [activeTab, setActiveTab] = useState<'mappings' | 'hosts' | 'doctor' | 'settings'>('mappings');
  const [inspectorTab, setInspectorTab] = useState<'topology' | 'diff'>('topology');
  const [workspaces, setWorkspaces] = useState<WorkspaceCard[]>([]);
  const [selectedWsIdx, setSelectedWsIdx] = useState<number>(0);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [netSpeed, setNetSpeed] = useState({ up: '0 B/s', down: '0 B/s' });
  const [hostsContent, setHostsContent] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    autostart: false,
    taskbar_speed_enabled: true,
    sample_interval_secs: 5,
    fullscreen_hide: true,
  });

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceCard | null>(null);

  const [newWsName, setNewWsName] = useState('');
  const [newWsSource, setNewWsSource] = useState('');
  const [newWsTarget, setNewWsTarget] = useState('');
  const [newWsMode, setNewWsMode] = useState<string>('direct');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pushToast = (title: string, tone: ToastItem['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { id, title, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  };

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }
    localStorage.setItem('a8-devtools-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('a8-devtools-sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleMin = async () => { await callTauri('app_minimize'); };
  const handleMax = async () => { await callTauri('app_maximize'); };
  const handleClose = async () => { await callTauri('app_close'); };

  const handleCopy = (text: string, key: string, label: string) => {
    const clean = text.replace(/^\\\\\?\\/, '');
    navigator.clipboard.writeText(clean);
    setCopiedKey(key);
    pushToast(`已复制${label}路径`, 'success');
    setTimeout(() => setCopiedKey(null), 1400);
  };

  const loadData = async (silent = true) => {
    try {
      const [ws, status] = await Promise.all([
        callTauri<WorkspaceCard[]>('get_workspaces'),
        callTauri<SystemStatus>('get_system_status'),
      ]);
      if (ws) setWorkspaces(ws);
      if (status) setSystemStatus(status);
      if (!silent) pushToast('工作区状态已刷新', 'info');
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData(true);

    const fetchSpeed = () => {
      callTauri<any>('get_net_speed')
        .then((res) => {
          if (res) {
            setNetSpeed({
              up: res.upload_formatted || '0 B/s',
              down: res.download_formatted || '0 B/s',
            });
          }
        })
        .catch(() => {});
    };

    fetchSpeed();
    const speedTimer = setInterval(fetchSpeed, 2000);

    if ((window as any).__TAURI__?.event?.listen) {
      (window as any).__TAURI__.event
        .listen('net-speed-update', (event: any) => {
          const payload = event.payload;
          if (payload) {
            setNetSpeed({
              up: payload.upload_formatted || '0 B/s',
              down: payload.download_formatted || '0 B/s',
            });
          }
        })
        .catch(() => {});
    }

    return () => clearInterval(speedTimer);
  }, []);

  const selectedWs = workspaces[selectedWsIdx] || workspaces[0];

  const handleOpenExplorer = async (path: string) => {
    try {
      await callTauri('open_explorer', { path });
    } catch (e: any) {
      pushToast(`打开资源管理器失败: ${e}`, 'danger');
    }
  };

  const handleLocateSource = async (path: string) => {
    try {
      await callTauri('locate_in_explorer', { path });
    } catch (e: any) {
      pushToast(`定位源目录失败: ${e}`, 'danger');
    }
  };

  const handleToggleMount = async (ws: WorkspaceCard) => {
    try {
      if (ws.is_alive) {
        await callTauri('unlink_workspace', { target: ws.target_path });
        pushToast(`[${ws.name}] 已脱机卸载`, 'info');
      } else {
        await callTauri('resume_workspace', { target: ws.target_path });
        pushToast(`[${ws.name}] 已恢复挂载`, 'success');
      }
      await loadData(true);
    } catch (e: any) {
      pushToast(`状态切换失败: ${e}`, 'danger');
    }
  };

  const confirmDeleteWorkspace = async () => {
    if (!deleteTarget) return;
    try {
      await callTauri('delete_workspace', { target: deleteTarget.target_path });
      pushToast(`已彻底移除映射 [${deleteTarget.name}]`, 'success');
      setDeleteTarget(null);
      setSelectedWsIdx(0);
      await loadData(true);
    } catch (e: any) {
      pushToast(`移除失败: ${e}`, 'danger');
    }
  };

  const handlePickSource = async () => {
    const p = await callTauri<string | null>('pick_folder');
    if (p) {
      setNewWsSource(p);
      if (!newWsName.trim()) {
        const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
        if (parts.length > 0) setNewWsName(parts[parts.length - 1]);
      }
    }
  };

  const handlePickTarget = async () => {
    const p = await callTauri<string | null>('pick_folder');
    if (p) setNewWsTarget(p);
  };

  const handleCreateWorkspace = async () => {
    if (!newWsSource.trim() || !newWsTarget.trim()) {
      pushToast('请先选择物理源仓与虚拟挂载目标路径', 'danger');
      return;
    }
    setIsSubmitting(true);
    try {
      await callTauri('create_workspace', {
        source: newWsSource.trim(),
        target: newWsTarget.trim(),
        direct: newWsMode === 'direct',
      });
      setIsCreateOpen(false);
      setNewWsName('');
      setNewWsSource('');
      setNewWsTarget('');
      pushToast('虚拟镜像通道已创建并就绪', 'success');
      await loadData(true);
    } catch (e: any) {
      pushToast(`创建挂载失败: ${e}`, 'danger');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredWorkspaces = workspaces.filter(
    (ws) =>
      ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ws.target_path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ws.source_path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const switchTab = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (tab === 'hosts') {
      callTauri<string>('get_hosts_content').then((txt) => txt && setHostsContent(txt));
    } else if (tab === 'settings') {
      callTauri<AppSettings>('get_app_settings').then((s) => s && setAppSettings(s));
    }
  };

  const mirrorSummary = useMemo(() => {
    const directCount = workspaces.filter((w) => w.mode === 'direct_mirror').length;
    const cowCount = workspaces.length - directCount;
    const added = workspaces.reduce((sum, w) => sum + (w.added_count || 0), 0);
    const modified = workspaces.reduce((sum, w) => sum + (w.modified_count || 0), 0);
    const deleted = workspaces.reduce((sum, w) => sum + (w.deleted_count || 0), 0);
    return { directCount, cowCount, added, modified, deleted };
  }, [workspaces]);

  const paletteCommands = useMemo(() => {
    const base = [
      { id: 'new', title: '新建虚拟镜像映射', hint: '挂载新工作区', action: () => setIsCreateOpen(true) },
      { id: 'sidebar', title: sidebarCollapsed ? '展开左侧导航栏' : '收起左侧导航栏', hint: 'Ctrl+B', action: () => setSidebarCollapsed((v) => !v) },
      { id: 'theme', title: theme === 'light' ? '切换为 Obsidian 暗夜工作台' : '切换为 Porcelain 极光亮色', hint: '切换主题皮肤', action: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) },
      { id: 'tab-mappings', title: '前往：虚拟镜像映射', hint: '工作区总览', action: () => switchTab('mappings') },
      { id: 'tab-hosts', title: '前往：Hosts 维护', hint: '编辑系统 DNS', action: () => switchTab('hosts') },
      { id: 'tab-doctor', title: '前往：内核与驱动诊断', hint: 'WinFsp 健康检查', action: () => switchTab('doctor') },
      { id: 'tab-settings', title: '前往：偏好设置', hint: '任务栏与自启', action: () => switchTab('settings') },
      { id: 'dir', title: '打开全局配置目录', hint: 'Explorer', action: () => callTauri('open_global_dir') },
    ];
    return base.filter((c) =>
      c.title.toLowerCase().includes(paletteQuery.toLowerCase()) ||
      c.hint.toLowerCase().includes(paletteQuery.toLowerCase())
    );
  }, [paletteQuery, theme]);

  const storageChartOption = useMemo<EChartsCoreOption>(() => {
    const savedBytes = systemStatus?.saved_disk_bytes || 0;
    const diffBytes = systemStatus?.total_diff_bytes || 0;
    const totalBytes = savedBytes + diffBytes;
    const ratio = totalBytes > 0 ? Number(((savedBytes / totalBytes) * 100).toFixed(1)) : 99.1;
    const isDark = theme === 'dark';

    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: isDark ? '#18181B' : '#FFFFFF',
        borderColor: isDark ? '#27272A' : '#E4E4E7',
        borderWidth: 1,
        textStyle: { color: isDark ? '#F4F4F5' : '#18181B', fontSize: 11 },
        formatter: (params: any) =>
          `<div style="font-weight:600;margin-bottom:2px">${params.name}</div><div>${formatBytes(params.value)} (${params.percent}%)</div>`,
      },
      series: [
        {
          name: '存储效能',
          type: 'pie',
          radius: ['66%', '86%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          padAngle: 3,
          itemStyle: { borderRadius: 6 },
          label: {
            show: true,
            position: 'center',
            formatter: `{pct|${ratio}%}\n{sub|节省率}`,
            rich: {
              pct: {
                fontSize: 15,
                fontWeight: 600,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                color: isDark ? '#F4F4F5' : '#0F172A',
                lineHeight: 20,
              },
              sub: {
                fontSize: 9.5,
                color: isDark ? '#A1A1AA' : '#64748B',
                lineHeight: 14,
              },
            },
          },
          labelLine: { show: false },
          data: [
            {
              value: savedBytes > 0 ? savedBytes : 100,
              name: '零拷贝节省空间',
              itemStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 1,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: '#2563EB' },
                    { offset: 1, color: '#60A5FA' },
                  ],
                },
              },
            },
            {
              value: diffBytes > 0 ? diffBytes : 1,
              name: '写时差异开销',
              itemStyle: { color: isDark ? '#27272A' : '#E2E8F0' },
            },
          ],
        },
      ],
    };
  }, [systemStatus, theme]);

  const modeBarOption = useMemo<EChartsCoreOption>(() => {
    const isDark = theme === 'dark';
    const categories = ['直通镜像', 'CoW 隔离', '运行中', '已变更'];
    const values = [
      mirrorSummary.directCount,
      mirrorSummary.cowCount,
      workspaces.filter((w) => w.is_alive).length,
      mirrorSummary.added + mirrorSummary.modified + mirrorSummary.deleted,
    ];
    const colors = ['#2563EB', '#6366F1', '#10B981', '#F59E0B'];

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'none' },
        backgroundColor: isDark ? '#18181B' : '#FFFFFF',
        borderColor: isDark ? '#27272A' : '#E4E4E7',
        borderWidth: 1,
        textStyle: { color: isDark ? '#F4F4F5' : '#18181B', fontSize: 11 },
      },
      grid: { left: 62, right: 24, top: 4, bottom: 4, containLabel: false },
      xAxis: {
        type: 'value',
        show: false,
        max: Math.max(...values, 3),
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: categories,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: isDark ? '#A1A1AA' : '#64748B',
          fontSize: 10,
        },
      },
      series: [
        {
          type: 'bar',
          barWidth: 7,
          showBackground: true,
          backgroundStyle: {
            color: isDark ? 'rgba(255,255,255,0.05)' : '#F1F5F9',
            borderRadius: 6,
          },
          data: values.map((val, idx) => ({
            value: val,
            itemStyle: { color: colors[idx], borderRadius: 6 },
          })),
          label: {
            show: true,
            position: 'right',
            color: isDark ? '#E4E4E7' : '#334155',
            fontSize: 10,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          },
        },
      ],
    };
  }, [mirrorSummary, workspaces, theme]);

  return (
    <div className="relative h-screen w-screen overflow-hidden flex flex-row bg-background text-foreground text-[12px] antialiased select-none">
      {/* ========================================================================= */}
      {/* 左侧栏：可收起磨砂玻璃工作台导航轨 (214px <-> 66px) */}
      {/* ========================================================================= */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-[66px]' : 'w-[214px]'
        } transition-[width] duration-200 ease-out bg-surface/85 backdrop-blur-2xl border-r border-border/70 flex flex-col shrink-0 justify-between h-full z-20 overflow-hidden`}
      >
        <div className="flex flex-col">
          {/* 顶部品牌区（与右侧工具栏等高对齐，可拖拽） */}
          <div
            data-tauri-drag-region
            className={`h-11 ${
              sidebarCollapsed ? 'px-0 justify-center' : 'px-4'
            } flex items-center gap-2.5 border-b border-border/60 cursor-default`}
          >
            <img
              src="./app-icon.png"
              alt="A8 DevTools"
              className="w-7 h-7 rounded-lg shadow-[0_2px_8px_rgba(37,99,235,0.22)] shrink-0 object-cover pointer-events-none"
            />
            {!sidebarCollapsed && (
              <div className="flex flex-col leading-tight min-w-0 pointer-events-none">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-foreground tracking-tight">DevTools</span>
                  <Chip size="sm" variant="soft" color="accent" className="h-4 px-1.5 text-[8.5px] font-mono">
                    <Chip.Label>PRO</Chip.Label>
                  </Chip>
                </div>
              </div>
            )}
          </div>

          {/* 分组导航 */}
          <div className={`${sidebarCollapsed ? 'px-2 space-y-2 mt-3' : 'px-2.5 space-y-4 mt-3'}`}>
            {(['核心特性', '系统运维'] as const).map((group) => (
              <div key={group}>
                {!sidebarCollapsed ? (
                  <div className="px-2.5 pb-1.5 text-[9px] font-mono font-semibold tracking-[0.12em] text-muted/70">
                    {group}
                  </div>
                ) : (
                  <div className="h-[1px] bg-border/50 mx-2 mb-1.5" />
                )}
                <nav className="space-y-0.5">
                  {NAV_ITEMS.filter((n) => n.group === group).map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    const navBtn = (
                      <button
                        key={item.id}
                        onClick={() => switchTab(item.id)}
                        className={`relative w-full flex items-center ${
                          sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'justify-between px-2.5 py-2'
                        } rounded-xl text-[11.5px] transition-colors duration-150 cursor-pointer ${
                          isActive ? 'text-foreground font-semibold' : 'text-muted hover:text-foreground'
                        }`}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="sidebar-active-pill"
                            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                            className="absolute inset-0 rounded-xl bg-surface-secondary border border-border/80 shadow-[0_1px_4px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)]"
                          />
                        )}
                        <span className="relative z-10 flex items-center gap-2.5">
                          <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-blue-500' : 'text-muted'}`} />
                          {!sidebarCollapsed && <span>{item.label}</span>}
                        </span>
                        {!sidebarCollapsed && (
                          <span className="relative z-10 flex items-center">
                            {item.id === 'mappings' && (
                              <span className={`text-[9.5px] font-mono tabular-nums px-1.5 py-[1px] rounded-md ${
                                isActive ? 'bg-blue-500/12 text-blue-600 dark:text-blue-400 font-semibold' : 'bg-default/70 text-muted'
                              }`}>
                                {workspaces.length}
                              </span>
                            )}
                            {item.badge && (
                              <span className="text-[8.5px] font-mono text-muted/80">{item.badge}</span>
                            )}
                            {item.id === 'doctor' && (
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                systemStatus?.winfsp_driver_running
                                  ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.75)]'
                                  : 'bg-rose-500'
                              }`} />
                            )}
                          </span>
                        )}
                      </button>
                    );

                    return sidebarCollapsed ? (
                      <Tooltip key={item.id} delay={150}>
                        <Tooltip.Trigger className="w-full">{navBtn}</Tooltip.Trigger>
                        <Tooltip.Content className="text-[11px] px-2.5 py-1 rounded-lg">{item.label}</Tooltip.Content>
                      </Tooltip>
                    ) : (
                      navBtn
                    );
                  })}
                </nav>
              </div>
            ))}
          </div>
        </div>

        {/* 底部实时波形微仪表 */}
        <div className={`${sidebarCollapsed ? 'p-2' : 'p-3'} border-t border-border/60 flex flex-col gap-2.5 bg-surface-secondary/40`}>
          {!sidebarCollapsed ? (
            <>
              <div className="rounded-xl bg-surface border border-border/80 p-2.5 shadow-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9.5px] font-medium text-muted flex items-center gap-1">
                    <Activity className="w-2.5 h-2.5 text-blue-500" />
                    实时网速遥测
                  </span>
                  <span className="text-[8.5px] font-mono text-emerald-600 dark:text-emerald-400">LIVE</span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px] tabular-nums">
                  <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                    <ArrowUp className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{netSpeed.up}</span>
                  </div>
                  <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold justify-end truncate">
                    <ArrowDown className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{netSpeed.down}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-muted px-0.5">
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    systemStatus?.winfsp_driver_running ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                  }`} />
                  <span>{systemStatus?.winfsp_driver_running ? 'WinFsp 在线' : '内核未就绪'}</span>
                </span>
                <button
                  onClick={() => callTauri('open_global_dir')}
                  className="text-muted hover:text-blue-500 transition-colors font-medium text-[10px] cursor-pointer"
                >
                  配置目录
                </button>
              </div>
            </>
          ) : (
            <Tooltip delay={150}>
              <Tooltip.Trigger className="w-full flex justify-center">
                <button
                  onClick={() => callTauri('open_global_dir')}
                  className="w-9 h-9 rounded-xl bg-surface border border-border/80 flex items-center justify-center text-muted hover:text-blue-500 transition-colors cursor-pointer relative"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                    systemStatus?.winfsp_driver_running ? 'bg-emerald-500' : 'bg-rose-500'
                  }`} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content className="text-[11px] px-2.5 py-1 rounded-lg">
                打开配置目录（{systemStatus?.winfsp_driver_running ? 'WinFsp 在线' : '内核未就绪'}）
              </Tooltip.Content>
            </Tooltip>
          )}
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 右侧主区：点阵光影画布 + Bento 驾驶舱 + HeroUI 交互面板 */}
      {/* ========================================================================= */}
      <main className="relative flex-1 flex flex-col h-full overflow-hidden bg-background">
        {/* 微妙的建筑微点阵与顶角极光渐变 */}
        <div
          className="pointer-events-none absolute inset-0 studio-dot-grid opacity-45 dark:opacity-25"
          style={{ maskImage: 'radial-gradient(ellipse at 70% 10%, black 20%, transparent 80%)' }}
        />
        <div className="pointer-events-none absolute -top-32 right-0 w-[460px] h-[280px] rounded-full bg-blue-500/[0.07] dark:bg-blue-500/[0.12] blur-3xl" />

        {/* 顶栏可拖拽区域（原生 data-tauri-drag-region 处理单击拖拽与双击最大化） */}
        <header
          data-tauri-drag-region
          className="relative z-10 h-11 px-5 flex items-center justify-between border-b border-border/60 shrink-0 bg-surface/70 backdrop-blur-xl"
        >
          <div className="flex items-center gap-2.5">
            <Tooltip delay={200}>
              <Tooltip.Trigger>
                <button
                  onClick={() => setSidebarCollapsed((v) => !v)}
                  className="w-7 h-7 rounded-lg border border-border/70 bg-surface-secondary/60 hover:bg-surface-secondary flex items-center justify-center text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  {sidebarCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content className="text-[10.5px] px-2 py-1 rounded-lg">
                {sidebarCollapsed ? '展开侧边栏 (Ctrl+B)' : '收起侧边栏 (Ctrl+B)'}
              </Tooltip.Content>
            </Tooltip>

            <div className="flex items-center gap-2 pointer-events-none">
              <span className="text-[11px] text-muted">工作台</span>
              <span className="text-border">/</span>
              <span className="text-[11.5px] font-semibold text-foreground">
                {NAV_ITEMS.find((n) => n.id === activeTab)?.label}
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-[9.5px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-[1px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                &lt; 0.05 ms
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Raycast 风格命令面板触发器 */}
            <button
              onClick={() => setIsPaletteOpen(true)}
              className="h-7 px-2.5 rounded-lg border border-border/80 bg-surface-secondary/70 hover:bg-surface-secondary text-[11px] text-muted hover:text-foreground flex items-center gap-2 transition-all cursor-pointer"
            >
              <Command className="w-3 h-3" />
              <span>命令面板</span>
              <Kbd className="text-[9px] px-1 py-0">
                <Kbd.Content>Ctrl+K</Kbd.Content>
              </Kbd>
            </button>

            {/* 一键 Porcelain Light / Obsidian Dark 切换 */}
            <Tooltip delay={200}>
              <Tooltip.Trigger>
                <button
                  onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                  className="w-7 h-7 rounded-lg border border-border/80 bg-surface-secondary/70 hover:bg-surface-secondary flex items-center justify-center text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  {theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content className="text-[10.5px] px-2 py-1 rounded-lg">
                {theme === 'light' ? '切换 Obsidian 暗夜模式' : '切换 Porcelain 亮色模式'}
              </Tooltip.Content>
            </Tooltip>

            <div className="w-[1px] h-3.5 bg-border mx-0.5" />

            {/* 窗口控制 */}
            <div className="flex items-center gap-0.5 text-muted">
              <button onClick={handleMin} title="最小化" className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-surface-secondary hover:text-foreground transition-colors cursor-pointer">
                <Minus className="w-3 h-3" />
              </button>
              <button onClick={handleMax} title="最大化" className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-surface-secondary hover:text-foreground transition-colors cursor-pointer">
                <Square className="w-2.5 h-2.5" />
              </button>
              <button onClick={handleClose} title="隐藏至托盘" className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-rose-500/15 hover:text-rose-500 transition-colors cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        </header>

        {/* 内容滚动区域 */}
        <div className="relative z-10 flex-1 overflow-y-auto px-6 py-5">
          <AnimatePresence mode="wait">
            {activeTab === 'mappings' && (
              <motion.div
                key="mappings"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="flex flex-col gap-5 max-w-[1280px] mx-auto"
              >
                {/* ================================================================= */}
                {/* 1. 一体化素雅纯白 Hero 区域 + ECharts 专业矢量图表 */}
                {/* ================================================================= */}
                <section className="rounded-2xl bg-surface border border-border/80 px-5 py-4 shadow-surface grid grid-cols-12 items-center gap-5">
                  {/* 左区：核心存储节省与内嵌关键指标 (5 cols) */}
                  <div className="col-span-12 lg:col-span-5 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2.5">
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-muted bg-surface-secondary border border-border/70 rounded-full px-2.5 py-0.5">
                          <Zap className="w-3 h-3 text-blue-500" />
                          <span>Zero-Copy NTFS</span>
                        </span>
                        <Chip size="sm" variant="soft" color="default" className="h-5 text-[9.5px] font-mono">
                          <Chip.Label>WinFsp 2.x</Chip.Label>
                        </Chip>
                      </div>
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-[28px] font-semibold tracking-tight font-mono tabular-nums text-foreground leading-none">
                          {formatBytes(systemStatus?.saved_disk_bytes || 0)}
                        </span>
                        <span className="text-[11px] text-muted">累计节省物理存储空间</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-border/60 grid grid-cols-3 gap-3 text-[10.5px]">
                      <div>
                        <span className="text-muted block">活动节点</span>
                        <span className="font-mono font-semibold text-foreground tabular-nums mt-0.5 block">
                          {workspaces.filter((w) => w.is_alive).length} / {workspaces.length}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted block">内核引擎</span>
                        <span className={`font-semibold mt-0.5 flex items-center gap-1 ${
                          systemStatus?.winfsp_driver_running ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            systemStatus?.winfsp_driver_running ? 'bg-emerald-500' : 'bg-rose-500'
                          }`} />
                          {systemStatus?.winfsp_driver_running ? '直通就绪' : '未启动'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted block">差异开销</span>
                        <span className="font-mono font-semibold text-foreground tabular-nums mt-0.5 block">
                          {formatBytes(systemStatus?.total_diff_bytes || 0)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 中区：ECharts 空间节省率圆环图 (3 cols) */}
                  <div className="col-span-12 sm:col-span-5 lg:col-span-3 flex items-center justify-center lg:border-l lg:border-border/60 lg:pl-4">
                    <div className="w-[126px] h-[126px]">
                      <EChartBox option={storageChartOption} className="w-full h-full" />
                    </div>
                  </div>

                  {/* 右区：ECharts 镜像架构与变更分布条形图 (4 cols) */}
                  <div className="col-span-12 sm:col-span-7 lg:col-span-4 lg:border-l lg:border-border/60 lg:pl-5 flex flex-col justify-between h-full">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-foreground">架构与变更分布</span>
                      <span className="text-[9.5px] font-mono text-muted">
                        {systemStatus?.is_admin ? 'Admin' : '标准隔离'}
                      </span>
                    </div>
                    <div className="w-full h-[104px]">
                      <EChartBox option={modeBarOption} className="w-full h-full" />
                    </div>
                  </div>
                </section>

                {/* ================================================================= */}
                {/* 2. 工作区映射通道列表 (零横向滚动 + Conduit 路径流卡片) */}
                {/* ================================================================= */}
                <section className="rounded-2xl bg-surface/95 backdrop-blur-md border border-border/80 shadow-surface overflow-hidden">
                  <div className="px-4 py-3 border-b border-border/60 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-[13px] font-semibold text-foreground">虚拟镜像工作区</h2>
                      <span className="text-[10px] font-mono text-muted bg-surface-secondary px-2 py-0.5 rounded-full border border-border/60">
                        {filteredWorkspaces.length} 映射
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative group">
                        <Search className="w-3.5 h-3.5 text-muted group-focus-within:text-blue-500 transition-colors absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="过滤工作区或路径..."
                          className="w-52 h-8 pl-8 pr-3 bg-surface-secondary/70 hover:bg-surface-secondary focus:bg-surface border border-border/80 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/15 rounded-xl text-[11px] text-foreground placeholder-muted outline-none transition-all"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                      </div>

                      <Tooltip delay={250}>
                        <Tooltip.Trigger>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 rounded-xl"
                            onPress={() => loadData(false)}
                          >
                            <RotateCw className="w-3.5 h-3.5" />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content className="text-[10.5px] px-2 py-1 rounded-lg">刷新状态</Tooltip.Content>
                      </Tooltip>

                      <Button
                        size="sm"
                        variant="primary"
                        className="h-8 px-3.5 rounded-xl text-[11.5px] font-medium shadow-[0_4px_14px_-4px_rgba(37,99,235,0.55)]"
                        onPress={() => setIsCreateOpen(true)}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>新建映射</span>
                      </Button>
                    </div>
                  </div>

                  {/* 卡片行式列表 (无横向滚动条、无拥挤感) */}
                  <div className="divide-y divide-border/50">
                    {filteredWorkspaces.length === 0 ? (
                      <div className="py-12 text-center text-muted text-[11.5px]">
                        暂无镜像映射记录，点击右上角「新建映射」快速建立零拷贝虚拟通道
                      </div>
                    ) : (
                      filteredWorkspaces.map((ws, idx) => {
                        const isSelected = selectedWs?.target_path === ws.target_path;
                        return (
                          <div
                            key={ws.target_path}
                            onClick={() => setSelectedWsIdx(idx)}
                            className={`relative px-4 py-3 flex items-center justify-between gap-4 cursor-pointer transition-colors group ${
                              isSelected ? 'bg-blue-500/[0.045] dark:bg-blue-500/[0.08]' : 'hover:bg-surface-secondary/50'
                            }`}
                          >
                            {isSelected && (
                              <motion.div
                                layoutId="active-row-indicator"
                                transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                                className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.75)]"
                              />
                            )}

                            {/* 左段：节点识别与状态 */}
                            <div className="w-[185px] shrink-0 flex items-center gap-2.5 min-w-0">
                              <div className={`relative w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                                ws.is_alive
                                  ? 'bg-blue-500/12 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20'
                                  : 'bg-surface-secondary text-muted'
                              }`}>
                                <FolderGit2 className="w-4 h-4" />
                                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface ${
                                  ws.is_alive ? 'bg-emerald-500' : 'bg-neutral-400'
                                }`} />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-[12px] text-foreground truncate" title={ws.name}>
                                    {ws.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[9.5px] font-mono text-muted tabular-nums">
                                    {ws.pid ? `PID ${ws.pid}` : '脱机'}
                                  </span>
                                  <span className="text-border">·</span>
                                  <span className="text-[9.5px] text-blue-600 dark:text-blue-400 font-medium">
                                    {ws.mode === 'direct_mirror' ? '零拷贝直通' : '写时复制'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* 中段：双路径视觉流 (Source -> Target, 自适应防溢出) */}
                            <div className="flex-1 min-w-0 grid grid-cols-11 items-center gap-2">
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(ws.source_path, `src-${idx}`, '物理源仓');
                                }}
                                title="点击复制物理源仓路径"
                                className="col-span-5 min-w-0 flex items-center justify-between gap-1.5 bg-surface-secondary/75 hover:bg-surface-secondary border border-border/60 rounded-xl px-2.5 py-1.5 transition-colors"
                              >
                                <PathSegment path={ws.source_path} />
                                <div className="flex items-center gap-1 shrink-0">
                                  {copiedKey === `src-${idx}` ? (
                                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="w-3 h-3 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                                  )}
                                  <button
                                    title="定位物理源文件"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleLocateSource(ws.source_path);
                                    }}
                                    className="p-0.5 rounded hover:bg-surface text-muted hover:text-foreground transition-colors cursor-pointer"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              <div className="col-span-1 flex items-center justify-center text-muted/60">
                                <ArrowRight className="w-3.5 h-3.5" />
                              </div>

                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(ws.target_path, `tgt-${idx}`, '虚拟挂载点');
                                }}
                                title="点击复制虚拟挂载路径"
                                className="col-span-5 min-w-0 flex items-center justify-between gap-1.5 bg-surface-secondary/75 hover:bg-surface-secondary border border-border/60 rounded-xl px-2.5 py-1.5 transition-colors"
                              >
                                <PathSegment path={ws.target_path} />
                                <div className="flex items-center gap-1 shrink-0">
                                  {copiedKey === `tgt-${idx}` ? (
                                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="w-3 h-3 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                                  )}
                                  <button
                                    title="在资源管理器中浏览"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenExplorer(ws.target_path);
                                    }}
                                    className="px-2 py-0.5 rounded-lg bg-blue-500/12 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px] font-semibold transition-colors cursor-pointer"
                                  >
                                    浏览
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* 右段：差异度量与快捷控制 */}
                            <div className="w-[155px] shrink-0 flex items-center justify-end gap-2">
                              <div className="text-right mr-1">
                                <span className="font-mono text-[11px] font-semibold text-foreground block tabular-nums">
                                  {ws.mode === 'direct_mirror' ? '0 B' : `${ws.total_diff_kb.toFixed(1)} KB`}
                                </span>
                                <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium block">
                                  省 99.1%
                                </span>
                              </div>

                              <Button
                                size="sm"
                                variant={ws.is_alive ? 'outline' : 'secondary'}
                                className="h-7 px-2.5 rounded-lg text-[10.5px]"
                                onPress={() => handleToggleMount(ws)}
                              >
                                {ws.is_alive ? '脱机' : '挂载'}
                              </Button>

                              <Button
                                isIconOnly
                                size="sm"
                                variant="danger-soft"
                                className="h-7 w-7 rounded-lg"
                                onPress={() => setDeleteTarget(ws)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                {/* ================================================================= */}
                {/* 3. HeroUI v3 Tabs 驱动的实时内核检验器 */}
                {/* ================================================================= */}
                {selectedWs && (
                  <section className="rounded-2xl bg-surface/95 backdrop-blur-md border border-border/80 p-4 shadow-surface">
                    <Tabs
                      selectedKey={inspectorTab}
                      onSelectionChange={(k) => setInspectorTab(k as 'topology' | 'diff')}
                      className="w-full"
                    >
                      <div className="flex items-center justify-between gap-4 pb-3 border-b border-border/50 mb-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                            <Sparkles className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[12.5px] font-semibold text-foreground">
                            {selectedWs.name} · 内核通道检验器
                          </span>
                          <Chip size="sm" variant="soft" color={selectedWs.is_alive ? 'success' : 'default'} className="h-5 text-[9.5px]">
                            <Chip.Label>{selectedWs.is_alive ? 'Passthrough Active' : 'Offline'}</Chip.Label>
                          </Chip>
                        </div>

                        <Tabs.ListContainer>
                          <Tabs.List aria-label="检验器视图" className="bg-surface-secondary p-0.5 rounded-xl">
                            <Tabs.Tab id="topology" className="px-3 py-1 text-[11px] rounded-lg">
                              通道拓扑
                              <Tabs.Indicator />
                            </Tabs.Tab>
                            <Tabs.Tab id="diff" className="px-3 py-1 text-[11px] rounded-lg">
                              写时变更流 ({selectedWs.changes?.length || 0})
                              <Tabs.Indicator />
                            </Tabs.Tab>
                          </Tabs.List>
                        </Tabs.ListContainer>
                      </div>

                      <Tabs.Panel id="topology" className="pt-0">
                        <div className="relative py-5 px-6 rounded-xl bg-surface-secondary/55 border border-border/60 flex items-center justify-between gap-4 overflow-hidden">
                          {/* 节点 1：物理源仓 */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-9 h-9 rounded-xl bg-surface border border-border shadow-xs flex items-center justify-center shrink-0">
                              <HardDrive className="w-4 h-4 text-muted" />
                            </div>
                            <div className="min-w-0">
                              <span className="text-[9.5px] font-mono uppercase text-muted block">Physical Source</span>
                              <span className="text-[11px] font-mono text-foreground truncate block">
                                {selectedWs.source_path.replace(/^\\\\\?\\/, '')}
                              </span>
                            </div>
                          </div>

                          {/* 动画脉冲管道 */}
                          <div className="relative flex flex-col items-center shrink-0 px-4">
                            <div className="relative z-10 flex items-center gap-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-surface px-3 py-1 rounded-full border border-blue-500/25 shadow-xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                              <span>{selectedWs.mode === 'direct_mirror' ? 'WinFsp 零拷贝直通' : 'CoW 差异拦截层'}</span>
                            </div>
                            <div className="relative w-44 h-[2px] bg-border/80 mt-2 overflow-hidden rounded-full">
                              {selectedWs.is_alive && (
                                <motion.div
                                  animate={{ x: ['-40%', '140%'] }}
                                  transition={{ repeat: Infinity, duration: 1.6, ease: 'linear' }}
                                  className="w-16 h-full bg-gradient-to-r from-transparent via-blue-500 to-cyan-400 rounded-full"
                                />
                              )}
                            </div>
                          </div>

                          {/* 节点 2：虚拟挂载点 */}
                          <div className="flex items-center gap-3 min-w-0 flex-1 justify-end text-right">
                            <div className="min-w-0">
                              <span className="text-[9.5px] font-mono uppercase text-muted block">Virtual NTFS Mount</span>
                              <span className="text-[11px] font-mono font-semibold text-foreground truncate block">
                                {selectedWs.target_path}
                              </span>
                            </div>
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm flex items-center justify-center shrink-0">
                              <FolderOpen className="w-4 h-4" />
                            </div>
                          </div>
                        </div>
                      </Tabs.Panel>

                      <Tabs.Panel id="diff" className="pt-0">
                        {selectedWs.mode === 'direct_mirror' ? (
                          <div className="py-6 text-center text-[11.5px] text-muted bg-surface-secondary/45 rounded-xl border border-border/50">
                            当前工作区处于 <span className="font-semibold text-foreground">零拷贝物理直通模式</span>，所有读写实时穿透至源仓底座，不产生差异文件层。
                          </div>
                        ) : selectedWs.changes?.length > 0 ? (
                          <div className="divide-y divide-border/50 max-h-44 overflow-y-auto rounded-xl border border-border/60 bg-surface-secondary/30">
                            {selectedWs.changes.map((ch, idx) => (
                              <div
                                key={idx}
                                className="py-2 px-3 flex items-center justify-between gap-3 text-[11px] hover:bg-surface-secondary/70 transition-colors"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span
                                    className={`w-4 h-4 rounded-md flex items-center justify-center font-mono text-[10px] font-bold shrink-0 ${
                                      ch.change_type === '新增'
                                        ? 'bg-emerald-500/15 text-emerald-600'
                                        : ch.change_type === '删除'
                                        ? 'bg-rose-500/15 text-rose-600'
                                        : 'bg-amber-500/15 text-amber-600'
                                    }`}
                                  >
                                    {ch.change_type === '新增' ? '+' : ch.change_type === '删除' ? '-' : '~'}
                                  </span>
                                  <span className={`font-mono truncate ${ch.change_type === '删除' ? 'line-through text-muted' : 'text-foreground'}`}>
                                    {ch.rel_path}
                                  </span>
                                  <span className="text-[9.5px] text-muted font-mono tabular-nums shrink-0">
                                    {ch.size_kb.toFixed(1)} KB
                                  </span>
                                </div>
                                <button
                                  className="text-blue-600 dark:text-blue-400 hover:underline text-[10.5px] font-medium shrink-0 cursor-pointer"
                                  onClick={() => handleLocateSource(`${selectedWs.target_path}\\${ch.rel_path}`)}
                                >
                                  定位
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="py-6 text-center text-muted text-[11.5px] bg-surface-secondary/45 rounded-xl border border-border/50">
                            写时复制层纯净，当前与源码物理底座 100% 同步一致
                          </div>
                        )}
                      </Tabs.Panel>
                    </Tabs>
                  </section>
                )}
              </motion.div>
            )}

            {/* 视图 2：Hosts 维护 */}
            {activeTab === 'hosts' && (
              <motion.div
                key="hosts"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="flex flex-col h-full max-w-[1100px] mx-auto"
              >
                <div className="flex items-center justify-between pb-4 border-b border-border/60 shrink-0">
                  <div>
                    <h2 className="text-[17px] font-semibold text-foreground">Hosts DNS 映射编辑器</h2>
                    <p className="text-[10.5px] text-muted font-mono mt-0.5">C:\Windows\System32\drivers\etc\hosts</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl text-[11px]"
                      onPress={() =>
                        callTauri<string>('get_hosts_content').then((t) => {
                          if (t) {
                            setHostsContent(t);
                            pushToast('Hosts 文件已重新载入', 'info');
                          }
                        })
                      }
                    >
                      重新载入
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      className="rounded-xl text-[11px]"
                      onPress={async () => {
                        await callTauri('save_hosts_content', { content: hostsContent });
                        pushToast('Hosts 已保存并刷新本地 DNS 缓存', 'success');
                      }}
                    >
                      保存并刷新 DNS
                    </Button>
                  </div>
                </div>

                <div className="flex-1 mt-4 rounded-2xl border border-border/80 bg-[#0D1117] text-slate-200 p-4 overflow-hidden flex flex-col shadow-surface">
                  <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10 text-[10px] font-mono text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Terminal className="w-3 h-3 text-blue-400" />
                      hosts — UTF-8
                    </span>
                    <span>{hostsContent.split('\n').length} 行</span>
                  </div>
                  <textarea
                    value={hostsContent}
                    onChange={(e) => setHostsContent(e.target.value)}
                    spellCheck={false}
                    className="flex-1 w-full font-mono text-[11.5px] text-slate-100 bg-transparent focus:outline-none resize-none leading-relaxed"
                    placeholder="正在读取系统 Hosts..."
                  />
                </div>
              </motion.div>
            )}

            {/* 视图 3：内核与驱动 */}
            {activeTab === 'doctor' && (
              <motion.div
                key="doctor"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="flex flex-col max-w-[1000px] mx-auto"
              >
                <div className="flex items-center justify-between pb-4 border-b border-border/60">
                  <div>
                    <h2 className="text-[17px] font-semibold text-foreground">内核与驱动环境体检</h2>
                    <p className="text-[11px] text-muted mt-0.5">验证 WinFsp 文件系统驱动、用户态权限隔离与服务可达性</p>
                  </div>
                  <Button size="sm" variant="primary" className="rounded-xl text-[11px]" onPress={() => loadData(false)}>
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>立即体检</span>
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-5">
                  <div className="rounded-2xl border border-border/80 bg-surface p-5 shadow-surface flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider">WinFsp Kernel Service</span>
                      <Chip size="sm" variant="soft" color="default" className="h-5 text-[9.5px] font-mono">
                        <Chip.Label>winfsp-2.x</Chip.Label>
                      </Chip>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        systemStatus?.winfsp_driver_running
                          ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.75)]'
                          : 'bg-rose-500'
                      }`} />
                      <span className={`text-[15px] font-semibold ${
                        systemStatus?.winfsp_driver_running ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                      }`}>
                        {systemStatus?.winfsp_driver_running ? '驱动在线 · 响应正常' : '未检测到驱动'}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted leading-relaxed">
                      负责内核级目录挂载与写时复制分发，在用户空间实现标准 NTFS 原生性能穿透。
                    </p>
                  </div>

                  <div className="rounded-2xl border border-border/80 bg-surface p-5 shadow-surface flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-semibold text-muted uppercase tracking-wider">Privilege Boundary</span>
                      <Chip size="sm" variant="soft" color="accent" className="h-5 text-[9.5px] font-mono">
                        <Chip.Label>HKCU Ready</Chip.Label>
                      </Chip>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-5 h-5 text-blue-500" />
                      <span className="text-[15px] font-semibold text-foreground">标准用户权限 (免 UAC)</span>
                    </div>
                    <p className="text-[11px] text-muted leading-relaxed">
                      所有挂载工作区与注册表开机自启项均隔离于当前用户命名空间，无需提权弹窗。
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* 视图 4：偏好设置 */}
            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="flex flex-col max-w-2xl mx-auto"
              >
                <div className="flex items-center justify-between pb-4 border-b border-border/60">
                  <div>
                    <h2 className="text-[17px] font-semibold text-foreground">偏好设置</h2>
                    <p className="text-[11px] text-muted mt-0.5">定制任务栏网速指示条与工作区守护策略</p>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    className="rounded-xl text-[11px]"
                    onPress={async () => {
                      try {
                        await callTauri('save_app_settings', { newSettings: appSettings });
                        pushToast('偏好设置已持久化保存', 'success');
                      } catch (e: any) {
                        pushToast(`保存失败: ${e}`, 'danger');
                      }
                    }}
                  >
                    保存设置
                  </Button>
                </div>

                <div className="rounded-2xl border border-border/80 bg-surface mt-5 divide-y divide-border/50 shadow-surface">
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-foreground block text-[12px]">任务栏原生网速指示条</span>
                      <span className="text-muted mt-0.5 block text-[10.5px]">在 Windows 任务栏系统托盘左侧实时绘制上下行网速</span>
                    </div>
                    <Switch
                      size="sm"
                      isSelected={appSettings.taskbar_speed_enabled}
                      onChange={(v) => setAppSettings({ ...appSettings, taskbar_speed_enabled: v })}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </div>

                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-foreground block text-[12px]">登录 Windows 时自动启动</span>
                      <span className="text-muted mt-0.5 block text-[10.5px]">静默驻留后台并自动恢复全部持久化映射</span>
                    </div>
                    <Switch
                      size="sm"
                      isSelected={appSettings.autostart}
                      onChange={(v) => setAppSettings({ ...appSettings, autostart: v })}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </div>

                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-foreground block text-[12px]">遥测采样间隔 (秒)</span>
                      <span className="text-muted mt-0.5 block text-[10.5px]">控制带宽统计与任务栏文字刷新频率</span>
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={appSettings.sample_interval_secs}
                      onChange={(e) =>
                        setAppSettings({
                          ...appSettings,
                          sample_interval_secs: parseInt(e.target.value, 10) || 5,
                        })
                      }
                      className="w-16 h-8 px-2 rounded-xl bg-surface-secondary border border-border text-center font-mono font-semibold text-[11.5px] text-foreground outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* ========================================================================= */}
      {/* 新建工作区 HeroUI v3 复合模态框 */}
      {/* ========================================================================= */}
      <Modal.Backdrop isOpen={isCreateOpen} onOpenChange={setIsCreateOpen} variant="blur">
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="rounded-2xl border border-border bg-overlay p-5 shadow-overlay">
            <Modal.Header className="flex items-center gap-2.5 pb-3 border-b border-border/60">
              <div className="w-7 h-7 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </div>
              <Modal.Heading className="text-[14px] font-semibold text-foreground">
                新建虚拟镜像映射
              </Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>

            <Modal.Body className="flex flex-col gap-3.5 py-4 text-[12px]">
              <TextField value={newWsName} onChange={setNewWsName}>
                <Label className="text-[11px] font-medium text-foreground">工作区标识名称</Label>
                <InputGroup className="mt-1">
                  <InputGroup.Input placeholder="例如: my-agent" className="text-[11.5px]" />
                </InputGroup>
              </TextField>

              <TextField value={newWsSource} onChange={setNewWsSource}>
                <Label className="text-[11px] font-medium text-foreground">物理源仓目录 (SOURCE)</Label>
                <InputGroup className="mt-1">
                  <InputGroup.Input placeholder="例如: E:\projects\my-agent" className="text-[11.5px] font-mono" />
                  <InputGroup.Suffix>
                    <Button size="sm" variant="secondary" className="h-6 px-2 text-[10px] rounded-lg" onPress={handlePickSource}>
                      浏览
                    </Button>
                  </InputGroup.Suffix>
                </InputGroup>
              </TextField>

              <TextField value={newWsTarget} onChange={setNewWsTarget}>
                <Label className="text-[11px] font-medium text-foreground">虚拟挂载透视点 (TARGET)</Label>
                <InputGroup className="mt-1">
                  <InputGroup.Input placeholder="例如: C:\Users\...\plugins\my-agent" className="text-[11.5px] font-mono" />
                  <InputGroup.Suffix>
                    <Button size="sm" variant="secondary" className="h-6 px-2 text-[10px] rounded-lg" onPress={handlePickTarget}>
                      浏览
                    </Button>
                  </InputGroup.Suffix>
                </InputGroup>
              </TextField>

              <RadioGroup value={newWsMode} onChange={setNewWsMode} className="gap-2">
                <Label className="text-[11px] font-medium text-foreground">挂载穿透模式</Label>
                <Radio value="direct" className="p-2.5 rounded-xl border border-border/70 bg-surface-secondary/40">
                  <Radio.Control>
                    <Radio.Indicator />
                  </Radio.Control>
                  <Radio.Content>
                    <Label className="text-[11.5px] font-semibold">零拷贝直通镜像 (推荐)</Label>
                    <Description className="text-[10px]">0 差异层，双向实时物理直通，呈现标准 NTFS 目录</Description>
                  </Radio.Content>
                </Radio>
                <Radio value="cow" className="p-2.5 rounded-xl border border-border/70 bg-surface-secondary/40">
                  <Radio.Control>
                    <Radio.Indicator />
                  </Radio.Control>
                  <Radio.Content>
                    <Label className="text-[11.5px] font-semibold">写时复制隔离 (CoW)</Label>
                    <Description className="text-[10px]">底层源仓 100% 只读保护，修改自动沉淀至差异层</Description>
                  </Radio.Content>
                </Radio>
              </RadioGroup>
            </Modal.Body>

            <Modal.Footer className="pt-3 border-t border-border/60 flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="rounded-xl text-[11px]" onPress={() => setIsCreateOpen(false)}>
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                isPending={isSubmitting}
                className="rounded-xl text-[11px]"
                onPress={handleCreateWorkspace}
              >
                立即挂载通道
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* ========================================================================= */}
      {/* 移除确认模态框 (替代原生 confirm) */}
      {/* ========================================================================= */}
      <Modal.Backdrop isOpen={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} variant="blur">
        <Modal.Container size="sm" placement="center">
          <Modal.Dialog className="rounded-2xl border border-border bg-overlay p-5 shadow-overlay">
            <Modal.Header className="pb-2">
              <Modal.Heading className="text-[14px] font-semibold text-foreground">确认移除镜像映射</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="py-2 text-[11.5px] text-muted leading-relaxed">
              确定要卸载并移除工作区 <span className="font-semibold text-foreground">{deleteTarget?.name}</span> 吗？
              <div className="mt-2 p-2 rounded-xl bg-surface-secondary font-mono text-[10px] text-foreground break-all">
                {deleteTarget?.target_path}
              </div>
            </Modal.Body>
            <Modal.Footer className="pt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="rounded-xl text-[11px]" onPress={() => setDeleteTarget(null)}>
                取消
              </Button>
              <Button size="sm" variant="danger" className="rounded-xl text-[11px]" onPress={confirmDeleteWorkspace}>
                确认移除
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* ========================================================================= */}
      {/* Raycast 风格快捷命令面板 (Ctrl+K) */}
      {/* ========================================================================= */}
      <Modal.Backdrop isOpen={isPaletteOpen} onOpenChange={setIsPaletteOpen} variant="blur">
        <Modal.Container size="md" placement="top">
          <Modal.Dialog className="mt-16 rounded-2xl border border-border bg-overlay overflow-hidden shadow-overlay">
            <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2.5">
              <Search className="w-4 h-4 text-blue-500 shrink-0" />
              <input
                autoFocus
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                placeholder="输入命令、页面名称或快捷操作..."
                className="flex-1 bg-transparent text-[12.5px] text-foreground placeholder-muted outline-none"
              />
              <Kbd className="text-[9.5px]">
                <Kbd.Content>ESC</Kbd.Content>
              </Kbd>
            </div>
            <div className="p-2 max-h-72 overflow-y-auto divide-y divide-border/30">
              {paletteCommands.map((cmd) => (
                <button
                  key={cmd.id}
                  onClick={() => {
                    cmd.action();
                    setIsPaletteOpen(false);
                    setPaletteQuery('');
                  }}
                  className="w-full px-3 py-2.5 rounded-xl flex items-center justify-between text-left hover:bg-surface-secondary transition-colors cursor-pointer"
                >
                  <span className="text-[12px] font-medium text-foreground">{cmd.title}</span>
                  <span className="text-[10px] font-mono text-muted">{cmd.hint}</span>
                </button>
              ))}
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* ========================================================================= */}
      {/* 底部浮层 Toast 通知 */}
      {/* ========================================================================= */}
      <div className="fixed bottom-4 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              className="pointer-events-auto flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface/95 backdrop-blur-xl border border-border shadow-overlay text-[11.5px] font-medium text-foreground"
            >
              <span className={`w-2 h-2 rounded-full ${
                t.tone === 'success' ? 'bg-emerald-500' : t.tone === 'danger' ? 'bg-rose-500' : 'bg-blue-500'
              }`} />
              <span>{t.title}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
