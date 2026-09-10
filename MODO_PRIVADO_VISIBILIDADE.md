# Modo Privado — Documentação de Visibilidade e Comportamento

## 📌 Resumo Executivo

O **Modo Privado** é uma feature **opt-in** (desligado por padrão) disponível **para TODOS os usuários** (Free, Pago, Novos, Antigos).

| Aspecto | Status |
|---------|--------|
| Aparece na UI? | ✅ SIM (para todos) |
| Ativado por padrão? | ❌ NÃO (opt-in manual) |
| Disponível para novos usuários? | ✅ SIM (sempre) |

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
- ✅ Todos os usuários (Free, Pro, Executive, Profissional, Empresas)
- ✅ Usuários novos
- ✅ Usuários antigos

**Código:** `showPrivateMode = true` (sempre ativado)
**Arquivo:** `apps/web/src/app/dashboard/numeros/page.tsx` (linha ~698)

---

## 🆕 Para novos usuários

### Novo número criado:
```typescript
// Backend: apps/api/src/routes/numbers.ts (linha 73)
data: { userId, displayName: finalName, privateMode: false, ... }
```

- Nasce com `privateMode: false` (desligado — padrão opt-in)
- **Qualquer usuário** pode ativar no painel a qualquer momento
- Toggle fica no card de cada número para todos

### First-time tip (dica de boas-vindas)
- Mostrada **uma única vez** para todos os usuários
- Armazenada em `localStorage` sob `zs_privado_tip_v1`
- Diz: "Novo: Modo Privado para todos" e explica como funciona

**Código:** `apps/web/src/app/dashboard/numeros/page.tsx` (linhas ~819-833)

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

- [x] Modo Privado aparece para TODOS (free, pago, novos, antigos)
- [x] Toggle funciona para ativar/desativar
- [x] Novos números começam desligados (opt-in)
- [x] Qualquer novo usuário vê a opção
- [x] Dica de primeira vez funciona para todos
- [x] API retorna `privateMode` no GET /numbers
- [x] API permite atualizar via PATCH /numbers/:id
- [x] Schema.prisma sincronizado com banco
- [x] Backend sincronizado com expectativa opt-in
- [x] Frontend liberado para todos os usuários

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

### Por que para todos agora?
- Feature de privacidade/controle = básico para todos
- Todos os usuários precisam controlar onde o resumo chega
- Free e Pago têm mesma liberdade de escolha
- Opt-in conservador: padrão é conversa do contato (público)
- Usuário ativa privado quando deseja
