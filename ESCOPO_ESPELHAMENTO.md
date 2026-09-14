# ZapScript Espelhamento de Celular no Windows — Escopo Revisado

> Ferramenta para espelhar e controlar a tela do **Android** dentro do Windows
> (mouse e teclado), via ADB — o mesmo mecanismo do scrcpy.

- **Data:** 2026-09-14
- **Branch:** `claude/zapscript-mobile-mirroring-windows-1rv7qj`
- **Status:** proposta de escopo (pré-implementação). Nada abaixo foi construído.
- **Lentes aplicadas:** `/dev` (viabilidade técnica e arquitetura), `/adm` (custo, esforço, encaixe operacional), `/mkt` (mercado, diferenciação, posicionamento).
- **Origem:** documento de escopo enviado pelo usuário (reproduzido e revisado abaixo, seção a seção). Não há branch, código ou docs anteriores no repo sobre este produto — é o primeiro registro dele.

---

## 0. Veredito — antes de entrar no detalhe

**Não construir agora.** O próprio documento original já chega a essa conclusão no
§6 ("fase posterior e independente, após validação dos produtos 1 e 2") e essa
revisão concorda e reforça o motivo: este é o único dos três produtos que **não
reaproveita nada** da stack e da operação atual do ZapScript.

| | Copiloto / MKT-Fast (produtos existentes) | Espelhamento |
|---|---|---|
| Stack | Node/Fastify + BullMQ + Next.js — já no repo | App nativo Windows (Electron/Tauri) + ADB — zero sobreposição |
| Deploy | Vultr (API/Worker) + Vercel (Web) — já existe pipeline | Instalador assinado para Windows, distribuição própria — pipeline novo do zero |
| Conta/entitlement | Reaproveita `moduleGate`, billing, `Entitlement` | Não depende de número WhatsApp conectado nem de módulo — produto solto |
| Dado que já existe | Conversa, contato, CRM — o produto lê o que já está no banco | Nenhum — tela do celular é um fluxo de vídeo/input, dado novo do zero |
| Onde mora o moat do ZapScript | Automação de WhatsApp Business | Nenhum — scrcpy resolve o mesmo problema de graça |

Isso não é um "não" definitivo — é um "não com este escopo, não agora". A seção 5
propõe a única versão do produto que teria motivo de existir: não como
concorrente do scrcpy, e sim como um recurso interno amarrado à conta WhatsApp
que os produtos 1 e 2 já gerenciam.

---

## 1. Revisão da limitação técnica (§2 do original) — confirmada, com uma ressalva importante

A afirmação central está correta e é importante deixar por escrito, porque é
fácil superprometer aqui:

- **Android via ADB é viável.** ADB (`adb shell`, `adb forward`) e o protocolo
  usado pelo scrcpy (captura via `MediaProjection`/`screenrecord` no aparelho +
  stream H.264 para o host) são mecanismos públicos, documentados, usados por
  todo o mercado citado no §4. Não há chute técnico aqui.
- **iPhone não é viável para controle ativo.** A Apple não expõe API pública de
  captura de tela + injeção de input de terceiros sem MDM corporativo (que exige
  o aparelho ser gerenciado pela empresa, não é o caso de um usuário final) ou
  jailbreak (inviável para produto comercial). Correto não prometer.
- **Ressalva que o documento original não menciona e muda a estimativa de
  esforço:** o **scrcpy é Apache-2.0** (licença permissiva, uso comercial
  liberado, só exige manter aviso de copyright/licença). Isso significa que a
  parte mais cara do produto — protocolo de streaming de vídeo de baixa
  latência + `scrcpy-server` que roda no aparelho via ADB — **não precisa ser
  reimplementada do zero**. Dá para embarcar o `scrcpy-server` (ou usar uma
  binding existente, ex. bibliotecas Node/Rust que já envolvem esse protocolo)
  e construir a camada de produto (UI, múltiplas janelas, gravação, integração
  com WhatsApp) por cima. Isso derruba a complexidade técnica de "meses de
  streaming de vídeo do zero" para "semanas de integração + UI" — mas também
  **derruba ainda mais a barreira de entrada para qualquer concorrente**, o que
  reforça o ponto do §4: a base técnica não é onde a disputa acontece.

**Atualização do risco "complexidade técnica maior" (§7 do original):** de
alto para médio — mitigado por reaproveitar o motor aberto do scrcpy — mas o
risco de mercado (§4) sobe proporcionalmente, porque a mesma base aberta que
baixa o custo de construir também é a base que já alimenta um concorrente
gratuito instalado.

---

## 2. Revisão do MVP (§3 do original)

