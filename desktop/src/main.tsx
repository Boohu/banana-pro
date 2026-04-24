import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initDiagnosticLogger } from './utils/diagnosticLogger'
import { initI18n } from './i18n'
import { useConfigStore } from './store/configStore'

// Enable dark mode
document.documentElement.classList.add('dark')

const mountApp = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )

  // 移除首屏兜底层
  ;(() => {
    const boot = document.getElementById('boot');
    const root = document.getElementById('root');
    if (!boot || !root) return;

    const start = performance.now();
    const maxWaitMs = 10_000;

    const tryRemove = () => {
      const hasContent = root.childElementCount > 0;
      const timedOut = performance.now() - start > maxWaitMs;
      if (!hasContent && !timedOut) {
        requestAnimationFrame(tryRemove);
        return;
      }
      boot.style.transition = 'opacity 180ms ease';
      boot.style.opacity = '0';
      window.setTimeout(() => boot.remove(), 200);
    };
    requestAnimationFrame(tryRemove);
  })();
};

// 尽可能早地清空 macOS 标题：tauri.conf.json 里 title 为「筋斗云AI」（Windows 任务栏需要），
// 但 macOS Overlay 模式下会把这几个字直接画在标题栏上和暗色背景冲突。
// 放在 bootstrap 之外、立即执行，避免被 initI18n 的 await 拖延几百 ms。
(async () => {
  try {
    if (typeof window === 'undefined') return;
    if (!(window as any).__TAURI_INTERNALS__) return;
    if (!/Mac/i.test(navigator.userAgent)) return;
    // @ts-ignore Tauri 运行时解析
    const { getCurrentWindow } = await import(/* @vite-ignore */ '@tauri-apps/api/window');
    await getCurrentWindow().setTitle('');
  } catch (err) {
    console.warn('[main] setTitle skip:', err);
  }
})();

const bootstrap = async () => {
  initDiagnosticLogger();
  const language = await initI18n();
  const { language: storedLanguage, languageResolved, setLanguage, setLanguageResolved } = useConfigStore.getState();
  const hasStoredLanguage = typeof storedLanguage === 'string' && storedLanguage.trim().length > 0;
  if (!hasStoredLanguage) {
    setLanguage('system');
    setLanguageResolved(language);
  } else if (storedLanguage === 'system' && !languageResolved) {
    setLanguageResolved(language);
  }

  mountApp();
};

void bootstrap();
