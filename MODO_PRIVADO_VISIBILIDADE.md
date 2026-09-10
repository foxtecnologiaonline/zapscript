# Modo Privado — Documentação de Visibilidade e Comportamento

## 📌 Resumo Executivo

O **Modo Privado** é uma feature **opt-in** (desligado por padrão) disponível **apenas para usuários com planos pagos** (Pro, Pro-Tester, Executive).

| Aspecto | Status |
|---------|--------|
| Aparece na UI? | ✅ SIM (apenas planos pagos) |
| Ativado por padrão? | ❌ NÃO (opt-in manual) |
| Disponível para novos usuários? | ✅ SIM (se plano pago) |

---

## 🎯 O que faz?

### Modo Privado **DESATIVADO** (padrão)
- Resumo chega **na própria conversa do contato**
- Todos veem que o áudio foi processado
- Comportamento: "público"

### Modo Privado **ATIVADO**
- Resumo chega **só no seu número** (via chat privado com você mesmo)
- O contato não sabe que recebeu o áudio
- Comportamento: "privado"

---

## 👥 Quem vê a opção?

### ✅ Veem o toggle:
- Usuários **Pro**
- Usuários **Pro-Tester**
- Usuários **Executive**

### ❌ Não veem:
- Usuários **Free** (Core)
- Usuários **Starter**

**Código:** `isPaid = planName === 'pro' || planName === 'pro-tester' || planName === 'executive'`
**Arquivo:** `apps/web/src/app/dashboard/numeros/page.tsx` (linha 697)

---

## 🆕 Para novos usuários

### Novo número criado:
```typescript
// Backend: apps/api/src/routes/numbers.ts (linha 73)
data: { userId, displayName: finalName, privateMode: false, ... }
```

- Nasce com `privateMode: false` (desligado)
- Usuário pago pode ativar no painel a qualquer momento
- Toggle fica no card de cada número (linhas 952-961)

### First-time tip (dica de boas-vindas)
- Mostrada **uma única vez** para usuários pagos
- Armazenada em `localStorage` sob `zs_privado_tip_v1`
- Diz: "Como você é assinante, cada resumo chega **só no seu número**"

**Código:** `apps/web/src/app/dashboard/numeros/page.tsx` (linhas 820-833)

---

## 🔄 Como alterar

### Via API
```bash
PATCH /numbers/:id
{
  "privateMode": true  # ou false para desativar
}
```

### Via Dashboard
1. Ir para "Números WhatsApp"
2. Encontrar o número
3. Clicar no toggle "🔒 Modo Privado"

---

## 📊 Estados no banco de dados

### Schema (Prisma)
```prisma
model WhatsappNumber {
  privateMode  Boolean  @default(false)
  // ...
}
```

### Migrations
1. **20260523_features_batch1** → Adiciona campo com `DEFAULT false`
2. **20260707_private_mode_default_on** → Muda DEFAULT para `true` + backfill (REVERTIDO)
3. **20260910_private_mode_opt_in_restore** → Volta para `DEFAULT false` (novo padrão opt-in)

---

## ✅ Checklist de Visibilidade

- [x] Modo Privado aparece apenas para planos pagos
- [x] Toggle funciona para ativar/desativar
- [x] Novos números começam desligados
- [x] Novos usuários pagos veem a opção
- [x] Dica de primeira vez funciona
- [x] API retorna `privateMode` no GET /numbers
- [x] API permite atualizar via PATCH /numbers/:id
- [x] Schema.prisma sincronizado com banco
- [x] Backend sincronizado com expectativa opt-in

---

## 🚀 Deployment

Após merge:
1. Executar: `prisma migrate deploy` (aplica migration 20260910)
2. Resetar números para `privateMode = false` (via migration)
3. Usuários pagos podem ativar novamente no painel
4. Novos números sempre nascem desligados

---

## 📝 Notas Técnicas

### Por que opt-in, não opt-out?
- **Opt-out (ativado por padrão):** Pode gerar surpresas — resumo não chega onde o contato espera
- **Opt-in (desligado por padrão):** Padrão mais conservador — usuário ativa quando sabe o que quer

### Impacto em novos usuários
- ✅ Não quebra esperativas: primeiro resumo chega na conversa (padrão)
- ✅ Usuário descobre toggle no painel
- ✅ Pode ativar se quiser privacidade

### Por que apenas planos pagos?
- Feature de privacidade/controle granular = diferencial premium
- Core (free) recebe resumos na conversa sempre
- Pro+ pode escolher onde recebe
