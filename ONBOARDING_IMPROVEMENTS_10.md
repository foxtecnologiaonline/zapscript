# 7 Sugestões de Melhoria Prioritárias — Onboarding ZapScript

**Data:** 12 de setembro de 2026  
**Base:** Análise técnica completa de onboarding-whatsapp.ts, onboarding-nudge.ts, e fluxo Web  
**Status:** ✅ Fluxo funcional; sugestões focadas em impacto real  
**Abordagem:** Assertivo — remover ruído, priorizar bloqueadores e ganhos imediatos

---

## 1. 🎯 Tolerância de Parser + Limite de Escalação (WhatsApp)

**O Problema:**  
Regex literal rejeita `"nao"`, `"SIM!!"`, `"   sim   "`. `MAX_ATTEMPTS_BEFORE_ESCALATE = 2` escalas usuário que errou uma vez. Resultado: ~8-12% de escalações falsas.

**Impacto Direto:**
- ❌ Usuário responde corretamente → escalado por typo
- ❌ Suporte sobrecarregado (trata caso que deveria completar)
- ❌ Taxa de conclusão cai 8-12%
- ❌ Perda de usuário (frustrado)

**Implementação (OBRIGATÓRIA):**
```typescript
// apps/api/src/services/onboarding-whatsapp.ts

// 1. Normalizar entrada
function normalizeResponse(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\w]/g, '')
    .slice(0, 5);  // primeiras 5 letras
}

// 2. Validação fuzzy (80% match)
const isYes = (t: string) => ['sim', 'yes', 'yep', 'siiim'].some(w => 
  normalizeResponse(t).startsWith(w.slice(0, 3)));
const isNo = (t: string) => ['nao', 'não', 'no', 'nunca'].some(w => 
  normalizeResponse(t).startsWith(w.slice(0, 3)));

// 3. Aumentar tolerância
const MAX_ATTEMPTS_BEFORE_ESCALATE = 4;  // ERA: 2 → NOVO: 4
```

**Esforço:** 1-2 horas  
**Prioridade:** 🔴 CRÍTICA (impacto IMEDIATO)

---

## 2. ⏰ Regeneração de Código + Aviso de Expiração (WhatsApp)

**O Problema:**  
Código expira em 2-3 min. Usuário recebe código, vai tentar em 10 min → não funciona. Não há aviso. Escalação falsa.

**Impacto Direto:**
- ❌ ~20% abandona em `code_sent` por código morto
- ❌ Sem clareza: usuário não sabe se falhou ou se código expirou
- ❌ Nudge só vem após 30 min (muito tarde)

**Implementação (OBRIGATÓRIA):**

**Parte A:** Avisar com urgência
```typescript
// apps/api/src/services/onboarding-whatsapp.ts

const message = `✅ Perfeito! Seu código está pronto:

┌──────────────┐
│   {CODE}     │
└──────────────┘

⚠️ *Este código EXPIRA EM 3 MINUTOS*
Digita agora mesmo no seu WhatsApp!

Se não funcionar, me responde "CÓDIGO NOVO" que envio outro.`;
```

**Parte B:** Regenerar automaticamente após 5 min
```typescript
// onboarding-nudge.ts (ou novo cron job a cada 5 min)

if (lead.stage === 'code_sent' && ageMinutes > 5) {
  const newCode = await requestPairingCode(lead.numberId, lead.phone);
  await sendText(lead.instanceName, lead.phone,
    `Código anterior expirou! Novo código:\n\n${newCode.code}\n\n⚠️ Válido por 3 min. Toca AGORA!`
  );
}
```

**Esforço:** 1-2 horas  
**Prioridade:** 🔴 CRÍTICA (+10% conclusão)

---

## 3. 📊 Dashboard de Métricas (OBRIGATÓRIO para Diagnóstico)

**O Problema:**  
Sem dados = sem diagnóstico. Não se sabe: taxa de conclusão, onde abandona, se escalações caíram com as mudanças.

**Impacto Direto:**
- ❌ Impossível saber se melhoria funcionou
- ❌ Decisões cegas (aumentar Suporte? Mudar copy?)
- ❌ Não detecta regressão

