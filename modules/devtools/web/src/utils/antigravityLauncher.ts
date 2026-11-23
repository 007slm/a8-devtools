export interface AntigravityLaunchResult {
  conversation_id: string;
  focused_antigravity: boolean;
  method: string;
}

/**
 * 统一三端唤起 Antigravity 新会话：
 * - Antigravity Sidecar 宿主内优先走 window.sidecar.agent.startConversation + toggleConversation
 * - 桌面端 / :18765 独立看板走后端 agentapi + Win32 置前唤醒
 */
export async function launchConversationInAntigravity(options: {
  isStandalone?: boolean;
  title: string;
  prompt: string;
  fallbackInvoke: () => Promise<AntigravityLaunchResult | null>;
}): Promise<AntigravityLaunchResult> {
  const { isStandalone, title, prompt, fallbackInvoke } = options;
  const sidecarBridge = (window as any).sidecar;
  const hasHostBridge =
    Boolean(isStandalone) &&
    typeof sidecarBridge?.agent?.startConversation === 'function' &&
    Boolean(
      sidecarBridge?.conversationId ||
        new URLSearchParams(window.location.search).get('token')
    );

  if (hasHostBridge) {
    const started = await sidecarBridge.agent.startConversation(prompt, title);
    const convId =
      started?.conversationId ||
      started?.conversation_id ||
      started?.response?.conversationId ||
      started?.response?.conversation_id ||
      '';
    if (convId && typeof sidecarBridge?.ui?.toggleConversation === 'function') {
      sidecarBridge.ui.toggleConversation(convId);
    }
    return {
      conversation_id: String(convId || ''),
      focused_antigravity: true,
      method: 'sidecar',
    };
  }

  const res = await fallbackInvoke();
  const cid = res?.conversation_id || '';
  if (cid && typeof sidecarBridge?.ui?.toggleConversation === 'function') {
    sidecarBridge.ui.toggleConversation(cid);
  }
  return (
    res || {
      conversation_id: '',
      focused_antigravity: false,
      method: 'agentapi',
    }
  );
}
