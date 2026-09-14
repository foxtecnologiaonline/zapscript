# ZapScript Desktop (Windows)

App nativo Windows (Electron) que dá acesso ao WhatsApp direto do PC, sem
navegador — ver escopo completo em "ZapScript Vincular Celular ao Windows".

## Decisão de arquitetura: wrapper, não produto novo

Este app **não reimplementa** o motor de mensageria nem a UI do WhatsApp Web.
Ele empacota como janela nativa a mesma página que já existe em produção —
`https://zapscript.me/dashboard/whatsapp` (`apps/web/src/app/dashboard/whatsapp/page.tsx`),
que por sua vez fala com a mesma API (`apps/api/src/routes/whatsapp-web.ts`) e
o mesmo motor Evolution/Baileys do QR Code (produto 1, Fase 1). Isso cumpre a
seção 5 do escopo ("reaproveitar 100% do motor... tratar como uma segunda
interface, não um produto com stack separada") com o menor código novo
possível: zero rota de API nova, zero schema novo.

O que este app **adiciona** de fato (a diferenciação real, por design —
seção 2 do escopo) é só camada de UX nativa:

| Requisito do MVP | Como foi resolvido |
|---|---|
| App desktop nativo pra Windows | Electron + `electron-builder` (NSIS) |
| Login via QR Code (mesmo motor) | Reaproveitado — é a tela `/dashboard/numeros` já existente, acessível a partir do dashboard carregado |
| Notificações nativas do Windows | Ponte de IPC (`src/preload.ts` → `src/main.ts`) troca a `Notification` do navegador pela `Notification` nativa do Electron, que usa a Central de Notificações do Windows de verdade |
| Múltiplas contas, cada uma em aba própria | Implementado **na própria página web** (`apps/web`): o seletor de número virou uma barra de abas — funciona igual no navegador e aqui, sem duplicar UI |
| Persistência de sessão | De graça: a sessão padrão do Electron persiste cookies/localStorage em disco (`userData`) entre aberturas — o token JWT do ZapScript (`localStorage`) sobrevive a reiniciar o app |
| Ícone na bandeja / funciona sem janela aberta | `Tray` do Electron + fechar a janela (X) só esconde, não mata o processo — o app continua recebendo mensagens em tempo real (Socket.IO) e notificando mesmo minimizado |

### Por que uma janela só (com abas dentro da página), não uma janela/`BrowserView` por número

O escopo pede "cada uma em aba/janela própria" pensando em múltiplas contas —
mas no ZapScript, várias contas conectadas simultaneamente já são só várias
linhas na tabela `WhatsappNumber` do **mesmo usuário** (mesmo login). Não há
sessão de navegador separada por número — é a mesma sessão autenticada.
Então multiplicar `BrowserView`/partições de sessão por número adicionaria
complexidade (múltiplos processos de renderização, múltiplos sockets)
sem ganho real. A barra de abas fica dentro da própria página React, que já
tinha esse estado (era um `<select>`) — ver
`apps/web/src/app/dashboard/whatsapp/page.tsx`.

### Por que `contextIsolation: false`

Normalmente isso é desaconselhado (é a proteção contra o conteúdo da página
manipular globals do preload). Aqui é uma troca deliberada e documentada em
`src/main.ts`: esta janela **só carrega o domínio oficial do ZapScript**
(navegação e pop-up pra qualquer outra origem são bloqueados e abrem no
navegador padrão em vez de dentro do app), então não há conteúdo de terceiro
não confiável rodando aqui. Isso permite que `src/preload.ts` troque a
`Notification` global da página por uma versão que fala com o processo
principal via IPC, sem precisar recorrer a injeção de `<script>` pra furar o
isolamento de mundos do V8. `nodeIntegration` continua **desligado** — a
página nunca ganha acesso a `require`/Node.

## Rodando em desenvolvimento

```bash
cd apps/desktop
npm install
npm run dev                 # compila e abre o Electron contra produção
ZAPSCRIPT_DESKTOP_URL=http://localhost:3000/dashboard/whatsapp npm run dev   # contra o web local
```

## Gerando o instalador Windows

```bash
cd apps/desktop
npm run dist:win             # gera .exe (NSIS) em apps/desktop/release/
```

Isso roda só localmente/sob demanda — **não faz parte do deploy do
ZapScript** (Vultr/Vercel, ver `CLAUDE.md` na raiz). O instalador gerado é um
artefato pra distribuir manualmente (site, link direto) até existir um canal
de atualização automática.

## Limitações herdadas da Fase 1 (mesmas do WhatsApp Web do produto 1)

- Só texto — sem envio/recebimento de mídia (áudio, imagem, documento).
- Só conversas individuais — sem grupos.
- Só números conectados via QR Code (Evolution); números via API oficial da
  Meta (`provider: 'meta'`) não aparecem aqui (ver `resolveConnectedNumber`
  em `apps/api/src/routes/whatsapp-web.ts`).
- Mesmo risco de bloqueio de número do motor não-oficial (Baileys) — não é
  específico do desktop, é do motor.

## Fora de escopo nesta etapa

- Auto-update do instalador.
- macOS/Linux (o escopo pede Windows).
- Espelhamento de tela do celular (isso é outro produto).
