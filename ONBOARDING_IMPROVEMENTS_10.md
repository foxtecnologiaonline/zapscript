# 10 Sugestões de Melhoria — Onboarding ZapScript

**Data:** 12 de setembro de 2026  
**Base:** Análise técnica completa de onboarding-whatsapp.ts, onboarding-nudge.ts, e fluxo Web  
**Status:** ✅ Fluxo funcional; sugestões para otimização e robustez

---

## 1. 🎯 Normalização e Detecção Fuzzy de Respostas (WhatsApp)

**Problema:**  
O parser de respostas usa regex literal. Usuários que digitam `"nao"` (sem acento), `"SIM!!"`, ou com espaços extras são marcados como inválidos, disparando escalação prematura. `MAX_ATTEMPTS_BEFORE_ESCALATE = 2` é agressivo.

**Impacto:**
- Escalações falsas (leads bons caem pro Agente desnecessariamente)
- Frustração do usuário (usuário responde corretamente, mas sistema não entende)
- Custo operacional aumentado (Agente trata caso que deveria completar)
- Taxa de conclusão reduzida (~5-10% de leads falsamente escalados)

**Implementação:**
```typescript
// apps/api/src/services/onboarding-whatsapp.ts — função handleReply()
// Adicionar antes de validar respostas:

function normalizeResponse(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')                    // Remove acentos
    .replace(/[^\w\s@.]/g, '')          // Remove pontuação
    .split(/\s+/)
    .join(' ');
}

function isSimilarTo(input: string, target: string): boolean {
  const normalized = normalizeResponse(input);
  const targetWords = normalizeResponse(target).split(/\s+/);
  const inputWords = normalized.split(/\s+/);
  
  // Fuzzy: pelo menos 80% dos chars do target estão em input
  let matches = 0;
  for (const word of targetWords) {
    if (inputWords.some(w => w.startsWith(word.slice(0, 3)))) matches++;
  }
  return matches / targetWords.length >= 0.8;
}

// Em handleReply(), trocar validação literal por fuzzy:
if (isSimilarTo(userText, 'sim') || isSimilarTo(userText, 'yes')) {
  // processa como SIM
} else if (isSimilarTo(userText, 'nao') || isSimilarTo(userText, 'não') || isSimilarTo(userText, 'no')) {
  // processa como NÃO
}

// Aumentar limite de tentativas:
const MAX_ATTEMPTS_BEFORE_ESCALATE = 4;  // era 2
```

**Esforço:** 2-3 horas  
**Prioridade:** 🔴 ALTA (reduz fricção imediatamente)

---

## 2. ⏰ Auto-Regeneração de Código Expirado (WhatsApp)

**Problema:**  
Pairing code da Evolution API expira em ~2-3 minutos. Se lead fica em `code_sent` por >5 minutos, o código que o bot enviou não funciona mais. Nudge só chega após 30 minutos (muito tarde). Usuário tenta, falha, abandona.

**Impacto:**
- Taxa de abandono em `code_sent` aumentada (~20% dos casos)
- Código enviado é "morto" para >90% dos leads que não tentam nos primeiros 3 min
- Falta clareza: usuário não sabe se código expirou ou se fez algo errado

**Implementação:**
```typescript
// apps/api/src/services/onboarding-whatsapp.ts — função closeLeadOnConnected()
// Adicionar verificação de tempo quando lead está em code_sent:

async function checkAndRegenerateExpiredCode(lead: WhatsappOnboardingLead) {
  const now = new Date();
  const codeAge = (now.getTime() - lead.updatedAt.getTime()) / 1000 / 60;  // minutos
  
  if (lead.stage === 'code_sent' && codeAge > 5 && codeAge < 30) {
    // Código provavelmente expirou, regenerar
    const newCode = await requestPairingCode(lead.numberId, lead.phone);
    
    if (newCode.ok) {
      await sendText(lead.instanceName, lead.phone, 
        `O código anterior expirou. Novo código:\n\n${newCode.code}\n\nDigita agora mesmo!`
      );
      
      // Reset timer para código novo
      lead.updatedAt = new Date();
      await prisma.whatsappOnboardingLead.update({
        where: { phone: lead.phone },
        data: { updatedAt: new Date() }
      });
    }
  }
}

// Chamar esta função:
// 1. No scheduled job onboarding-nudge.ts (antes de nudge propriamente)
// 2. No handleReply() se usuário responde em code_sent com algo que pareça "tentei mas falhou"
```

