import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Chip,
  InputGroup,
  Label,
  Modal,
  Tabs,
  TextField,
} from '@heroui/react';
import {
  BookOpen,
  Bot,
  Calculator,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode2,
  FileText,
  FolderGit2,
  FolderOpen,
  Layers,
  Plus,
  RotateCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';

export interface AgentMindFileEntry {
  rel_path: string;
  name: string;
  category: string;
  extension: string;
  size_bytes: number;
  modified_ts: number;
}

export interface HostProjectCard {
  code: string;
  physical_path: string;
  role: string;
  summary: string;
  detail_rel_path: string;
  detail_exists: boolean;
}

export interface ManifestCategory {
  id: string;
  name: string;
  description: string;
}

export interface AgentMindOverview {
  plugin_root: string;
  mounted_target: string | null;
  mount_alive: boolean;
  sidecar_running: boolean;
  sidecar_url: string;
  plugin_meta: {
    name?: string;
    displayName?: string;
    display_name?: string;
    description?: string;
    version?: string;
    author?: string;
    suggestedPrompts?: string[];
  };
  config_json: {
    api_key?: string;
    model?: string;
    endpoint?: string;
    timeout_seconds?: number;
    confidence_threshold?: number;
  };
  rules_manifest: {
    version?: string;
    categories?: ManifestCategory[];
    universal_rules?: string[];
  };
  projects: HostProjectCard[];
  files: AgentMindFileEntry[];
}

interface AgentMindViewProps {
  callTauri: <T = any>(command: string, args?: Record<string, any>) => Promise<T | null>;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
  isStandalone?: boolean;
}

const PROTECTED_FILES = new Set([
  'plugin.json',
  'config.json',
  'projects.md',
  'rules/AGENTS.md',
  'rules/manifest.json',
]);

const ROLE_STYLES: Record<string, { label: string; color: 'accent' | 'default' | 'danger' | 'success' }> = {
  core: { label: 'CORE · 生产核心', color: 'accent' },
  tooling: { label: 'TOOLING · 工具底座', color: 'success' },
  'test-bed': { label: 'TEST-BED · 只读靶场', color: 'danger' },
  reference: { label: 'REFERENCE · 架构参考', color: 'default' },
};

export function AgentMindView({ callTauri, pushToast, isStandalone = false }: AgentMindViewProps) {
  const [subTab, setSubTab] = useState<'overview' | 'rules' | 'projects' | 'config'>('overview');
  const [overview, setOverview] = useState<AgentMindOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Rule .md editor state
  const [fileSearch, setFileSearch] = useState('');
  const [selectedRelPath, setSelectedRelPath] = useState<string>('rules/AGENTS.md');
  const [editorContent, setEditorContent] = useState<string>('');
  const [savedContent, setSavedContent] = useState<string>('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  // Quick drill-down modal editor (for projects/*.md, manifest, skill/agent docs)
  const [quickModal, setQuickModal] = useState<{
    relPath: string;
    content: string;
    saved: string;
    saving: boolean;
  } | null>(null);

  // Create rule modal
  const [isNewRuleOpen, setIsNewRuleOpen] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleDesc, setNewRuleDesc] = useState('');
  const [creatingRule, setCreatingRule] = useState(false);

  // Delete confirmation modal
  const [deleteFileTarget, setDeleteFileTarget] = useState<string | null>(null);

  // Config form state
  const [cfgModel, setCfgModel] = useState('');
  const [cfgEndpoint, setCfgEndpoint] = useState('');
  const [cfgTimeout, setCfgTimeout] = useState('15');
  const [cfgThreshold, setCfgThreshold] = useState('0.85');
  const [cfgApiKey, setCfgApiKey] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);

  // Interactive YAGNI risk calculator (synced with sidecar dashboard)
  const [yagniFreq, setYagniFreq] = useState(1);
  const [yagniSev, setYagniSev] = useState(3);

  const isDirty = editorContent !== savedContent;

  const loadOverview = useCallback(
    async (silent = true) => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await callTauri<AgentMindOverview>('get_agent_mind_overview');
        if (res) {
          setOverview(res);
          setCfgModel(res.config_json?.model || '');
          setCfgEndpoint(res.config_json?.endpoint || '');
          setCfgTimeout(String(res.config_json?.timeout_seconds ?? 15));
          setCfgThreshold(String(res.config_json?.confidence_threshold ?? 0.85));
          setCfgApiKey(res.config_json?.api_key || '');
          if (!silent) {
            pushToast('已同步 Agent Mind 插件最新规则与能力', 'success');
          }
        }
      } catch (e: any) {
        const msg = String(e || '加载失败');
        setLoadError(msg);
        if (!silent) pushToast(`加载 Agent Mind 失败: ${msg}`, 'danger');
      } finally {
        setLoading(false);
      }
    },
    [callTauri, pushToast]
  );

  const openFile = useCallback(
    async (relPath: string, switchToRulesTab = false) => {
      if (switchToRulesTab) {
        setSubTab('rules');
      }
      setSelectedRelPath(relPath);
      setLoadingFile(true);
      try {
        const txt = await callTauri<string>('read_agent_mind_file', { relPath });
        const content = txt ?? '';
        setEditorContent(content);
        setSavedContent(content);
      } catch (e: any) {
        pushToast(`读取 ${relPath} 失败: ${e}`, 'danger');
      } finally {
        setLoadingFile(false);
      }
    },
    [callTauri, pushToast]
  );

  const handleSaveCurrentFile = useCallback(async () => {
    if (!selectedRelPath) return;
    setSavingFile(true);
    try {
      await callTauri('save_agent_mind_file', {
        relPath: selectedRelPath,
        content: editorContent,
      });
      setSavedContent(editorContent);
      pushToast(`已保存 ${selectedRelPath}（镜像挂载已同步生效）`, 'success');
      await loadOverview(true);
    } catch (e: any) {
      pushToast(`保存失败: ${e}`, 'danger');
    } finally {
      setSavingFile(false);
    }
  }, [selectedRelPath, editorContent, callTauri, pushToast, loadOverview]);

  useEffect(() => {
    loadOverview(true).then(() => {
      openFile('rules/AGENTS.md', false);
    });
  }, []);

  // Ctrl+S shortcut inside Rules editor
  useEffect(() => {
    if (subTab !== 'rules') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (isDirty && !savingFile) {
          handleSaveCurrentFile();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [subTab, isDirty, savingFile, handleSaveCurrentFile]);

  const handleCreateRule = async () => {
    const cleanName = newRuleName.trim();
    if (!cleanName) {
      pushToast('请输入规则文件名，例如 redline-sql.md', 'danger');
      return;
    }
    setCreatingRule(true);
    try {
      const title = cleanName.replace(/\.md$/i, '');
      const template = `# ${title}\n\n> ${newRuleDesc.trim() || 'Agent Mind 架构治理与工程红线规范'}\n\n## 1. 核心约束\n\n- 待补充约束细则...\n\n## 2. 验证与拦截标准\n\n- 变更提交前需通过 \`/judge\` 语义审查。\n`;
      const createdRel = await callTauri<string>('create_agent_mind_rule', {
        relPath: cleanName,
        content: template,
      });
      setIsNewRuleOpen(false);
      setNewRuleName('');
      setNewRuleDesc('');
      pushToast(`已新建规则 ${createdRel}`, 'success');
      await loadOverview(true);
      if (createdRel) {
        await openFile(createdRel, true);
      }
    } catch (e: any) {
      pushToast(`创建规则失败: ${e}`, 'danger');
    } finally {
      setCreatingRule(false);
    }
  };

  const confirmDeleteFile = async () => {
    if (!deleteFileTarget) return;
    try {
      await callTauri('delete_agent_mind_file', { relPath: deleteFileTarget });
      pushToast(`已删除扩展文件 ${deleteFileTarget}`, 'success');
      const deleted = deleteFileTarget;
      setDeleteFileTarget(null);
      await loadOverview(true);
      if (selectedRelPath === deleted) {
        await openFile('rules/AGENTS.md', false);
      }
    } catch (e: any) {
      pushToast(`删除失败: ${e}`, 'danger');
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const payload = {
        api_key: cfgApiKey.trim() || '${GEMINI_API_KEY}',
        model: cfgModel.trim() || 'gemini-decision-1',
        endpoint: cfgEndpoint.trim(),
        timeout_seconds: Math.max(1, parseInt(cfgTimeout, 10) || 15),
        confidence_threshold: Math.min(1, Math.max(0.1, parseFloat(cfgThreshold) || 0.85)),
      };
      await callTauri('save_agent_mind_file', {
        relPath: 'config.json',
        content: `${JSON.stringify(payload, null, 2)}\n`,
      });
      pushToast('config.json 决策参数已保存', 'success');
      await loadOverview(true);
      if (selectedRelPath === 'config.json') {
        await openFile('config.json', false);
      }
    } catch (e: any) {
      pushToast(`保存 config.json 失败: ${e}`, 'danger');
    } finally {
      setSavingConfig(false);
    }
  };

  const ruleMdFiles = useMemo(() => {
    const list = overview?.files || [];
    return list.filter((f) => f.category === 'rules' && f.extension === 'md');
  }, [overview]);

  const filteredRuleFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return ruleMdFiles;
    return ruleMdFiles.filter(
      (f) => f.rel_path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
    );
  }, [ruleMdFiles, fileSearch]);

  const openQuickModal = useCallback(
    async (relPath: string) => {
      try {
        const txt = await callTauri<string>('read_agent_mind_file', { relPath });
        const content = txt ?? '';
        setQuickModal({ relPath, content, saved: content, saving: false });
      } catch (e: any) {
        pushToast(`读取 ${relPath} 失败: ${e}`, 'danger');
      }
    },
    [callTauri, pushToast]
  );

  const saveQuickModal = useCallback(async () => {
    if (!quickModal) return;
    setQuickModal((prev) => (prev ? { ...prev, saving: true } : null));
    try {
      await callTauri('save_agent_mind_file', {
        relPath: quickModal.relPath,
        content: quickModal.content,
      });
      pushToast(`已保存 ${quickModal.relPath}`, 'success');
      setQuickModal((prev) => (prev ? { ...prev, saved: prev.content, saving: false } : null));
      await loadOverview(true);
    } catch (e: any) {
      pushToast(`保存失败: ${e}`, 'danger');
      setQuickModal((prev) => (prev ? { ...prev, saving: false } : null));
    }
  }, [quickModal, callTauri, pushToast, loadOverview]);

  const yagniScore = yagniFreq * yagniSev;
  const isYagniAccepted = yagniScore < 10;

  const pluginDisplayName =
    overview?.plugin_meta?.displayName ||
    overview?.plugin_meta?.display_name ||
    'Agent Mind Dashboard';
  const pluginVersion = overview?.plugin_meta?.version || '1.2.0';
  const categories = overview?.rules_manifest?.categories || [];
  const suggestedPrompts = overview?.plugin_meta?.suggestedPrompts || [];

  const fileCountsByCat = useMemo(() => {
    const counts: Record<string, number> = {
      rules: 0,
      projects: 0,
      skills: 0,
      agents: 0,
      config: 0,
    };
    for (const f of overview?.files || []) {
      counts[f.category] = (counts[f.category] || 0) + 1;
    }
    return counts;
  }, [overview]);

  const canDeleteSelected =
    selectedRelPath &&
    !PROTECTED_FILES.has(selectedRelPath) &&
    (selectedRelPath.startsWith('rules/') || selectedRelPath.startsWith('projects/'));

  return (
    <div className="flex flex-col gap-3 max-w-[1440px] mx-auto">
      {/* ================================================================= */}
      {/* 顶部纯白边线摘要卡片 + 子导航栏 */}
      {/* ================================================================= */}
      <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 px-4 py-3 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
                  {pluginDisplayName}
                </h2>
                <Chip size="sm" variant="soft" color="accent" className="h-4.5 text-[10px] font-mono">
                  <Chip.Label>v{pluginVersion}</Chip.Label>
                </Chip>
                <Chip
                  size="sm"
                  variant="soft"
                  color={overview?.mount_alive ? 'success' : 'default'}
                  className="h-4.5 text-[10px]"
                >
                  <Chip.Label>
                    {overview?.mount_alive ? 'CowFS 实时透视生效中' : '物理源码直编模式'}
                  </Chip.Label>
                </Chip>
              </div>
              <p className="text-[11px] text-muted mt-0.5 leading-snug max-w-2xl">
                {overview?.plugin_meta?.description ||
                  '面向自主智能体的工程良知与持续演进心智中枢，在 DevTools 内直接维护 rules、宿主机项目生态地图与裁决技能。'}
              </p>
              {overview?.plugin_root && (
                <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-muted flex-wrap">
                  <span className="truncate">源码基座: {overview.plugin_root}</span>
                  {overview.mounted_target && (
                    <>
                      <span>→</span>
                      <span className="truncate text-blue-600 dark:text-blue-400">
                        挂载点: {overview.mounted_target}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 rounded-lg text-[11px]"
              onPress={() => callTauri('open_agent_mind_dir')}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>打开插件目录</span>
            </Button>
            {!isStandalone && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 rounded-lg text-[11px]"
                onPress={async () => {
                  try {
                    const url = await callTauri<string>('launch_agent_mind_sidecar');
                    pushToast(`独立 Web 看板已就绪: ${url || '127.0.0.1:18765'}`, 'success');
                    await loadOverview(true);
                  } catch (e: any) {
                    pushToast(`启动独立看板失败: ${e}`, 'danger');
                  }
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>独立看板</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              isPending={loading}
              className="h-7 px-2.5 rounded-lg text-[11px]"
              onPress={() => loadOverview(false)}
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>刷新</span>
            </Button>
          </div>
        </div>

        {loadError && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        <div className="pt-2 border-t border-border/50 flex flex-wrap items-center justify-between gap-2.5">
          <Tabs
            selectedKey={subTab}
            onSelectionChange={(k) => setSubTab(k as typeof subTab)}
            className="w-auto max-w-full"
          >
            <Tabs.ListContainer className="overflow-x-auto">
              <Tabs.List
                aria-label="Agent Mind 视图切换"
                className="bg-zinc-200/65 dark:bg-surface-secondary p-0.5 rounded-xl flex flex-row flex-nowrap whitespace-nowrap w-max"
              >
                <Tabs.Tab id="overview" className="px-3.5 py-1.5 text-[11.5px] rounded-lg whitespace-nowrap shrink-0 w-auto">
                  <span className="whitespace-nowrap">能力总览与评估</span>
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="rules" className="px-3.5 py-1.5 text-[11.5px] rounded-lg whitespace-nowrap shrink-0 w-auto">
                  <span className="whitespace-nowrap">规则维护 ({ruleMdFiles.length})</span>
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="projects" className="px-3.5 py-1.5 text-[11.5px] rounded-lg whitespace-nowrap shrink-0 w-auto">
                  <span className="whitespace-nowrap">宿主机项目地图 ({overview?.projects.length || 0})</span>
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="config" className="px-3.5 py-1.5 text-[11.5px] rounded-lg whitespace-nowrap shrink-0 w-auto">
                  <span className="whitespace-nowrap">决策模型参数</span>
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>

          <div className="flex items-center gap-3 text-[11px] font-mono text-muted tabular-nums shrink-0 whitespace-nowrap">
            <span>规则 {ruleMdFiles.length}</span>
            <span>·</span>
            <span>项目卡 {fileCountsByCat.projects}</span>
            <span>·</span>
            <span>技能 {fileCountsByCat.skills}</span>
            <span>·</span>
            <span>智能体 {fileCountsByCat.agents}</span>
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* Tab 1: 能力总览 + 红线维度 + YAGNI 计算器 */}
      {/* ================================================================= */}
      {subTab === 'overview' && (
        <div className="grid grid-cols-12 gap-3">
          {/* 左 8 列：4 正交治理维度 + 技能/智能体能力矩阵 */}
          <div className="col-span-12 lg:col-span-8 flex flex-col gap-3">
            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-[12.5px] font-semibold text-foreground">
                    规则清单 · 四大正交治理维度 (rules/manifest.json)
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 px-2 rounded-md text-[10.5px]"
                  onPress={() => openQuickModal('rules/manifest.json')}
                >
                  编辑清单
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="rounded-xl bg-white dark:bg-surface-secondary/55 border border-zinc-200/85 dark:border-border/60 p-2.5 flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-foreground">{cat.name}</span>
                      <span className="text-[9.5px] font-mono text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                        {cat.id}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted leading-snug">{cat.description}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-500" />
                  <h3 className="text-[12.5px] font-semibold text-foreground">插件内建能力与快捷维护入口</h3>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                <div className="rounded-xl border border-zinc-200/85 dark:border-border/70 bg-white dark:bg-surface-secondary/40 p-2.5 flex flex-col justify-between gap-2">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11.5px] text-foreground flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                        全局心智规则
                      </span>
                      <Chip size="sm" variant="soft" color="accent" className="h-4.5 text-[9px] font-mono">
                        <Chip.Label>AGENTS.md</Chip.Label>
                      </Chip>
                    </div>
                    <p className="text-[10.5px] text-muted mt-1 leading-snug">
                      约束所有 Agent 的第一性原则、物理验证、静态门禁与零妥协红线。
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-lg text-[10.5px] w-full"
                    onPress={() => openFile('rules/AGENTS.md', true)}
                  >
                    直接维护 AGENTS.md
                  </Button>
                </div>

                <div className="rounded-xl border border-zinc-200/85 dark:border-border/70 bg-white dark:bg-surface-secondary/40 p-2.5 flex flex-col justify-between gap-2">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11.5px] text-foreground flex items-center gap-1.5">
                        <Bot className="w-3.5 h-3.5 text-emerald-500" />
                        语义终审智能体
                      </span>
                      <Chip size="sm" variant="soft" color="success" className="h-4.5 text-[9px] font-mono">
                        <Chip.Label>/judge</Chip.Label>
                      </Chip>
                    </div>
                    <p className="text-[10.5px] text-muted mt-1 leading-snug">
                      调度 arch-judge 与 Jev 两阶段管道执行源码因果链、红线与架构缺陷终审。
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-lg text-[10.5px] w-full"
                    onPress={() => openQuickModal('agents/arch-judge.md')}
                  >
                    查看 / 调整 arch-judge
                  </Button>
                </div>

                <div className="rounded-xl border border-zinc-200/85 dark:border-border/70 bg-white dark:bg-surface-secondary/40 p-2.5 flex flex-col justify-between gap-2">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11.5px] text-foreground flex items-center gap-1.5">
                        <FileCode2 className="w-3.5 h-3.5 text-amber-500" />
                        架构复盘演进
                      </span>
                      <Chip size="sm" variant="soft" color="default" className="h-4.5 text-[9px] font-mono">
                        <Chip.Label>/improve</Chip.Label>
                      </Chip>
                    </div>
                    <p className="text-[10.5px] text-muted mt-1 leading-snug">
                      在任务收尾时萃取教训、更新宿主机地图与规则补丁，避免同类回归。
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-lg text-[10.5px] w-full"
                    onPress={() => openQuickModal('skills/arch-improve/SKILL.md')}
                  >
                    查看 arch-improve 技能
                  </Button>
                </div>
              </div>
            </section>
          </div>

          {/* 右 4 列：YAGNI 评估器 + 推荐 Prompt */}
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-3">
            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 p-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-foreground flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  YAGNI 缺陷风险评估器
                </span>
                <span className="font-mono text-[10px] text-muted">F × S &lt; 10</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted block mb-1">发生频率 (1-5)</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={yagniFreq}
                    onChange={(e) => setYagniFreq(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-full h-7 px-2 rounded-lg bg-surface-secondary border border-border font-mono text-[11.5px] text-foreground outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted block mb-1">危害程度 (1-5)</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={yagniSev}
                    onChange={(e) => setYagniSev(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-full h-7 px-2 rounded-lg bg-surface-secondary border border-border font-mono text-[11.5px] text-foreground outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div
                className={`rounded-lg border px-3 py-2 flex items-center justify-between ${
                  isYagniAccepted
                    ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-500/8 border-rose-500/25 text-rose-700 dark:text-rose-300'
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-[11px] font-semibold">
                    {isYagniAccepted ? '风险可控 · 建议接受 (不做冗余防御)' : '高危隐患 · 必须修补!'}
                  </span>
                  <span className="text-[9.5px] opacity-80">
                    {isYagniAccepted ? '保持代码精简，拒绝过度防御' : '风险值 ≥ 10，不得以 YAGNI 豁免'}
                  </span>
                </div>
                <span className="font-mono font-bold text-[14px] tabular-nums">{yagniScore}</span>
              </div>
            </section>

            <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 p-3 flex flex-col gap-2">
              <span className="text-[12px] font-semibold text-foreground">推荐指令 (点击复制)</span>
              <div className="flex flex-col gap-1.5">
                {suggestedPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      navigator.clipboard.writeText(prompt);
                      pushToast('已复制推荐指令到剪贴板', 'success');
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg bg-white hover:bg-zinc-50 dark:bg-surface-secondary/65 dark:hover:bg-surface-secondary border border-zinc-200/85 dark:border-border/60 text-[11px] text-foreground flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <span className="truncate">{prompt}</span>
                    <Copy className="w-3 h-3 text-muted shrink-0" />
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Tab 2: 规则与文档直编工作台 (Master-Detail Live Editor) */}
      {/* ================================================================= */}
      {subTab === 'rules' && (
        <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden grid grid-cols-12 min-h-[460px]">
          {/* 左侧规则目录导航栏（仅展示 rules/*.md） */}
          <div className="col-span-12 md:col-span-4 lg:col-span-3 border-r border-zinc-200/85 dark:border-border/70 flex flex-col bg-white dark:bg-surface-secondary/25">
            <div className="p-2.5 border-b border-border/60 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-semibold text-foreground">规则文件 (rules/*.md)</span>
                <Button
                  size="sm"
                  variant="primary"
                  className="h-6 px-2 rounded-md text-[10.5px]"
                  onPress={() => setIsNewRuleOpen(true)}
                >
                  <Plus className="w-3 h-3" />
                  <span>新建规则</span>
                </Button>
              </div>

              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 pointer-events-none" />
                <input
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="过滤规则文件名..."
                  className="w-full h-7 pl-8 pr-2 rounded-lg bg-surface border border-border text-[11px] text-foreground placeholder-muted outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5 max-h-[460px]">
              {filteredRuleFiles.map((f) => {
                const active = selectedRelPath === f.rel_path;
                return (
                  <button
                    key={f.rel_path}
                    onClick={() => openFile(f.rel_path, false)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-500/12 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/25'
                        : 'hover:bg-surface-secondary text-foreground/85'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 shrink-0 opacity-75" />
                      <div className="min-w-0">
                        <div className="text-[11.5px] font-medium truncate">{f.name}</div>
                        <div className="text-[9.5px] font-mono text-muted truncate">{f.rel_path}</div>
                      </div>
                    </div>
                    <span className="text-[9.5px] font-mono text-muted shrink-0">
                      {(f.size_bytes / 1024).toFixed(1)}K
                    </span>
                  </button>
                );
              })}
              {filteredRuleFiles.length === 0 && (
                <div className="py-10 text-center text-[11px] text-muted">暂无匹配的规则 Markdown 文件</div>
              )}
            </div>
          </div>

          {/* 右侧编辑器区 */}
          <div className="col-span-12 md:col-span-8 lg:col-span-9 flex flex-col">
            <div className="px-3.5 py-2 border-b border-border/60 flex flex-wrap items-center justify-between gap-2 bg-surface">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[12px] font-semibold text-foreground truncate">
                  {selectedRelPath}
                </span>
                {isDirty ? (
                  <Chip size="sm" variant="soft" color="warning" className="h-5 text-[9.5px]">
                    <Chip.Label>未保存</Chip.Label>
                  </Chip>
                ) : (
                  <Chip size="sm" variant="soft" color="success" className="h-5 text-[9.5px]">
                    <Chip.Label>已同步</Chip.Label>
                  </Chip>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {canDeleteSelected && (
                  <Button
                    size="sm"
                    variant="danger-soft"
                    className="h-7 px-2.5 rounded-lg text-[10.5px]"
                    onPress={() => setDeleteFileTarget(selectedRelPath)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  isPending={loadingFile}
                  className="h-7 px-2.5 rounded-lg text-[10.5px]"
                  onPress={() => openFile(selectedRelPath, false)}
                >
                  重载
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  isPending={savingFile}
                  isDisabled={!isDirty && !savingFile}
                  className="h-7 px-3 rounded-lg text-[10.5px]"
                  onPress={handleSaveCurrentFile}
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>保存 (Ctrl+S)</span>
                </Button>
              </div>
            </div>

            <div className="flex-1 bg-surface dark:bg-[#0D1117] text-foreground dark:text-slate-100 p-3 flex flex-col min-h-[410px]">
              <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-border/60 dark:border-white/10 text-[10px] font-mono text-muted dark:text-slate-400">
                <span>{selectedRelPath} — UTF-8</span>
                <span>{editorContent.split('\n').length} 行 · {editorContent.length} 字符</span>
              </div>
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                spellCheck={false}
                placeholder="正在读取规则内容..."
                className="flex-1 w-full font-mono text-[12px] text-foreground dark:text-slate-100 placeholder-muted bg-transparent focus:outline-none resize-none leading-relaxed"
              />
            </div>
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* Tab 3: 宿主机项目生态地图 */}
      {/* ================================================================= */}
      {subTab === 'projects' && (
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="text-[11px] text-muted">
              索引源自 <span className="font-mono text-foreground">projects.md</span>，支持直接维护跨项目红线、关联图谱与各项目渐进式详情卡片。
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 rounded-lg text-[10.5px]"
                onPress={() => openQuickModal('projects/relations.md')}
              >
                编辑关联关系 (relations.md)
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="h-7 px-2.5 rounded-lg text-[10.5px]"
                onPress={() => openQuickModal('projects.md')}
              >
                编辑项目总索引 (projects.md)
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(overview?.projects || []).map((proj) => {
              const roleMeta = ROLE_STYLES[proj.role] || {
                label: proj.role.toUpperCase(),
                color: 'default' as const,
              };
              return (
                <div
                  key={proj.code}
                  className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 p-3 flex flex-col justify-between gap-2.5"
                >
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FolderGit2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span className="text-[13px] font-semibold text-foreground truncate">
                          {proj.code}
                        </span>
                      </div>
                      <Chip size="sm" variant="soft" color={roleMeta.color} className="h-4.5 text-[9px] font-mono">
                        <Chip.Label>{roleMeta.label}</Chip.Label>
                      </Chip>
                    </div>

                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(proj.physical_path);
                        pushToast(`已复制 ${proj.code} 物理路径`, 'success');
                      }}
                      title="点击复制物理路径"
                      className="text-left px-2 py-1 rounded-lg bg-white hover:bg-zinc-50 dark:bg-surface-secondary/75 dark:hover:bg-surface-secondary border border-zinc-200/85 dark:border-border/60 font-mono text-[10px] text-foreground flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="truncate">{proj.physical_path}</span>
                      <Copy className="w-3 h-3 text-muted shrink-0" />
                    </button>

                    <p className="text-[11px] text-muted leading-snug">{proj.summary}</p>
                  </div>

                  <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-muted truncate">
                      {proj.detail_rel_path || '无详情卡'}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={!proj.detail_exists}
                      className="h-6 px-2 rounded-md text-[10px] shrink-0"
                      onPress={() => openQuickModal(proj.detail_rel_path)}
                    >
                      维护详情卡
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Tab 4: 决策模型与插件参数配置 (config.json) */}
      {/* ================================================================= */}
      {subTab === 'config' && (
        <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 p-4 max-w-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-border/60">
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">决策裁决器运行时参数 (config.json)</h3>
              <p className="text-[11px] text-muted mt-0.5">
                调整 `/judge` 分类器模型、置信阈值与请求超时，保存后立即写入插件目录
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              isPending={savingConfig}
              className="rounded-xl text-[11px]"
              onPress={handleSaveConfig}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>保存 config.json</span>
            </Button>
          </div>

          <div className="flex flex-col gap-3.5 mt-4 text-[12px]">
            <TextField value={cfgModel} onChange={setCfgModel}>
              <Label className="text-[11px] font-medium text-foreground">决策模型名称 (model)</Label>
              <InputGroup className="mt-1">
                <InputGroup.Input placeholder="gemini-decision-1" className="font-mono text-[11.5px]" />
              </InputGroup>
            </TextField>

            <TextField value={cfgEndpoint} onChange={setCfgEndpoint}>
              <Label className="text-[11px] font-medium text-foreground">裁决 API 端点 (endpoint)</Label>
              <InputGroup className="mt-1">
                <InputGroup.Input placeholder="https://generativelanguage.googleapis.com/..." className="font-mono text-[11.5px]" />
              </InputGroup>
            </TextField>

            <div className="grid grid-cols-2 gap-3">
              <TextField value={cfgTimeout} onChange={setCfgTimeout}>
                <Label className="text-[11px] font-medium text-foreground">超时时间 (timeout_seconds)</Label>
                <InputGroup className="mt-1">
                  <InputGroup.Input type="number" className="font-mono text-[11.5px]" />
                </InputGroup>
              </TextField>

              <TextField value={cfgThreshold} onChange={setCfgThreshold}>
                <Label className="text-[11px] font-medium text-foreground">置信度阈值 (confidence_threshold)</Label>
                <InputGroup className="mt-1">
                  <InputGroup.Input type="number" step="0.05" min="0.1" max="1" className="font-mono text-[11.5px]" />
                </InputGroup>
              </TextField>
            </div>

            <TextField value={cfgApiKey} onChange={setCfgApiKey}>
              <Label className="text-[11px] font-medium text-foreground">API Key 引用变量 (api_key)</Label>
              <InputGroup className="mt-1">
                <InputGroup.Input placeholder="${GEMINI_API_KEY}" className="font-mono text-[11.5px]" />
              </InputGroup>
            </TextField>
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* 新建规则模态框 */}
      {/* ================================================================= */}
      <Modal.Backdrop isOpen={isNewRuleOpen} onOpenChange={setIsNewRuleOpen} variant="blur">
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="rounded-2xl border border-border bg-overlay p-5 shadow-overlay">
            <Modal.Header className="flex items-center gap-2.5 pb-3 border-b border-border/60">
              <div className="w-7 h-7 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </div>
              <Modal.Heading className="text-[14px] font-semibold text-foreground">
                新建 Agent Mind 规则文档
              </Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>

            <Modal.Body className="flex flex-col gap-3.5 py-4 text-[12px]">
              <TextField value={newRuleName} onChange={setNewRuleName}>
                <Label className="text-[11px] font-medium text-foreground">规则文件名 (默认创建在 rules/ 下)</Label>
                <InputGroup className="mt-1">
                  <InputGroup.Input placeholder="例如: redline-security.md" className="font-mono text-[11.5px]" />
                </InputGroup>
              </TextField>

              <TextField value={newRuleDesc} onChange={setNewRuleDesc}>
                <Label className="text-[11px] font-medium text-foreground">一句话规则定位说明</Label>
                <InputGroup className="mt-1">
                  <InputGroup.Input placeholder="例如: 鉴权与数据库物理表访问安全红线" className="text-[11.5px]" />
                </InputGroup>
              </TextField>
            </Modal.Body>

            <Modal.Footer className="pt-3 border-t border-border/60 flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="rounded-xl text-[11px]" onPress={() => setIsNewRuleOpen(false)}>
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                isPending={creatingRule}
                className="rounded-xl text-[11px]"
                onPress={handleCreateRule}
              >
                立即创建并编辑
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* ================================================================= */}
      {/* 删除扩展文件确认框 */}
      {/* ================================================================= */}
      <Modal.Backdrop
        isOpen={!!deleteFileTarget}
        onOpenChange={(open) => !open && setDeleteFileTarget(null)}
        variant="blur"
      >
        <Modal.Container size="sm" placement="center">
          <Modal.Dialog className="rounded-2xl border border-border bg-overlay p-5 shadow-overlay">
            <Modal.Header className="pb-2">
              <Modal.Heading className="text-[14px] font-semibold text-foreground">
                确认删除规则文件
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="py-2 text-[11.5px] text-muted leading-relaxed">
              确定要从插件目录删除以下文件吗？
              <div className="mt-2 p-2 rounded-xl bg-surface-secondary font-mono text-[10.5px] text-foreground break-all">
                {deleteFileTarget}
              </div>
            </Modal.Body>
            <Modal.Footer className="pt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="rounded-xl text-[11px]" onPress={() => setDeleteFileTarget(null)}>
                取消
              </Button>
              <Button size="sm" variant="danger" className="rounded-xl text-[11px]" onPress={confirmDeleteFile}>
                确认删除
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* ================================================================= */}
      {/* 快捷文档弹窗直编器 (用于项目地图卡片 / manifest / 技能详情) */}
      {/* ================================================================= */}
      <Modal.Backdrop
        isOpen={!!quickModal}
        onOpenChange={(open) => !open && setQuickModal(null)}
        variant="blur"
      >
        <Modal.Container size="lg" placement="center">
          <Modal.Dialog className="rounded-2xl border border-border bg-overlay p-5 shadow-overlay w-[min(90vw,780px)] max-w-[780px]">
            <Modal.Header className="flex items-center justify-between gap-2 pb-3 border-b border-border/60">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <Modal.Heading className="text-[13.5px] font-semibold font-mono text-foreground truncate">
                  {quickModal?.relPath}
                </Modal.Heading>
                {quickModal && quickModal.content !== quickModal.saved ? (
                  <Chip size="sm" variant="soft" color="warning" className="h-5 text-[9.5px]">
                    <Chip.Label>未保存</Chip.Label>
                  </Chip>
                ) : (
                  <Chip size="sm" variant="soft" color="success" className="h-5 text-[9.5px]">
                    <Chip.Label>已同步</Chip.Label>
                  </Chip>
                )}
              </div>
              <Modal.CloseTrigger />
            </Modal.Header>

            <Modal.Body className="py-3">
              <div className="rounded-xl border border-border/80 bg-surface dark:bg-[#0D1117] text-foreground dark:text-slate-100 p-3.5 flex flex-col h-[380px]">
                <textarea
                  value={quickModal?.content || ''}
                  onChange={(e) =>
                    setQuickModal((prev) => (prev ? { ...prev, content: e.target.value } : null))
                  }
                  spellCheck={false}
                  className="flex-1 w-full font-mono text-[12px] text-foreground dark:text-slate-100 bg-transparent focus:outline-none resize-none leading-relaxed"
                />
              </div>
            </Modal.Body>

            <Modal.Footer className="pt-3 border-t border-border/60 flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="rounded-xl text-[11px]" onPress={() => setQuickModal(null)}>
                关闭
              </Button>
              <Button
                size="sm"
                variant="primary"
                isPending={quickModal?.saving}
                isDisabled={!quickModal || quickModal.content === quickModal.saved}
                className="rounded-xl text-[11px]"
                onPress={saveQuickModal}
              >
                <Save className="w-3.5 h-3.5" />
                <span>保存修改</span>
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
