import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification as ElectronNotification, shell, session } from 'electron';
import * as path from 'path';

// URL do dashboard hospedado na Vercel — o app desktop não tem backend
// próprio, ele só empacota a MESMA interface web (/dashboard/whatsapp) como
// uma janela nativa. Isso garante 100% de reuso do motor (Evolution/Baileys)
// e da UI já existentes — ver escopo, seção 5. Override via env só serve
// para apontar pra um ambiente de staging/local durante o desenvolvimento.
const APP_URL = process.env.ZAPSCRIPT_DESKTOP_URL || 'https://zapscript.me/dashboard/whatsapp';
const APP_ORIGIN = new URL(APP_URL).origin;

const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function isAllowedOrigin(url: string): boolean {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    title: 'ZapScript',
    icon: ICON_PATH,
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // O app só carrega o domínio oficial do ZapScript (nunca conteúdo de
      // terceiros — navegação/pop-up pra fora é bloqueada abaixo), então
      // desligar o isolamento de contexto aqui é uma troca deliberada: deixa
      // o preload substituir a `Notification` global da página de forma
      // simples e confiável (ver src/preload.ts), sem precisar furar o
      // isolamento de mundos do V8 via injeção de <script>. nodeIntegration
      // continua desligado — a página nunca ganha acesso a Node/`require`.
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(APP_URL);

  // Links "externos" (ex.: recuperar senha, termos de uso, blog) abrem no
  // navegador padrão do Windows em vez de virar outra janela do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedOrigin(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedOrigin(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Fechar a janela (X) minimiza pra bandeja em vez de encerrar o processo —
  // é assim que o app continua recebendo mensagens em tempo real (Socket.IO)
  // e disparando notificações nativas mesmo sem a janela aberta na tela
  // (diferencial #4 do escopo: "funcionamento sem aba de navegador aberta").
  mainWindow.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('ZapScript');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Abrir ZapScript',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Bridge de notificação nativa ────────────────────────────────────────────
// O preload troca `window.Notification` da página carregada por uma versão
// que manda os dados pra cá via IPC. Aqui usamos a Notification nativa do
// Electron — que no Windows aparece na Central de Notificações de verdade,
// não o balão do Chromium — e avisamos de volta o processo de renderização
// quando o usuário clica, pra abrir a conversa certa.
ipcMain.on('desktop-notification:show', (event, payload: { id: number; title: string; body: string }) => {
  if (!ElectronNotification.isSupported()) return;
  const notif = new ElectronNotification({
    title: payload.title,
    body: payload.body,
    icon: ICON_PATH,
  });
  notif.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
    event.sender.send('desktop-notification:click', payload.id);
  });
  notif.show();
});

// Nega pedidos de permissão de mídia (câmera/microfone/geolocalização etc.) —
// o app não usa nada disso; só notificação, que é tratada via IPC acima.
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  createWindow();
  createTray();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Não encerra o app: ele continua vivo na bandeja do sistema recebendo
  // mensagens. Só sai de fato pelo menu da bandeja ("Sair").
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
});
