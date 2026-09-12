# 🚀 Análise e Verificação do Onboarding — ZapScript

**Data:** 12 de setembro de 2026  
**Canais:** Site (Next.js) + WhatsApp

---

## 📊 Resumo Executivo

O ZapScript implementa um onboarding em **dois canais paralelos e integrados**:

| Aspecto | Site (Next.js) | WhatsApp |
|---------|---|---|
| **Entrada** | Cadastro no painel + formulário | Número oficial recebe texto OU site dispara |
| **Fluxo** | Visual progressivo (3 checkpoints) | Conversacional (6 estágios) |
| **Completude** | Banner + Modal de conexão | State machine com auto-escalação |
| **Tempo esperado** | <5 minutos | 5-15 minutos (conversacional) |
| **Taxa de sucesso** | Alta (guiado visualmente) | Média (depende de respostas) |

---

## 🌐 Fluxo de Onboarding — WEB

### Estrutura Visual

O banner de onboarding (`OnboardingBanner.tsx`, 428 linhas) exibe uma interface gamificada com 3 checkpoints:

```
BANNER PROGRESSIVO (exibido enquanto activeNumbers === 0)
┌─────────────────────────────────────────────────────┐
│ 🚀 Passo 2/3 — Quase lá!                           │
│ Conecte seu WhatsApp e comece a converter           │
│                                                     │
│ [✓ Conta criada] ──→ [🎙 Conectar número] ──→ [✓ 1º áudio]
│                       ↑ ATIVO                       │
│                                                     │
│ 📌 Desbloqueie transcrições automáticas             │
│ ■■■■■■■░░░░░ 66% completo (2/3)                    │
│                                                     │
│ [📱 Conectar meu WhatsApp agora]                    │
│ [Ir para Números]                                   │
│                                                     │
│ [?] Preciso de ajuda (6 FAQ)                        │
└─────────────────────────────────────────────────────┘
```

### Componentes Principais

#### 1. OnboardingBanner.tsx
- **Responsabilidade:** Exibir banner gamificado enquanto não há transcrições
- **Arquivo:** `apps/web/src/app/dashboard/OnboardingBanner.tsx`
- **Estados:**
  - ✓ Conta criada (sempre completo)
  - 📱 Conectar número (ativo até `hasNumber === true`)
  - 🎙 1º áudio (ativo até `hasTranscription === true`)
- **Persistência:** localStorage (`zs_onboarding_dismissed`)
- **Gamificação:** Emojis dinâmicos (🚀 → 💪 → 🔥 → 🏆)

#### 2. ConnectModal (em page.tsx — 677 linhas)
- **Responsabilidade:** Fluxo completo de conexão (código + QR)
- **Fases:**
  - `intro` — Tela de tranquilidade + segurança
  - `init` — "Preparando conexão..."
  - `ready` — Aguardando entrada do usuário
  - `code` — Código gerado e visível
  - `waiting` — Polling de status
  - `connected` — Sucesso!
  - `error` — Fallback com retry
- **Métodos:**
  - **Padrão:** Código por número (10-11 dígitos)
  - **Fallback:** QR Code (opt-in, se código falhar)
  - **Auto-pairing:** Se `initialPairingCode` vindo do site
- **Polling:** A cada 2s verifica `/numbers/{id}/zapi-status`

### Fluxo de Ação Ideal (Site)

1. Usuário vê o banner → "Conecte seu WhatsApp"
2. Clica "Conectar meu WhatsApp agora" → Abre drawer com passo a passo
3. Navega para Números (via link no drawer ou banner)
4. Clica "+ Adicionar" → Cria número com nome auto-gerado
5. Clica "Conectar WhatsApp" → Abre modal ConnectModal
6. Modal mostra código (ou QR se número inválido)
7. Usuário digita código no celular → Webhook Evolution notifica
8. Modal fecha com sucesso → Banner muda pra "Passo 3/3"
9. Usuário envia áudio de teste → Recebe transcrição
10. Banner desaparece (localStorage + hasTranscription=true)

### Pontos de Atenção — WEB

🟡 **Telefone fixo sem QR:** Se o usuário informar um telefone fixo (10 dígitos) e o código falhar, a UX mostra aviso neutro "Tente QR Code" mas não força. Bom balanço entre ajuda e autonomia.

✨ **Melhoria sugerida:** No banner, se já há um número conectado (hasNumber=true) e ainda sem áudio (hasTranscription=false), destacar a ação "Mande um áudio no seu WhatsApp" com mais proeminência visual (estrela, badge "Próximo passo").