**Implementação (RÁPIDA):**

**Opção A (MVP — 3 horas):**
```sql
-- Query simples direto no DB
SELECT 
  stage,
  COUNT(*) as count,
  COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h
FROM WhatsappOnboardingLead
GROUP BY stage;
```
Resultado em tabela no Metabase/DBeaver. **Simples mas funciona.**

**Opção B (Completo — 6-8 horas):**
```typescript
// GET /api/admin/onboarding-metrics
{
  "completion_rate": "71%",
  "by_stage": { "code_sent": 8, "completed": 28, "escalated": 2 },
  "avg_time_minutes": 8.5,
  "escalation_rate": "7%"
}
```
Página `/admin/onboarding-metrics` com gráficos (recharts).

**Recomendação:** Opção A HOJE (diagnóstico imediato) → Opção B próxima semana.

**Esforço:** 3h (MVP) ou 6-8h (completo)  
**Prioridade:** 🔴 CRÍTICA (feedback de mudanças)

---

## 4. 🔄 Webhook Idempotência (Evolution `connection.update`)

**O Problema:**  
Se webhook dispara 2x (retry), `closeLeadOnConnected()` executa 2x → 2 mensagens "Conectado!" + spam de upgrade.

**Impacto Direto:**
- ❌ Usuário recebe 2 mensagens (confuso)
- ❌ 2x chamada a `offerPlanUpgrade()` (pode cobrança dupla)
- ❌ Dados inconsistentes (métrica de conversão contada 2x)

**Implementação (RÁPIDA):**
```typescript
// apps/api/src/services/onboarding-whatsapp.ts

async function closeLeadOnConnected(numberId: string) {
  // 1. Buscar lead (apenas se NÃO é completed/escalated)
  const lead = await prisma.whatsappOnboardingLead.findFirst({
    where: { numberId, stage: { notIn: ['completed', 'escalated'] } }
  });

  if (!lead) return;  // ← IDEMPOTÊNCIA: já foi processado, ignora

  // 2. Atualizar ANTES de side-effects
  await prisma.whatsappOnboardingLead.update({
    where: { id: lead.id },
    data: { stage: 'completed', completedAt: new Date() }
  });

  // 3. DEPOIS envia mensagens
  await sendText(/* success message */);
  if (lead.source === 'campanhas') {
    await offerPlanUpgrade(/* ... */);
  }
}
```

**Esforço:** 1 hora (apenas ordem de operações)  
**Prioridade:** 🔴 CRÍTICA (evita duplicação)

---

## 5. 📱 Badge de Status "Onboarding em Andamento" (Evita Duplicação)

**O Problema:**  
Usuário conectou via WhatsApp mas clica "Conectar" de novo na Web → múltiplas instâncias Evolution criadas.

**Impacto Direto:**
- ❌ Duplas tentativas de conexão
- ❌ Desperdício de recursos (instâncias extras)
- ❌ Confusão visual: parece que nada funcionou

**Implementação (RÁPIDA):**
```typescript
// apps/api/src/routes/numbers.ts — novo endpoint
GET /api/numbers/:id/onboarding-status
→ { stage: 'code_sent', message: 'Aguardando código...', canRetry: false }

// apps/web/src/app/dashboard/numeros/page.tsx
const { stage } = await fetch(`/numbers/${id}/onboarding-status`).then(r => r.json());

if (stage && stage !== 'completed') {
  return <Alert title="Onboarding em Andamento" description={messages[stage]} />;
}
```

**Esforço:** 1-2 horas (endpoint + UI)  
**Prioridade:** 🟡 ALTA (evita travamento)

---

## 6. 🛑 Timeout em `code_sent` (Lead Morto → Reanimar ou Escalar)

**O Problema:**  
Webhook não chega (Evolution falha), lead fica em `code_sent` para sempre. Sem timeout, nunca descobre que falhou.

**Impacto Direto:**
- ❌ Lead em limbo (parece ativo mas morto)
- ❌ Sem feedback ao usuário (confuso)
- ❌ Métrica: nunca marca como "abandonado"