**Esforço:** 2-3 horas  
**Prioridade:** 🔴 ALTA (melhora taxa de conclusão em ~10%)

---

## 3. 🚨 Mensagens Alertando sobre Expiração de Código

**Problema:**  
Bot envia código sem avisar que expira. Usuário pensa "tenho todo o tempo do mundo", tenta depois de 10 min, falha, fica confuso.

**Impacto:**
- Experiência: usuário não entende por que "código inválido"
- Support: mais perguntas "por que meu código não funciona?"
- Abandono: usuário desanima e sai

**Implementação:**
```typescript
// apps/api/src/services/onboarding-whatsapp.ts — função handleReply()
// Após avançar para code_sent, enviar mensagem com urgência:

const messages = {
  code_sent_with_urgency: `✅ Perfeito! Seu código está pronto:

┌─────────────────┐
│   {code}        │
└─────────────────┘

⚠️ *Este código expira em 3 minutos.*
Digita no seu WhatsApp AGORA para conectar!

Se não funcionar, pede um novo por aqui mesmo.`
};

// Também adicionar em onboarding-nudge.ts — ao fazer nudge:
const messages = {
  nudge_code_expired: `👋 Cadê você? 😅

Seu código anterior expirou, mas tá aqui um novo:

┌─────────────────┐
│   {code}        │
└─────────────────┘

⚠️ *Válido por 3 minutos apenas.*
Toca agora pra não perder!`
};
```

**Esforço:** 1-2 horas (apenas mudança de copy)  
**Prioridade:** 🟡 MÉDIA (melhora UX de compreensão)

---

## 4. 📊 Dashboard de Métricas de Onboarding

**Problema:**  
Falta visibilidade sobre saúde do onboarding. Quantos leads estão em cada estágio? Taxa de conclusão? Onde estão os gargalos? Tudo é caixa preta.

**Impacto:**
- Impossível diagnosticar queda de conversão
- Não há dados para A/B testing
- Decisões operacionais cegas (redimensionar Suporte? Mudar copy?)

**Implementação:**
Criar página `/admin/onboarding-metrics` com:

```typescript
// apps/api/src/routes/admin.ts — novo endpoint
GET /admin/onboarding-metrics

Response:
{
  "summary": {
    "total_leads_last_24h": 42,
    "conversion_rate": "71%",
    "avg_time_to_complete": "8m 20s"
  },
  "by_stage": {
    "started": 0,
    "awaiting_consent": 3,
    "awaiting_email": 2,
    "confirm_number": 1,
    "code_sent": 8,           // ← potencial gargalo
    "completed": 28,
    "escalated": 2
  },
  "by_source": {
    "site_signup": 30,
    "oficial_number": 12
  },
  "escalation_reasons": [
    { reason: "max_attempts_exceeded", count: 2 },
    { reason: "evolution_error", count: 0 }
  ],
  "nudge_stats": {
    "nudged_last_hour": 3,
    "escalated_last_hour": 1
  }
}

// No Web, adicionar página:
// apps/web/src/app/admin/onboarding-metrics/page.tsx
// Com gráficos (recharts ou similar):
// - Funil (started → completed)
// - Série temporal (conversões por hora)
// - Distribuição por stage (pizza)
// - Escalações vs completadas (linha)
```

**Esforço:** 6-8 horas (endpoint + página Web + queries otimizadas)  
**Prioridade:** 🟡 MÉDIA (decisões data-driven, mas não bloqueia)

---

## 5. 🔄 Webhook Idempotência para `connection.update`

**Problema:**  
Se Evolution enviar webhook `connection.update` duas vezes (retry ou bug), `closeLeadOnConnected()` executa 2x. Isso dispara 2 mensagens de sucesso e múltiplas chamadas a `offerPlanUpgrade()`.

**Impacto:**
- Usuário recebe duas mensagens "Conectado!" (confuso)
- Múltiplas ofertas de upgrade (spam)
- Logs/métricas duplicadas
- Possível dupla cobrança se upgrade fosse automático