| Item do MVP original | Avaliação | Ajuste recomendado |
|---|---|---|
| USB como padrão, Wi-Fi como conveniência | Correto — é a mesma priorização do scrcpy e do Vysor. Manter. | — |
| Controle ativo (mouse/teclado), não só visualização | Correto, é o mínimo pra ter produto (senão é só "ver a tela", que ninguém paga por isso) | — |
| Múltiplos celulares simultâneos | Recurso real, mas é **complexidade de v2**, não de v1 — cada janela é uma sessão ADB própria, com gerência de porta/conflito. Não é o que valida a ideia. | Mover para fase 2 |
| Gravação de tela + print | Baixo esforço incremental (a stream já existe, é só persistir) | Manter no MVP, é barato |

O MVP proposto no original está tecnicamente correto, mas mistura "o que prova
a ideia" com "o que compõe o produto maduro". Para um teste de validação real
(que é o que falta antes de comprometer semanas de engenharia), o corte certo é
menor: **1 celular, 1 janela, USB, controle ativo, print** — o suficiente para
colocar na frente de 10 usuários do ICP do §5 e medir se alguém prefere isso ao
scrcpy gratuito. Wi-Fi, múltiplos aparelhos e gravação só depois de confirmar
que há motivo pra continuar.

---

## 3. Revisão da concorrência (§4 do original) — falta profundidade de preço

O documento nomeia os concorrentes certos mas não desce ao nível que decide
viabilidade comercial (preço e por que alguém pagaria em vez de usar o
gratuito):

| Concorrente | Preço aproximado | Onde ganha do scrcpy (motivo de existir apesar de scrcpy ser grátis) |
|---|---|---|
| **scrcpy** | Grátis, open source | Performance e estabilidade — é o benchmark, não um concorrente comercial |
| **Vysor** | Grátis (limitado) / ~US$ 39,99/ano Pro | UI amigável, sem linha de comando — mas taxa de conversão free→pago é notoriamente baixa nesse nicho |
| **ApowerMirror** | ~US$ 39,95/ano | Cross-device (Android+iOS espelhamento passivo), gravação, foco em criadores de conteúdo |
| **AirDroid** | Freemium / planos Business por dispositivo | Foco em **gestão de frota de dispositivos** (MDM leve) — é o único que monetiza sério, e é porque vende para empresa, não para usuário final |

**Leitura de mercado:** o único segmento deste mercado com disposição real de
pagar preço relevante é **gestão de frota de dispositivos para empresa**
(AirDroid Business, Scalefusion, etc. — dezenas a centenas de dólares/mês por
organização). O usuário final individual não paga por espelhamento porque o
scrcpy resolve de graça e bem. Isso é uma correção importante ao tom do
documento original: a "pressão de preço" do §7 não é o único risco — o risco
maior é que **o segmento que paga não é o ICP natural do ZapScript** (donos de
pequenos negócios que vendem por WhatsApp), e o segmento que é o ICP do
ZapScript não paga por isto.

---

## 4. Revisão dos diferenciais (§5 do original)

- **"UX mais simples que scrcpy"** — real, mas é vantagem temporária: o scrcpy
  já tem múltiplos wrappers gráficos gratuitos da comunidade (ex. instaladores
  com interface, sem linha de comando) fechando essa lacuna. Não é um fosso
  defensável sozinho.
- **"Foco em nicho (atendimento, QA, criadores)"** — direção certa, mas
  qualquer um desses nichos isolados (QA, criadores de conteúdo) não tem
  relação com o resto do portfólio do ZapScript — seria abrir um produto do
  zero para um público que a empresa não atende hoje.
- **"Integração com a conta WhatsApp já conectada"** (§5.3 do original) — **este
  é o único diferencial que sobrevive à análise**, porque é o único que usa algo
  que o ZapScript já tem e o scrcpy/Vysor/AirDroid não têm: a conta WhatsApp do
  usuário já conectada via Evolution API (Copiloto, Atende). Ver proposta
  concreta na seção 5 abaixo.

---

## 5. Proposta refinada — a única versão deste produto com motivo de existir

Em vez de "espelhamento genérico de celular Android para Windows" (que compete
de frente com scrcpy grátis e bem estabelecido), o recorte que tem chance real:

**"Abra o WhatsApp do seu celular espelhado, direto do painel ZapScript, para
fazer no app oficial o que o WhatsApp Web não permite"** — ex.: editar status,
usar figurinhas animadas específicas, gerenciar configurações de privacidade
por contato, ou qualquer ação que o WhatsApp bloqueia deliberadamente fora do
app nativo. Isso:

1. Vive **dentro** do painel que o usuário já usa para o Atende/Copiloto — não
   é uma segunda instalação de produto, é um botão a mais em
   `/dashboard/<numero>`.
2. Só se justifica para o usuário que **já tem** um número conectado no
   ZapScript — não é aquisição nova, é retenção/expansão de quem já é cliente.
