# ZapScript ZapScreve — Escopo de Criação

> Fala vira mensagem pronta: o dono grava um áudio pensando em alguém, e quem
> recebe vê **texto** — corrigido, com acentuação certa e, no modo Copiloto, no
> tom que o próprio ZapScript já aprendeu do dono. É a mesma tecnologia da
> transcrição de entrada (`transcribeAudio`, §3), só que na direção contrária:
> em vez de "áudio do cliente vira texto para o dono ler", é "áudio do dono
> vira texto para o cliente/contato receber".

- **Data:** 2026-09-19
- **Branch:** `claude/zapscript-audio-text-copilot-fd6nve`
- **Status:** proposta de escopo (pré-implementação). Nada abaixo foi construído.
- **Lentes aplicadas:** `/dev` (arquitetura e execução), `/adm` (custo, operação), `/mkt` (posicionamento).
- **Leia antes:** `ESCOPO_COPILOTO.md` (§5 Perfil de estilo — é a peça que este
  documento reaproveita), `CLAUDE.md` (infra real), `MODULOS_ARQUITETURA.md`.

## 0. Decisões alinhadas (2026-09-19)

Conversa de alinhamento fechou as 4 perguntas em aberto da primeira versão
deste escopo. O texto abaixo já reflete todas elas — não são mais proposta,
são a direção:

| Decisão | Direção fechada |
|---|---|
| Nome | **ZapScreve** (era "Ditado", placeholder) |
| Onde entra no produto | **Sem módulo/gate próprio.** Vive dentro do Atende e do Copiloto — ver §1 e §10 |
| Tier de pricing | **Nenhum novo.** Quem já tem Atende (Profissional) ou Copiloto (Empresas) já tem ZapScreve — ver §10 |
| Faseamento | **Começar já pela Fase 1** (modo rápido), sem esperar o `CopilotoStyleProfile` — ver §13 |

---

## 1. O que é (e o que não é)

| | Transcrição (já existe) | Copiloto (já existe) | ZapScreve (novo) |
|---|---|---|---|
| Direção do áudio | Cliente → dono | (não é áudio; é leitura de texto) | Dono → contato |
| Quem grava | O cliente, no fluxo normal dele | — | O dono, dentro do ZapScript |
| Quem "fala" no texto final | O cliente, ao pé da letra | O ZapScript (sugestão gerada do zero) | O dono — voz dele, com erros de fala corrigidos |
| Reescreve conteúdo? | Nunca — transcrição literal | Sim — gera a mensagem do zero | Não — só limpa/ajusta o que o dono já disse |
| Aprende estilo? | Não | Sim (`CopilotoStyleProfile`, a construir) | Sim — **mesmo** perfil |
| Risco principal | Alucinação do Whisper | Sugestão ruim/genérica | Soar "não sou eu" ou trocar o sentido do que foi falado |

**Sem chave de módulo própria.** O ZapScreve não entra em
`packages/modules/catalog.ts` como um `ModuleSpec` novo — o gate de acesso é
`requireModule('atende') || requireModule('copiloto')` (ver §10). Ele aparece
como uma ação nova **dentro** das duas superfícies existentes: um botão
"Gravar mensagem" em `apps/web/src/app/app/atende/` e uma entrada equivalente
em `/dashboard/copiloto`, ambas levando para a mesma tela e o mesmo backend —
não é feature duplicada, é uma única implementação com duas portas de entrada.

**Não é:** transcrição para o próprio dono ler (já existe); geração de
resposta a partir do que o cliente disse (isso é o Copiloto); um teclado de
ditado do sistema operacional — o ZapScreve só atua sobre áudio gravado
dentro do fluxo do próprio produto.

---

## 2. A decisão de arquitetura que define tudo: onde o dono grava

O ZapScript conecta o **WhatsApp do próprio dono** via QR code (Evolution
API). Quando ele grava um áudio e manda direto pelo app nativo do WhatsApp, o
áudio **já saiu** como áudio antes de qualquer webhook disparar — não há como
interceptar e trocar por texto depois de entregue.

Consequência direta: para o ZapScreve funcionar, quem precisa mandar a
mensagem final é o **próprio ZapScript** (via `sendMessageViaEvolution`, em
`apps/worker/src/services/evolution.ts`), não o app nativo do dono. Ele grava
**dentro** do ZapScript — não no WhatsApp — e o ZapScript entrega o texto no
lugar do áudio.

Duas superfícies possíveis, não mutuamente exclusivas:

| Superfície | Como funciona | Prós | Contras |
|---|---|---|---|
| **A — Painel web (recomendado para v1)** | Tela nova, aberta a partir do Atende ou do Copiloto (§1), reaproveitando o padrão de `VoiceRecorder.tsx` (já usado em `apps/web/src/app/app/atende/`) — grava no navegador, escolhe o contato de uma lista, revisa o texto, confirma envio | Reaproveita componente existente; superfície natural para editar texto com teclado físico antes de enviar; mesma filosofia de "painel sob demanda" para a qual o Copiloto migrou em v3.0 (`ESCOPO_COPILOTO.md` §15) | Exige abrir o navegador — não é "no fluxo" do WhatsApp |
| **B — Self-chat (atalho avançado, v1.1+)** | Dono manda áudio para o próprio número com um contato-alvo indicado (ex.: comando `zapscreve Maria: <áudio>`); ZapScript devolve o rascunho no self-chat para confirmar `1`/`1e`/`0` | Não sai do WhatsApp | Endereçar o destino por nome digitado é ambíguo ("qual Maria?") — é exatamente o padrão de push que o Copiloto **abandonou** em v3.0 por gerar atrito e ambiguidade |

**Recomendação:** começar só pela A. B fica para depois se a demanda pedir —
e mesmo aí, resolver a ambiguidade de destino é o bloqueio técnico real, não
o refinamento de texto.

---

## 3. Pipeline de processamento

```
Dono grava áudio no painel (entrada pelo Atende ou pelo Copiloto)
   └─ upload direto para o Supabase Storage (mesmo padrão de legendas.ts —
      signed upload URL, nunca passa pelo Fastify)
        └─ zapscreveQueue.add('process')
             ├─ 1. transcribeAudio()  [reaproveita 100% de whisper.ts]
             │      → texto bruto (Whisper transcreve oralidade, não
             │        escreve — sem pontuação/gramática revisada)
             ├─ 2. refinar (Sonnet 5, chamada curta e barata)
             │      modo "rápido"   → só gramática, pontuação, acentuação,
             │        remove vícios de fala ("é... tipo... né"). NUNCA muda
             │        o sentido nem acrescenta conteúdo.
             │      modo "copiloto" → aplica o CopilotoStyleProfile do dono
             │        (saudação/fechamento, formalidade, emoji, se ele
             │        fragmenta em várias mensagens) por cima do texto já
             │        corrigido no modo rápido
             └─ 3. devolve rascunho ao painel: texto rápido + texto copiloto
                    + player do áudio original — dono escolhe, edita se
                    quiser, confirma
                       └─ POST /zapscreve/:id/send → sendMessageViaEvolution
                          para o contato escolhido em §4
```

---

## 4. Seleção do contato/destino

Não deve depender de módulo pago específico para funcionar — quem chegou
aqui via Atende ou via Copiloto já passou pelo gate do §10; a lista de
destino não deve impor uma segunda dependência. Duas fontes, nessa ordem:

1. **Chats recentes da própria conexão Evolution** (endpoint de listagem de
   chats da API Evolution) — lista as conversas recentes do número
   conectado, com nome/foto, sem depender de tabela própria do ZapScript.
2. **Busca manual por número** — para contato que ainda não tem conversa.

`CrmContact` (gate `crm`) e `CopilotoConversation` (gate `copiloto`) entram
só como enriquecimento opcional (nome/empresa/tags) quando o dono já tiver
esses módulos — nunca como dependência obrigatória.

---

## 5. Confirmação antes de enviar — e o caminho até a automação