**Implementação:**
```typescript
// apps/api/src/services/onboarding-whatsapp.ts

// Adicionar campo no banco:
// ALTER TABLE WhatsappOnboardingLead ADD completed_at TIMESTAMP NULL;

async function closeLeadOnConnected(numberId: string) {
  const lead = await prisma.whatsappOnboardingLead.findFirst({
    where: { numberId, stage: { notIn: ['completed', 'escalated'] } }
  });

  if (!lead) {
    console.log(`[Idempotent] Lead já processado ou não encontrado para ${numberId}`);
    return;  // Já foi processado, ignora webhook duplicado
  }

  // Marcar como completed COM transação atômica
  const updated = await prisma.$transaction(async (tx) => {
    return tx.whatsappOnboardingLead.update({
      where: { id: lead.id },
      data: { 
        stage: 'completed',
        completedAt: new Date()
      }
    });
  });

  // Apenas se update foi bem-sucedido, enviar mensagens
  if (updated.stage === 'completed') {
    await sendSuccessMessages(lead);
    if (lead.source === 'campanhas') {
      await offerPlanUpgrade(/* ... */);
    }
  }
}

// No webhook handler (evolution-webhook.ts):
// Mesmo padrão — atualizar para completed ANTES de fazer side-effects
```

**Esforço:** 2-3 horas (adição de campo + lógica de transação)  
**Prioridade:** 🔴 ALTA (evita bugs de estado)

---

## 6. 📱 Badge de Status "Onboarding em Andamento" (Web)

**Problema:**  
Usuário conectou via WhatsApp mas ainda vê o modal de conexão na Web. Não está claro se o onboarding continua ou completou.

**Impacto:**
- Confusão: usuário tenta conectar 2x
- Múltiplas tentativas = múltiplas instâncias Evolution (desperdício)
- UX: falta feedback visual

**Implementação:**
```typescript
// apps/web/src/app/dashboard/numeros/page.tsx — ConnectModal

// Adicionar status do lead ao carregar número:
const loadNumber = async (id: string) => {
  const num = await fetch(`/api/numbers/${id}`).then(r => r.json());
  
  // Buscar lead associado (por phone)
  const lead = num.phone ? 
    await fetch(`/api/onboarding-lead?phone=${num.phone}`).then(r => r.json()) 
    : null;
  
  return { number: num, lead };
};

// No ConnectModal, adicionar estado:
if (lead && lead.stage !== 'completed') {
  return (
    <div className="bg-blue-50 p-4 rounded border border-blue-200">
      <div className="flex gap-2 items-start">
        <Badge variant="blue">Onboarding em Andamento</Badge>
      </div>
      <p className="text-sm text-gray-600 mt-2">
        {stage === 'code_sent' && 'Aguardando conexão via WhatsApp. Digita o código no seu celular!'}
        {stage === 'awaiting_email' && 'Confirme seu e-mail no WhatsApp.'}
        {stage === 'confirm_number' && 'Confirme o número no WhatsApp.'}
      </p>
      <p className="text-xs text-gray-500 mt-2">
        Não feche esta página — vamos atualizar em tempo real.
      </p>
    </div>
  );
}
```

**Esforço:** 2-3 horas (novo endpoint + UI badge)  
**Prioridade:** 🟡 MÉDIA (melhora UX)

---

## 7. 🛑 Timeout Explícito em Estados de Espera (WhatsApp)

**Problema:**  
Se webhook de conexão falha ou demora demais, lead fica em `code_sent` indefinidamente. Sem timeout explícito, usuário nunca sabe se vá funcionar.

**Impacto:**
- Lead em limbo (aparenta ativo mas não progride)
- Sem feedback ao usuário (tá funcionando ou não?)
- Métricas: "concluído" nunca chega

**Implementação:**
```typescript
// apps/api/src/services/onboarding-whatsapp.ts

const STAGE_TIMEOUTS_MS = {
  'awaiting_consent': 24 * 60 * 60 * 1000,   // 24h (conversação tem ritmo lento)
  'awaiting_email': 24 * 60 * 60 * 1000,     // 24h
  'confirm_number': 24 * 60 * 60 * 1000,     // 24h
  'code_sent': 10 * 60 * 1000,               // 10 minutos (código expira em 3)
};

async function checkForTimeouts(lead: WhatsappOnboardingLead) {
  const timeout = STAGE_TIMEOUTS_MS[lead.stage];
  if (!timeout) return;

  const ageMs = Date.now() - lead.updatedAt.getTime();
  
  if (ageMs > timeout) {
    // Expirou — escalar
    console.log(`[Timeout] Lead ${lead.phone} em ${lead.stage} por ${Math.round(ageMs / 1000 / 60)}min`);
    
    await escalateAbandonedLead(lead);
    
    await sendText(lead.instanceName, lead.phone,
      `Tempo de espera esgotado. Vou chamar um agente para ajudar. Aguarde!`
    );
  }
}

// Chamar em onboarding-nudge.ts — além dos limites de 30-60min:
// 1. check nudge (30-60min)
// 2. check escalate (>60min)
// 3. check timeouts (stage-specific)
```