3. Não compete com scrcpy no espelhamento genérico — a promessa não é
   "espelhe seu celular", é "resolva a lacuna específica que o WhatsApp Web
   deixa", com o espelhamento como mecanismo, não como o produto.
4. Ainda assim herda **todo** o risco técnico e de infraestrutura do documento
   original (app Windows nativo, ADB, driver, stream de vídeo) — não é grátis
   de construir só porque o escopo de uso é mais estreito.

Se essa versão não convencer, a recomendação é **não construir este produto**
— o mercado genérico já está resolvido de graça e o ZapScript não tem vantagem
nele.

---

## 6. Arquitetura (se e quando for adiante) — visão `/dev`

Diferente de Copiloto/MKT-Fast, isto **não é uma rota nova em `apps/api`** — é
um produto de plataforma diferente:

| Camada | Escolha recomendada | Por quê |
|---|---|---|
| App Windows | **Electron** (não Tauri, apesar do binário menor) | Time já trabalha em TypeScript/Node (`apps/web`, `apps/worker`); Tauri exigiria Rust do zero. Reaproveita conhecimento, não reaproveita código. |
| Captura/stream | `scrcpy-server` (Apache-2.0) via ADB, embarcado no instalador | Evita reimplementar protocolo de vídeo; ver §1 |
| ADB | `adb.exe` (Android Platform Tools, Apache-2.0) embarcado | Padrão de mercado, sem alternativa madura |
| Distribuição | Instalador assinado (certificado de code signing Windows — custo recorrente à parte, ~US$ 200-400/ano) + auto-update próprio | Sem isso, SmartScreen do Windows bloqueia o instalador na primeira execução — mata a conversão |
| Integração com ZapScript | Só se autentica com o `Entitlement` do número já conectado (reaproveita `lib/moduleGate.ts` via chamada de API do app Electron para `apps/api`) | É o que torna a proposta do §5 possível — sem isso é produto solto |

Este é **o único ponto de contato real com o resto da stack**: o app Electron
chama a API existente (Vultr) só para checar entitlement/licença. Tudo o resto
(vídeo, input, ADB) roda 100% local no Windows do usuário, fora do Vultr/Vercel
descritos no `CLAUDE.md` — não há o que "deployar" no servidor para este
produto além desse endpoint de licença.

---

## 7. Riscos — revisão do §7 original

| Risco (original) | Avaliação nesta revisão |
|---|---|
| Concorrente grátis consolidado (scrcpy) | **Confirmado e é o risco dominante** — ver §3, o mercado que paga não é o ICP do ZapScript |
| Complexidade técnica (streaming, drivers, permissões USB) | **Reduzido** de alto para médio — reaproveitar scrcpy/ADB abertos (§1) |
| Virar "mais um clone" sem diferencial | **Confirmado** — só a proposta do §5 (amarrada à conta WhatsApp) escapa disso |
| **Não estava no original — adicionar:** custo de distribuição Windows (code signing, SmartScreen, suporte a driver ADB no Windows do usuário, que é a maior fonte de ticket de suporte de todo produto desse tipo) | Novo, relevante para `/adm` — este produto gera uma categoria de suporte (driver, permissão de depuração USB no Android) que não existe hoje na operação do ZapScript |
| **Não estava no original — adicionar:** fricção de ativação — usuário precisa habilitar "Depuração USB" no Android, um toggle enterrado em Opções do Desenvolvedor | Novo — é a maior causa de abandono no onboarding de produtos desse tipo (scrcpy, Vysor) |

---

## 8. Decisões que precisam do dono do produto antes de qualquer prototipagem

1. **Confirmar o adiamento.** Concorda com o veredito do §0 — não priorizar
   antes de produtos 1 e 2 estarem validados — ou há um motivo de negócio
   (pedido de cliente específico, oportunidade competitiva) para adiantar?
2. **Se avançar, qual versão:** a genérica do documento original (compete
   direto com scrcpy) ou a amarrada à conta WhatsApp (§5, escopo menor, único
   diferencial real)?
3. **Orçar o code signing e o app Electron como custo recorrente novo**, fora
   do que a infra atual (Vultr/Vercel/Supabase) já cobre — não é uma linha a
   mais em `apps/`, é uma operação de distribuição de software nova pra
   empresa.

Sem resposta a (1), o resto deste documento fica como registro — não como
próximo passo.

---

*Escopo revisado com as lentes `/dev` (viabilidade técnica, arquitetura),
`/adm` (custo, esforço, operação) e `/mkt` (mercado, diferenciação). Baseado no
documento de escopo original enviado pelo usuário em 2026-09-14, reproduzido e
comentado seção a seção acima.*