🟡 **Compatibilidade mobile:** Modal abre full-screen no mobile. Funciona bem, mas QR Code no celular exige "tela dividida" (mencionado no help).

---

## 💬 Fluxo de Onboarding — WhatsApp

### Duas Entradas Possíveis

#### 1. Entrada: Site Signup
```
startFromSiteSignup(userId, numberId, phone, pairingCode)
```
- Chamada em `POST /auth/register` logo após provisionar instância
- Número oficial envia primeira mensagem automática com pairing code já pronto
- Lead criado em estado `code_sent`

#### 2. Entrada: Estranho manda texto no número oficial
```
startFromOfficialNumber(phone, pushName, instanceNameStr, flavor?)
```
- Detectado pelo webhook (`handleOfficialNumberText`)
- Número oficial envia primeira mensagem conversacional (consentimento)
- Lead criado em estado `awaiting_consent`

### State Machine (6 Estágios)

```
started
  ↓ (Enviada msg inicial sem pairing code)
awaiting_consent
  ├─ [SIM] → awaiting_email
  ├─ [Não reconhecido] → attempts++
  └─ [Escalação após 2 respostas inválidas] → escalated
    ↓
awaiting_email
  ├─ [email@válido.com] → createPasswordlessAccount()
  │                       ├─ [Novo] → confirm_number
  │                       └─ [Já existe] → confirm_number (sem userId novo)
  ├─ [Não reconhecido] → attempts++
  └─ [Escalação] → escalated
    ↓
confirm_number
  ├─ [SIM] → connectNumber = phone (do lead)
  ├─ [NÃO] → Pedir outro número
  ├─ [Número válido] → connectNumber = número novo
  ├─ [Não reconhecido] → attempts++
  └─ [Escalação] → escalated
    ↓ [Se tudo OK]
    → provisionInstance() + requestPairingCode()
      ├─ [Sucesso] → code_sent
      └─ [Erro] → escalated
    ↓
code_sent
  ├─ [Webhook: connection.update, state='open'] → closeLeadOnConnected()
  │                                               ├─ stage = completed
  │                                               └─ Enviar msg sucesso
  ├─ [Sem resposta 30-60min] → nudgeStuckLead() (reenviar código novo)
  └─ [Sem resposta >60min] → escalateAbandonedLead() (escalar Agente)
    ↓
completed
  └─ (Lead concluído — número pronto)
    ou
escalated
  └─ (Agente de Suporte toma conta)
```

### Componentes Críticos

#### onboarding-whatsapp.ts (505 linhas)
- **Arquivo:** `apps/api/src/services/onboarding-whatsapp.ts`
- **Funções principais:**
  - `getOfficialInstanceName(purpose?)` — Resolve o número oficial
  - `startFromSiteSignup()` — Entrada 1 (site)
  - `startFromOfficialNumber()` — Entrada 2 (número oficial direto)
  - `handleOfficialNumberText()` — Webhook principal
  - `handleReply()` — Parser de respostas + state machine
  - `closeLeadOnConnected()` — Webhook da Evolution
  - `nudgeStuckLead()` — Lembrete automático (30-60min)
  - `escalateAbandonedLead()` — Escalação automática (>60min)

#### onboarding-nudge.ts (64 linhas)
- **Arquivo:** `apps/api/src/services/onboarding-nudge.ts`
- **Responsabilidade:** Job periódico que executa a cada 15 minutos
- **Lógica:**
  - Busca leads sem resposta entre 30-60 minutos atrás
  - Reenvia o passo pendente uma vez
  - Se persistir >60min, escala pro Agente de Suporte
- **Primeira execução:** 5 min após startup
- **Intervalo:** 15 min (configurável via `INTERVAL_MS`)

### Mensagens Enviadas (Progressão Típica)

| Estágio | Mensagem Enviada | Resposta Esperada |
|---------|---|---|
| `started` | "👋 Oi! Aqui é o ZapScript...[pairing code]" | (Webhook ao conectar) |
| `awaiting_consent` | "Posso criar sua conta grátis...[termos]...Responda SIM" | SIM / NÃO / qualquer coisa |
| `awaiting_email` | "Qual é o seu e-mail?" | nome@email.com |
| `confirm_number` | "Vamos conectar ESTE número? SIM (ou outro número)" | SIM / NÃO / outro número |
| `code_sent` | "Perfeito! [código]...Assim que conectar, confirmo" | (Webhook ao conectar) |
| `completed` | "✅ Seu WhatsApp já está conectado! 🎉" | (Fim — lead concluído) |

### Integração com Campanhas