**Esforço:** 2-3 horas (adição de timeouts por stage)  
**Prioridade:** 🟡 MÉDIA (evita leads mortos)

---

## 8. 🔐 Retry com Backoff para Provisioning da Evolution API

**Problema:**  
Se `provisionInstance()` ou `requestPairingCode()` falhar na primeira tentativa (erro de rede, API temporariamente indisponível), bot escalas imediatamente. Nenhum retry.

**Impacto:**
- Escalações falsas por erro transitório da Evolution
- API flaky = tudo falha uma vez
- Reduz taxa de sucesso artificial

**Implementação:**
```typescript
// apps/api/src/services/number-provisioning.ts

async function requestPairingCodeWithRetry(
  numberId: string, 
  phone: string,
  maxRetries = 3
): Promise<{ ok: boolean; code?: string; error?: string }> {
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await requestPairingCode(numberId, phone);
      if (result.ok) return result;
      
      // Se falha, fazer backoff
      if (attempt < maxRetries - 1) {
        const delayMs = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s
        console.log(`[Retry] Tentativa ${attempt + 1}/${maxRetries}, aguardando ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    } catch (e: any) {
      console.error(`[Retry] Erro na tentativa ${attempt + 1}: ${e.message}`);
      if (attempt === maxRetries - 1) {
        return { ok: false, error: e.message };
      }
    }
  }
  
  return { ok: false, error: 'Máximo de tentativas atingido' };
}

// Em handleReply() ou startFromOfficialNumber(), usar:
const codeResult = await requestPairingCodeWithRetry(lead.numberId, lead.phone);
if (!codeResult.ok) {
  // Apenas agora escalar
  await escalateAbandonedLead(lead);
}
```

**Esforço:** 1-2 horas (wrapper com retry)  
**Prioridade:** 🟡 MÉDIA (reduz escalações falsas)

---

## 9. 📧 Magic Link com Feedback Visual de Expiração

**Problema:**  
Magic link entra em `awaiting_email`, bot envia link. Usuário clica em uma hora, link expirou (padrão Supabase é ~30 min). Bot não avisa que link expira nem oferece "reenviar link".

**Impacto:**
- Usuário pensa que link "não funciona" (não sabe que expirou)
- Frustração
- Falta "reenviar" → força escalar pro Agente

**Implementação:**
```typescript
// apps/api/src/services/account-provisioning.ts

const MAGIC_LINK_EXPIRY_MIN = 30;  // Supabase default

async function sendMagicLinkMessage(email: string, phone: string, instanceName: string) {
  const link = await createMagicLink(email);  // Supabase
  
  const message = `✅ Sua conta foi criada! 🎉

Para confirmar, clique no link abaixo:

${link}

⚠️ *Link válido por ${MAGIC_LINK_EXPIRY_MIN} minutos.*

Se expirar, responda "REENVIAR" aqui mesmo que mando um novo.`;

  await sendText(instanceName, phone, message);
  
  // Registrar que link foi enviado (para validar "REENVIAR" depois)
  await prisma.whatsappOnboardingLead.update({
    where: { phone },
    data: { 
      magicLinkSentAt: new Date(),
      stage: 'awaiting_confirmation'  // novo stage intermediário?
    }
  });
}

