import { ipcRenderer } from 'electron';

// Substitui a `Notification` do navegador pela ponte nativa do Electron —
// ver comentário em main.ts sobre por que essa janela roda com
// contextIsolation desligado (só carrega o domínio oficial do ZapScript).
// O código da página (apps/web) não sabe e não precisa saber que está rodando
// dentro do app desktop: continua chamando `new Notification(title, opts)` e
// `Notification.requestPermission()` normalmente (ver
// apps/web/src/app/dashboard/whatsapp/page.tsx).

type PendingClick = () => void;

const pendingClicks = new Map<number, PendingClick>();
let nextId = 1;

ipcRenderer.on('desktop-notification:click', (_event, id: number) => {
  const onClick = pendingClicks.get(id);
  pendingClicks.delete(id);
  onClick?.();
});

class DesktopNotification {
  static permission: NotificationPermission = 'granted';

  onclick: (() => void) | null = null;
  onshow: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  private id: number;

  constructor(title: string, options: NotificationOptions = {}) {
    this.id = nextId++;
    pendingClicks.set(this.id, () => this.onclick?.());
    ipcRenderer.send('desktop-notification:show', {
      id: this.id,
      title,
      body: options.body || '',
    });
    setTimeout(() => this.onshow?.(), 0);
  }

  static requestPermission(): Promise<NotificationPermission> {
    return Promise.resolve('granted');
  }

  close() {
    pendingClicks.delete(this.id);
  }

  // Presentes só pra compatibilidade de interface com a Notification real —
  // a página não usa listeners além de onclick/onshow.
  addEventListener() {}
  removeEventListener() {}
}

(window as any).Notification = DesktopNotification;
(window as any).zapscriptDesktop = { isDesktop: true, platform: process.platform };