**Flavor: 'campanhas'** — Mesmo número oficial, detecção via:
- Palavra-chave: "campanha ..."
- CampanhaChatSession já em andamento
- flavor='campanhas' forçado

**Diferenças:**
- Pitch muda: "Aqui é o ZapScript Campanhas..."
- source='campanhas' salvo no lead
- Após conectar, conversa continua no PRÓPRIO número (self-chat, não oficial)
- Oferece upgrade de plano (Profissional/Empresas desbloqueia módulo)

### Fallback: Suporte via Número Oficial

Se mensagem não for onboarding, campanhas, ou cliente conhecido:
- Encaminha via `intakeMessage()` para fila do Agente de Suporte
- Mesmo canal (número oficial) serve suporte também
- Conversação unificada (onboarding + suporte + campanhas tudo num só lugar)

### Pontos de Atenção — WhatsApp

🟡 **Parsing manual de respostas:** O código usa regex simples para email/telefone. Se usuário escrever com parênteses ou formatação incomum, pode confundir. Atual:
- `extractEmail()` — pega primeira ocorrência com @
- `extractPhone()` — 8-13 dígitos (válido internacionalmente)

✨ **Sugestão:** Adicionar normalização (trim, remover acentos) ou validação mais tolerante.

🟡 **Regeneração de código expirado:** Pairing code do WhatsApp expira (~2-3 min). Se lead ficar em `code_sent` por >10 min, código não funciona mais. O nudge (30-60min) pede código novo, mas é muito tarde. Usuário fica frustrado.

✨ **Sugestão:** Adicionar check automático em `code_sent`: se passaram >10 min, reenvia código novo sem esperar o nudge.

🟡 **Escalação após 2 respostas não reconhecidas:** `MAX_ATTEMPTS_BEFORE_ESCALATE = 2` é agressivo. Usuário que digita "nao" (sem acento) conta como inválido.

✨ **Sugestão:** Aumentar para 3-4 tentativas ou implementar detecção fuzzy de sim/não.

---

## 🔗 Consistência Entre Canais

### Pontos de Convergência

- **Mesmo pairing code:** Site exibe → WhatsApp envia o MESMO código (evita pedir 2×)
- **Mesmo lead (WhatsappOnboardingLead):** Rastreado por telefone, não por user ID
- **Número oficial unificado:** Onboarding, Campanhas e Suporte no mesmo número
- **Webhook de conclusão:** `closeLeadOnConnected()` executado quando Evolution emite `connection.update state='open'`

### Divergências (Esperadas)

- **WEB:** Visual + progressivo (usuário vê barra de progresso em tempo real)
- **WhatsApp:** Conversacional + sequencial (depende de respostas do usuário)
- **WEB:** Suporta QR fallback (automático se código falhar)
- **WhatsApp:** Sem QR (número oficial recebe texto, não escaneia QR)
- **WEB:** Rápido (~5 min se sem erros)
- **WhatsApp:** Mais lento (conversação humana esperada, 5-15 min)

### Sincronização de Estado

Não há conflito entre os dois canais. O usuário pode:
1. Se cadastrar no site → recebe código via WhatsApp
2. Escanear código (site) OU digitar (WhatsApp) — o MESMO código funciona em ambos
3. Lead marca como `completed` quando QUALQUER canal conecta

Sem race conditions observadas.

---

## ✅ Checklist de Verificação Prática

### Testes Recomendados — WEB

- [ ] **Banner aparece?** Fazer login sem número conectado → verificar OnboardingBanner visível
- [ ] **Banner desaparece?** Conectar número + enviar áudio → verificar banner some
- [ ] **Checkpoints corretos?** ✓ Conta → 📱 Número → 🎙 Áudio
- [ ] **Drawer funciona?** "Conectar meu WhatsApp agora" → drawer aparece
- [ ] **Modal de conexão**
  - [ ] Clique "Conectar WhatsApp"
  - [ ] Modal intro → continuar → gera código
  - [ ] Código formatado (XXXX-XXXX)?
  - [ ] "Copiar código" funciona?
  - [ ] QR fallback if código falhar?
- [ ] **Telefone fixo (10 dígitos):** Aviso neutro "Tente QR Code"
- [ ] **FAQ/Troubleshooting:** 6 questões com respostas
- [ ] **Badges de segurança:** AES-256, Brasil LGPD, Só áudios
- [ ] **Mobile responsiveness:** Drawer full-screen, modal acessível

### Testes Recomendados — WhatsApp (Site Signup)