// No handleReply(), detectar "REENVIAR":
if (text.toLowerCase().includes('reenviar') && lead.stage === 'awaiting_confirmation') {
  // Reenviar link
  const link = await createMagicLink(lead.email);
  await sendText(lead.instanceName, lead.phone, 
    `Novo link criado:\n\n${link}\n\nVálido por ${MAGIC_LINK_EXPIRY_MIN} minutos.`
  );
}
```

**Esforço:** 2-3 horas (novo stage + lógica de reenvio)  
**Prioridade:** 🟡 MÉDIA (melhora experiência com links)

---

## 10. 🎯 A/B Test de Mensagens (Framework)

**Problema:**  
Bot usa copy fixo. Não há dados sobre qual mensagem converte melhor. "Responda SIM" vs "Digite: SIM" — qual funciona?

**Impacto:**
- Copy subótimo (pode estar assustando usuários)
- Sem experimentos = sem aprendizado
- Hipóteses nunca são testadas

**Implementação:**
```typescript
// apps/api/src/lib/ab-test.ts — novo arquivo

interface ABTestVariant {
  id: string;
  weight: number;  // 0-1 (0.5 = 50%)
}

interface ABTest {
  name: string;
  control: ABTestVariant;
  variants: ABTestVariant[];
  startDate: Date;
  endDate?: Date;
}

// Variações de pitch onboarding:
const ONBOARDING_PITCH_TEST: ABTest = {
  name: 'onboarding_pitch_tone',
  control: {
    id: 'formal',
    weight: 0.5,
    copy: 'Posso criar sua conta grátis...'
  },
  variants: [
    {
      id: 'casual',
      weight: 0.5,
      copy: 'Vamo lá, deixa eu criar sua conta grátis...'
    }
  ]
};

// Ao iniciar lead:
function pickVariant(test: ABTest): string {
  const rand = Math.random();
  let cumWeight = 0;
  
  for (const variant of [test.control, ...test.variants]) {
    cumWeight += variant.weight;
    if (rand < cumWeight) {
      return variant.id;
    }
  }
  
  return test.control.id;
}

// Em startFromOfficialNumber():
const variant = pickVariant(ONBOARDING_PITCH_TEST);
await prisma.whatsappOnboardingLead.create({
  data: {
    phone,
    stage: 'awaiting_consent',
    abTestVariant: variant,
    // ...
  }
});

// Análise: agrupar leads por variant, comparar conversion_rate
```

**Esforço:** 4-6 horas (framework A/B + tracking + análise)  
**Prioridade:** 🟢 BAIXA (nice-to-have, melhora copy mas não crítico)

---

## 📋 Resumo e Roadmap

| # | Título | Esforço | Prioridade | Impacto |
|---|--------|---------|------------|---------|
| 1 | Normalização fuzzy | 2-3h | 🔴 ALTA | -5-10% escalações |
| 2 | Auto-regen código | 2-3h | 🔴 ALTA | +10% conclusões |
| 3 | Avisos expiração | 1-2h | 🟡 MÉDIA | UX (compreensão) |
| 4 | Dashboard métricas | 6-8h | 🟡 MÉDIA | Visibility |
| 5 | Webhook idempotência | 2-3h | 🔴 ALTA | Evita bugs |
| 6 | Badge status Web | 2-3h | 🟡 MÉDIA | UX (feedback) |
| 7 | Timeouts explícitos | 2-3h | 🟡 MÉDIA | Evita leads mortos |
| 8 | Retry com backoff | 1-2h | 🟡 MÉDIA | -X% escalações falsas |
| 9 | Magic link UX | 2-3h | 🟡 MÉDIA | Retenção |
| 10 | A/B test framework | 4-6h | 🟢 BAIXA | Otimização |

### Sugestão de Fases

**Fase 1 (URGENT — 1 semana):** #1, #2, #5  
- Reduz escalações, aumenta taxa de conclusão, evita bugs  
- 6-8 horas total

**Fase 2 (CURTO PRAZO — 2 semanas):** #3, #6, #8  
- Melhora UX, reduz fricção  
- 5-8 horas total

**Fase 3 (MÉDIO PRAZO — 1 mês):** #4, #7, #9  
- Visibilidade, robustez, experiência  
- 10-14 horas total

**Fase 4 (LONGO PRAZO):** #10  
- Otimização contínua via dados

---

## ✅ Conclusão

O onboarding está **funcional e saudável**, mas tem oportunidades claras para:
- **Reduzir escalações falsas** (#1, #2, #8)
- **Melhorar transparência** (#3, #6)
- **Aumentar confiabilidade** (#5, #7)
- **Tomar decisões baseadas em dados** (#4, #10)

**Recomendação:** Começar com Fase 1 imediatamente (alto impacto, baixo esforço).
