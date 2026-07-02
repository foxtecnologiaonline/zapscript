# Kickoff — Sessão dedicada ao Agente de Atendimento (ZapScript)

> **Como usar:** abra uma nova sessão do Claude Code **neste mesmo repositório**
> (`C:\FOX tecnologIA\ZapScript`) e cole o bloco "PROMPT INICIAL" abaixo. Esta
> sessão deve tratar **exclusivamente** do Agente de Atendimento — nada de outras
> frentes (marketing, billing, etc.).

---

## PROMPT INICIAL (cole isto na nova sessão)

```
Esta sessão é dedicada EXCLUSIVAMENTE ao Agente de Atendimento do ZapScript.
Leia .claude/atendimento-handoff.md e a memória agent_atendimento_2026_06_29.md
antes de agir. Continue de onde paramos. Idioma: PT-BR, respostas curtas.
Regra crítica: push na branch chore/evolution-oci-deploy dispara DEPLOY DE
PRODUÇÃO — nunca commitar/pushar sem minha confirmação explícita.
```

---

## O que é (não confundir)
- **Agente Claude Code `atendimento`** (`.claude/agents/atendimento.md`): construtor/
  revisor/executor. Roda no ambiente do dev, opera a fila via endpoints admin.
- **Bot de runtime** (produção, já existe): `support-agent.ts` + `support-intake.ts`
  + `suporte-whatsapp.ts` (Evolution/QR) + fila em `suporte-admin.ts`. Fala com o
  cliente 24/7. O agente acima **supervisiona** este bot, não o substitui.

## Decisões já tomadas (2026-06-29)
- Autonomia de execução do agente = **"enviar só os verdes"** (não-sensível + alta
  confiança + passou na revisão). AMARELO regenera; VERMELHO (cancelamento/cobrança/
  reembolso/reclamação grave/jurídico OU baixa confiança) escala, nunca envia; spam marca.
- Operação = **recorrente automático**.
- Bot de runtime ajustado para **respostas curtas e objetivas** (estilo WhatsApp).

## Estado do código (PUBLICADO 2026-06-29 — commit 4bec2bf)
Respostas-curtas no ar (push em chore/evolution-oci-deploy = deploy de produção):
- `apps/api/src/services/support-agent.ts` — SYSTEM_PROMPT curto/objetivo + regra de
  não vazar saldo/cota/pagamento + `canal` no RunAgentInput + helper `brevityHint()`.
- `apps/api/src/services/support-intake.ts` — passa `canal` ao agente.
- `apps/api/src/routes/suporte-admin.ts` — importa `Canal`, passa `canal` no regenerate.

## Endpoints admin que o agente usa
Base `${ZAPSCRIPT_API_URL:-https://zapscript-api.onrender.com}`, header
`x-admin-token: $ADMIN_TOKEN`, prefixo `/sys/g5r8t2/suporte`:
queue · atendimento/:id/(approve|edit|regenerate|escalate|spam) · metrics ·
knowledge · faq-suggestions. Mapa completo e payloads em `.claude/agents/atendimento.md`.

## Pendências (ordem sugerida)
1. ~~**Publicar respostas-curtas:** commit + push (= deploy de produção).~~ ✅ FEITO 2026-06-29 (commit 4bec2bf).
2. **Go-live do bot no WhatsApp (Evolution):** instância `zs-suporte`; env no Render
   (`SUPPORT_EVOLUTION_INSTANCE`, `SUPPORT_EVOLUTION_WEBHOOK_SECRET`, `ADMIN_NOTIFY_PHONE`,
   `ANTHROPIC_API_KEY`); webhook `MESSAGES_UPSERT` → `/webhook/suporte/whatsapp?secret=`;
   aplicar migração + seed KB (`seed-support-kb.ts`); conectar QR; testar caso simples +
   caso sensível. Detalhe em `BRIEFING_SUPORTE.md` §5/§12.
3. **1ª rodada read-only** do agente contra a fila real (validar julgamento antes de soltar envio).
4. **Ligar recorrência:** começar `/loop` local 30 min → depois scheduled cloud task 24/7
   (cadastrar `ADMIN_TOKEN`/`ZAPSCRIPT_API_URL` como secrets no ambiente cloud).

## Guardrails inegociáveis
Nunca vazar saldo/cota na conversa · nunca auto-responder sensível · nunca git push/
deploy sem confirmação · nunca chutar ADMIN_TOKEN · na dúvida, escalar.