- [ ] **Cadastro dispara onboarding:** POST /auth/register → WhatsApp oficial recebe mensagem
- [ ] **Mensagem inclui código?** Lead em `code_sent`
- [ ] **Usuário digita código:** Webhook Evolution executa
- [ ] **Lead marca como completed:** closeLeadOnConnected() envia ✅
- [ ] **Timing:** <1 min se tudo OK

### Testes Recomendados — WhatsApp (Número Oficial Direto)

- [ ] **Estranho manda texto:** handleOfficialNumberText() processa
- [ ] **Sequência conversa:**
  - [ ] Bot: "Oi! ... Responda SIM"
  - [ ] Usuário: "SIM"
  - [ ] Bot: "Qual é o seu e-mail?"
  - [ ] Usuário: "nome@email.com"
  - [ ] Bot: "Conta criada! Vamos conectar? SIM"
  - [ ] Usuário: "SIM"
  - [ ] Bot: "Perfeito! [código]"
  - [ ] Usuário digita no celular
  - [ ] Bot: "✅ Conectado! 🎉"
- [ ] **Respostas não reconhecidas:** "oieee" → Bot pede novamente (até 2x)
- [ ] **Escalação:** 3ª resposta inválida → "Vou chamar alguém..."
- [ ] **Nudge automático (30-60min):** Lead parado → bot reenvia lembretes
- [ ] **Abandono (>60min):** Sem resposta → escalação automática

### Testes Recomendados — Campanhas (flavor)

- [ ] **Palavra-chave ativada:** "campanha ..." → pitch muda
- [ ] **CampanhaChatSession ativa:** Continua em Campanhas
- [ ] **Após conectar:** Mensagens saem pelo PRÓPRIO número (self-chat)
- [ ] **Oferta de upgrade:** Plano free → oferece upgrade

### Testes de Edge Case

- [ ] **E-mail já cadastrado:** "Esse e-mail já tem conta..."
- [ ] **Número inválido:** "123" → "Manda número com DDD"
- [ ] **Código expira:** 30+ min → código não funciona (esperado)
- [ ] **Número já em outra conta:** Evolution erro → Bot escala
- [ ] **Webhook de conexão falha:** Lead fica em `code_sent` (timeout manual ainda é opção)

---

## 💡 Recomendações para Melhorias

### Curto Prazo (1-2 semanas)

1. **Normalização de respostas no WhatsApp**
   - Adicionar `text.trim().toLowerCase().normalize('NFD')` antes de validar
   - Reduz escalações falsas de typos/acentos

2. **Alertar sobre código expirado (WhatsApp)**
   - Se lead em `code_sent` há >5 min, incluir nota
   - "Código expira em ~5 minutos — se não funcionar, pede um novo por aqui"

3. **Melhorar feedback visual em /numeros**
   - Badge "Onboarding em andamento" se status='connecting' e lead em `code_sent`

### Médio Prazo (2-4 semanas)

4. **Dashboard de métricas de onboarding**
   - Leads ativos por estágio
   - Taxa de conversão site → WhatsApp → completed
   - Tempo médio por estágio
   - Taxa de escalação vs. completo

5. **Retry automático em `code_sent`**
   - Se passaram >10 min, reenvia código novo (sem esperar nudge)

6. **A/B test de mensagens**
   - Variações de pitch, CTA, urgência

### Longo Prazo (1-2 meses)

7. **Integração com Asaas (faturamento)**
   - Onboarding inicial (grátis) + upgrade automático

8. **Variante: Telemarketing outbound**
   - Agente de Suporte oferecendo call pessoal pra leads de alto valor

9. **Analytics pixel + UTM tracking**
   - Rastrear fonte de onboarding (organic, paid, email, referral)

---

## 📋 Conclusão

**Status Geral: ✅ Saudável**

O onboarding do ZapScript é bem estruturado e funcional em ambos os canais:

- **WEB:** Gamificado, progressivo, com FAQ integrado. UX clara.
- **WhatsApp:** Conversacional, robusto, com auto-escalação e nudge automático.
- **Integração:** Sem conflitos, compartilha pairing code, lead unificado.

**Pontos Fortes:**
- Duas entradas (site + número direto) cobrem casos de uso
- State machine clara e rastreável
- Auto-escalação + nudge evitam abandono
- Mesmo número oficial unifica onboarding/campanhas/suporte

**Áreas para Melhoria:**
- Parsing de respostas (tolerância a typos/acentos)
- Código expirado em 5 min (urgência não clara)
- Escalação em 2 tentativas é agressiva
- Falta dashboard de métricas

**Recomendação:** Focar nas melhorias de curto prazo para reduzir fricção e escalações falsas. Os testes acima coberão os fluxos críticos.