O princípio do produto inteiro (Copiloto §1: "nunca envia sozinho sem
confirmação") vale aqui, e por um motivo técnico a mais: erro de transcrição
vira erro de **conteúdo enviado em nome do dono** para um cliente real.
**v1: sempre revisão manual, sem exceção.**

Caminho de confiança (fase futura, não v1): depois de N confirmações
seguidas sem edição alguma no modo copiloto, oferecer um toggle "enviar
direto, sem revisar" — por contato ou global. Mesmo padrão de "trust ramp"
que hoje nenhum módulo do produto pula por padrão.

---

## 6. Áudio original: guardar para revisão, nunca enviar por padrão

O áudio original **não é enviado ao contato** — o objetivo declarado é
substituir áudio por texto. Ele fica só como referência do dono durante a
revisão (conferir se a transcrição capturou o que ele quis dizer) e é
descartado depois — mesma política de minimização que o resto do produto
aplica a dado sensível (`ESCOPO_COPILOTO.md` §7.4). Toggle opcional "enviar
áudio também" para quem quiser mandar os dois (nuance que texto não carrega)
— **desligado por padrão**.

---

## 7. Modelo de dados (Prisma) — proposto

```prisma
model ZapScreveDraft {
  id              String    @id @default(cuid())
  userId          String
  numberId        String
  sourceModule    String    // 'atende' | 'copiloto' — de onde o dono abriu (métrica de adoção)
  targetPhone     String
  targetName      String?
  audioStorageKey String    // removida após envio ou expiração (retenção curta)
  rawText         String    // saída do Whisper, sem tratamento
  quickText       String?   // modo rápido: só gramática/pontuação/acentuação
  copilotoText    String?   // modo copiloto: + tom aprendido
  sentText        String?   // o que foi realmente enviado (pode ter sido editado à mão)
  sentVia         String?   // 'quick' | 'copiloto' | 'edited' | 'audio_original'
  status          String    @default("draft") // draft | sent | discarded | expired
  durationSec     Int
  createdAt       DateTime  @default(now())
  sentAt          DateTime?
  @@index([userId, status])
}
```

`sentText` vs. `copilotoText`/`quickText` é o mesmo tipo de diff que
`CopilotoSuggestion.sentText` já captura (`ESCOPO_COPILOTO.md` §6.3) — é o
sinal de aprendizado de estilo. O ideal é os dois alimentarem o **mesmo**
`CopilotoStyleProfile` — uma tabela de perfil de estilo por usuário, não duas
aprendendo coisas divergentes.

---

## 8. Custo

Por mensagem de ZapScreve: 1 chamada Whisper (mesmo custo por segundo que a
transcrição de entrada já paga) + 1 chamada curta de refinamento de texto
(poucas centenas de tokens, Sonnet 5) — ordem de grandeza de **centavos**,
bem abaixo do custo de um briefing do Copiloto (que processa a conversa
inteira). Como não é vendido como SKU próprio (§10), esse custo entra na
conta de margem do Atende e do Copiloto, não numa conta separada — vale
somar ao `AiUsageLog` de cada tenant e observar o mesmo alerta de outlier já
usado pelo Copiloto (`health-monitor.ts`, `ESCOPO_COPILOTO.md` §13.4).

---

## 9. Guardrails

- Nunca acrescentar informação que não foi dita no áudio (preço, prazo,
  promessa) — o refinamento é sobre **forma**, nunca sobre conteúdo.
- Se o áudio for incompreensível/ambíguo (mesmo detector de alucinação do
  Whisper, `isWhisperHallucination` em `whisper.ts`), não inventar — devolver
  aviso para o dono regravar, nunca um texto "chutado".
- O modo copiloto pode ajustar tom, mas não pode inverter uma negação, trocar
  números/valores ou nomes próprios — validador determinístico (mesmo padrão
  de `copiloto-guardrails.ts`) comparando entidades entre `rawText` e
  `copilotoText` antes de liberar o envio.

---

## 10. Encaixe comercial

**Sem módulo novo, sem SKU nova, sem decisão de tier.** O acesso é
`requireModule('atende') || requireModule('copiloto')`:

- Quem tem **Profissional** (Core + Atende) já tem ZapScreve.
- Quem tem **Empresas** (Core + Atende + CRM + Tarefas) já tem ZapScreve por
  já incluir Atende — e quem tiver Copiloto liberado (hoje cortesia via
  `POST /admin/copiloto/access`, `ESCOPO_COPILOTO.md` §0) também.

Isso resolve de saída o problema que o Copiloto teve (custo de grupos
forçando a subir de tier, `ESCOPO_COPILOTO.md` §8.1): o custo do ZapScreve é
baixo o bastante (§8) para simplesmente **andar de carona** no que o usuário
já paga, sem precisar de checkout novo. Reforça o posicionamento "ZapScript =
áudio vira texto nas duas direções" sem abrir uma nova decisão de pricing.

---

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Transcrição erra e o dono não confere direito | Confirmação obrigatória em v1; destacar trechos de baixa confiança se a API expuser isso (`verbose_json`, já usado no modo jurídico de legendas — reaproveitável) |
| Modo copiloto muda o sentido do que foi falado | Validador de entidades (§9); modo "rápido" sempre disponível como opção mais conservadora |
| Ambiguidade de destino (self-chat, opção B do §2) | Adiada para depois da v1; v1 resolve por lista de chats reais da Evolution, não por nome digitado |
| Confusão com a transcrição de entrada já existente | Nome e ícone claramente distintos; onboarding explica a direção ("isso é para VOCÊ mandar, não para você RECEBER") |
| Duas portas de entrada (Atende e Copiloto) gerarem UX inconsistente | Uma única tela/rota por trás das duas entradas (§1) — nunca duas implementações |

---

## 12. Fora de escopo v1

- Envio automático sem revisão (depende de dados de confiança acumulados).
- Compor por self-chat (opção B do §2).
- Multi-idioma no refinamento de tom (Whisper já auto-detecta idioma; o
  refinamento v1 assume PT-BR).
- Anexar o áudio original ao enviar (toggle já fica pronto no schema,
  desligado por padrão).

---

## 13. Roadmap

| Fase | Entrega |
|---|---|
| **0 — Fundação** | Schema + migration, gate combinado (`atende` \| `copiloto`), fila, tela vazia acessível pelas duas entradas |
| **1 — MVP** (começar já) | Gravar → transcrever → modo rápido (gramática/pontuação/acentuação) → revisar → enviar. **Sem** modo copiloto ainda — não depende de nada que falta construir |
| **2 — Modo Copiloto** | Depende de `CopilotoStyleProfile` existir (é a Fase 2 do `ESCOPO_COPILOTO.md` — vale construir junto ou logo antes) |
| **3 — Confiança/automação** | Trust ramp (§5), toggle de envio direto |

Sem decisões pendentes do dono do produto no momento — pronto para começar
pela Fase 0/1.

---

*Escopo produzido com as lentes `/dev` (arquitetura, dados, custo de
execução), `/adm` (operação, margem) e `/mkt` (posicionamento).*
