import { useCallback, useEffect, useState } from 'react';
import { Button, InputGroup, Label, TextField } from '@heroui/react';
import { RotateCw, Save } from 'lucide-react';

interface AgentMindConfigJson {
  api_key?: string;
  model?: string;
  endpoint?: string;
  timeout_seconds?: number;
  confidence_threshold?: number;
  wiki_dir?: string;
  [key: string]: unknown;
}

interface AgentMindOverviewConfigSlice {
  config_json?: AgentMindConfigJson;
}

interface AgentMindModelConfigPanelProps {
  callTauri: <T = any>(command: string, args?: Record<string, any>) => Promise<T | null>;
  pushToast: (title: string, tone?: 'success' | 'info' | 'danger') => void;
}

export function AgentMindModelConfigPanel({
  callTauri,
  pushToast,
}: AgentMindModelConfigPanelProps) {
  const [cfgModel, setCfgModel] = useState('');
  const [cfgEndpoint, setCfgEndpoint] = useState('');
  const [cfgTimeout, setCfgTimeout] = useState('15');
  const [cfgThreshold, setCfgThreshold] = useState('0.85');
  const [cfgApiKey, setCfgApiKey] = useState('');
  const [rawConfig, setRawConfig] = useState<AgentMindConfigJson>({});
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const loadConfig = useCallback(
    async (silent = true) => {
      setLoading(true);
      try {
        const res = await callTauri<AgentMindOverviewConfigSlice>('get_agent_mind_overview');
        if (res?.config_json) {
          setRawConfig(res.config_json);
          setCfgModel(res.config_json.model || '');
          setCfgEndpoint(res.config_json.endpoint || '');
          setCfgTimeout(String(res.config_json.timeout_seconds ?? 15));
          setCfgThreshold(String(res.config_json.confidence_threshold ?? 0.85));
          setCfgApiKey(res.config_json.api_key || '');
          if (!silent) pushToast('已刷新模型参数配置', 'success');
        }
      } catch (e: unknown) {
        if (!silent) pushToast(`加载模型参数失败: ${e}`, 'danger');
      } finally {
        setLoading(false);
      }
    },
    [callTauri, pushToast]
  );

  useEffect(() => {
    void loadConfig(true);
  }, [loadConfig]);

  const handleSaveConfig = async () => {
    const endpointTrimmed = cfgEndpoint.trim();
    if (
      !endpointTrimmed ||
      (!endpointTrimmed.startsWith('http://') && !endpointTrimmed.startsWith('https://'))
    ) {
      pushToast('Endpoint 不能为空且必须以 http:// 或 https:// 开头', 'danger');
      return;
    }
    setSavingConfig(true);
    try {
      const payload = {
        ...rawConfig,
        api_key: cfgApiKey.trim() || '${GEMINI_API_KEY}',
        model: cfgModel.trim() || 'gemini-decision-1',
        endpoint: endpointTrimmed,
        timeout_seconds: Math.max(1, parseInt(cfgTimeout, 10) || 15),
        confidence_threshold: Math.min(1, Math.max(0.1, parseFloat(cfgThreshold) || 0.85)),
      };
      await callTauri('save_agent_mind_file', {
        relPath: 'config.json',
        content: `${JSON.stringify(payload, null, 2)}\n`,
      });
      pushToast('决策参数已保存', 'success');
      await loadConfig(true);
    } catch (e: unknown) {
      pushToast(`保存 config.json 失败: ${e}`, 'danger');
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white dark:bg-surface border border-zinc-200/85 dark:border-border/80 overflow-hidden max-w-3xl">
      <div className="px-4 py-2.5 border-b border-zinc-200/85 dark:border-border/60 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[12.5px] font-semibold text-foreground">
            Decisions API 裁决参数 (config.json)
          </h2>
          <p className="text-[10.5px] text-muted mt-0.5">
            配置心智治理语义裁判所用的模型、置信度阈值、API Endpoint 与密钥环境变量
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            isPending={loading}
            className="h-7 px-2.5 rounded-lg text-[11px]"
            onPress={() => loadConfig(false)}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>刷新</span>
          </Button>
          <Button
            size="sm"
            variant="primary"
            isPending={savingConfig}
            className="h-7 px-3 rounded-lg text-[11px]"
            onPress={handleSaveConfig}
          >
            <Save className="w-3.5 h-3.5" />
            <span>保存配置</span>
          </Button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3.5 text-[12px]">
        <TextField value={cfgModel} onChange={setCfgModel}>
          <Label className="text-[11px] font-medium text-foreground">裁决模型 (Model)</Label>
          <InputGroup className="mt-1">
            <InputGroup.Input placeholder="gemini-decision-1" className="font-mono text-[11.5px]" />
          </InputGroup>
        </TextField>

        <TextField value={cfgThreshold} onChange={setCfgThreshold}>
          <Label className="text-[11px] font-medium text-foreground">
            置信度阈值 (Confidence Threshold)
          </Label>
          <InputGroup className="mt-1">
            <InputGroup.Input placeholder="0.85" className="font-mono text-[11.5px]" />
          </InputGroup>
        </TextField>

        <TextField value={cfgEndpoint} onChange={setCfgEndpoint} className="md:col-span-2">
          <Label className="text-[11px] font-medium text-foreground">Decisions API Endpoint</Label>
          <InputGroup className="mt-1">
            <InputGroup.Input
              placeholder="https://generativelanguage.googleapis.com/..."
              className="font-mono text-[11.5px]"
            />
          </InputGroup>
        </TextField>

        <TextField value={cfgTimeout} onChange={setCfgTimeout}>
          <Label className="text-[11px] font-medium text-foreground">请求超时（秒）</Label>
          <InputGroup className="mt-1">
            <InputGroup.Input placeholder="15" className="font-mono text-[11.5px]" />
          </InputGroup>
        </TextField>

        <TextField value={cfgApiKey} onChange={setCfgApiKey}>
          <Label className="text-[11px] font-medium text-foreground">
            API Key / Env 变量表达式
          </Label>
          <InputGroup className="mt-1">
            <InputGroup.Input placeholder="${GEMINI_API_KEY}" className="font-mono text-[11.5px]" />
          </InputGroup>
        </TextField>
      </div>
    </section>
  );
}