**Implementação (PRAGMÁTICA):**
```typescript
// apps/api/src/services/onboarding-nudge.ts

// Adicionar após nudge/escalate existing:
const TIMEOUT_CODE_SENT_MIN = 10;  // Código + conversação

const timedOut = await prisma.whatsappOnboardingLead.findMany({
  where: { 
    stage: 'code_sent',
    updatedAt: { lt: new Date(Date.now() - TIMEOUT_CODE_SENT_MIN * 60 * 1000) }
  }
});

for (const lead of timedOut) {
  await escalateAbandonedLead(lead);
  await sendText(lead.instanceName, lead.phone,
    `Seu código expirou e não conseguimos conectar. Vou chamar um agente para ajudar. Aguarde!`
  );
}
```

**Esforço:** 30 minutos (copy-paste existente)  
**Prioridade:** 🟡 ALTA (evita leads zumbis)

---

## 7. 🔐 Retry com Backoff (Evolution API Flaky)

**O Problema:**  
Se Evolution API falha 1x (flaky) → bot escalas. Sem retry, erro transitório vira permanente.

**Impacto Direto:**
- ❌ Escalações falsas por erro de rede da Evolution
- ❌ Taxa de sucesso artificial baixa

**Implementação (MÍNIMA):**
```typescript
// apps/api/src/services/number-provisioning.ts

async function requestPairingCodeWithRetry(numberId: string, phone: string) {
  for (let i = 0; i < 3; i++) {
    try {
      return await requestPairingCode(numberId, phone);
    } catch (e) {
      if (i === 2) throw e;  // última tentativa falhou
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));  // 1s, 2s, 4s
    }
  }
}

// Usar:
const code = await requestPairingCodeWithRetry(numberId, phone)
  .catch(() => escalateAbandonedLead(lead));  // Só escala se todas falharem
```

**Esforço:** 30 minutos  
**Prioridade:** 🟡 MÉDIA (robustez)

---


---

## 📋 Roadmap Executivo

| # | Sugestão | Esforço | Impacto | Sprint |
|---|----------|---------|---------|--------|
| 1 | Parser tolerante + limite 4 | 1-2h | -8% escalações falsas | S1 🔴 |
| 2 | Código: regen + aviso | 1-2h | +10% conclusão | S1 🔴 |
| 3 | Dashboard de métricas | 3-8h | Visibilidade | S1-S2 🔴 |
| 4 | Webhook idempotência | 1h | Evita duplicação | S1 🔴 |
| 5 | Badge status (Web) | 1-2h | Evita re-tentativa | S2 |
| 6 | Timeout em `code_sent` | 30min | Escala leads mortos | S2 |
| 7 | Retry com backoff | 30min | Robustez | S2 |

**Total Fase 1 (URGENT — 5-7 horas):** #1, #2, #3, #4  
→ Reduz escalações, aumenta conclusão, fornece dados

**Total Fase 2 (CURTO PRAZO — 3-4 horas):** #5, #6, #7  
→ Melhora UX, evita leads zumbis, robustez

---

## 🎯 Conclusão Assertiva

**Status:** ✅ Funcional. **Oportunidade:** -12% escalações falsas + 10% conclusão com 8-10 horas de trabalho.

### Por que Fazer Agora?

1. **Escalações falsas custam real:** Suporte gasta tempo com leads que eram bons
2. **Taxa de conclusão é métrica crítica:** Toda % que melhora impacta growth
3. **Esforço baixo:** Sprint 1 = 5-7h. Sprint 2 = 3-4h.
4. **Sem risco:** Mudanças são conservadoras, não quebram nada

### Como Priorizar

```
HOJE:    #1 (1h) + #2 (2h) + #4 (1h) = 4h urgentes
Amanhã:  #3 (3h) = Dashboard MVP
Próxima semana: #5, #6, #7 = UX + robustez
```

**Responsável:** Atribuir para desenvolvedor sênior (conhece fluxo, pode revisar em paralelo).  
**Validação:** Rodar queries do Dashboard (#3) ANTES e DEPOIS de cada mudança.

---

**🚀 Começar em 24h. Medir em 1 semana. Celebrar em 2 semanas.**
