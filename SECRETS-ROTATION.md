# 🔐 Checklist de Rotação de Segredos — ZapScript

> **Por que:** os segredos abaixo já estiveram no histórico do git (em `zapscript.env`/`zapscriptworker.env` antes do `git rm --cached`). Qualquer pessoa com acesso ao histórico do repositório tem essas chaves. **Rotacionar é o único bloqueador para comercializar.**
>
> **Regra de ouro:** execute você mesmo. **Não cole nenhuma chave nova no chat com o assistente** — qualquer chave que apareça na conversa é considerada exposta. O assistente só te guia.

---

## ⚠️ Antes de começar — leia os 2 casos especiais

### 🔴 `ENCRYPTION_KEY` — NÃO rotacione na bruta
Esta chave criptografa **todas as transcrições no banco** (`originalText`, `summaryBullets`, `contactPhone`) e os webhook secrets, em AES-GCM. Se você trocar a chave sem re-criptografar, **todos os dados existentes ficam ilegíveis permanentemente** (erro de decrypt em toda a aba Transcrições).

**Opções:**
- **(A) Manter a chave atual** — risco real é baixo: só vaza dado se o atacante tiver *também* um dump do banco. Aceitável para lançar, rotacionar depois com calma.
- **(B) Rotacionar com migração** — precisa de um script que: lê tudo → `decrypt` com a chave velha → `encrypt` com a nova → grava. **Peça ao assistente para gerar esse script** (ele não precisa da chave: o script lê de `ENCRYPTION_KEY_OLD` e `ENCRYPTION_KEY_NEW` do ambiente). Recomendado **pós-lançamento**.

➡️ **Para lançar agora: opção (A).** Marque `ENCRYPTION_KEY` como "rotacionar depois".

### 🟡 `JWT_SECRET` — desloga todo mundo
Trocar invalida todos os tokens ativos → todos os usuários precisam logar de novo. Faça **fora do horário de pico**. Sem perda de dados.

---

## 📋 Tabela de rotação

Legenda — **Onde rotacionar** (origem) → **Onde atualizar** (Vultr — `.env` do servidor, usado por API e Worker —, Vercel Web, Monitor).

### Grupo A — Você gera (chaves internas)
Gere cada uma localmente. Comandos:
```bash
# 32 bytes hex (INTERNAL_TOKEN, MONITOR_TOKEN, ADMIN_TOKEN, *_WEBHOOK_*)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 48 bytes hex (JWT_SECRET)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

| Segredo | Gerar | Atualizar em | Observação |
|---|---|---|---|
| `JWT_SECRET` | randomBytes(48) | Vultr (.env: API + Worker) | ⚠️ desloga todos. Off-peak. |
| `INTERNAL_TOKEN` | randomBytes(32) | Vultr (.env: API + Worker) | precisa ser **idêntico** nos dois |
| `MONITOR_TOKEN` | randomBytes(32) | Vultr (.env: API) + Monitor | idêntico nos dois |
| `ADMIN_TOKEN` | randomBytes(32) | Vultr (.env: API) | é a senha do painel `/g5r8t2` |
| `WHATSAPP_WEBHOOK_TOKEN` | randomBytes(32) | Vultr (.env: API) **+ painel Meta** | atualizar no webhook do Meta |
| `EVOLUTION_WEBHOOK_SECRET` | randomBytes(32) | Vultr (.env: API) **+ Evolution** | atualizar config do webhook Evolution |
| `ASAAS_WEBHOOK_TOKEN` | randomBytes(32) | Vultr (.env: API) **+ painel Asaas** | Asaas → Notificações → Webhooks |
| `ENCRYPTION_KEY` | **NÃO AGORA** | — | ver caso especial 🔴 acima |

### Grupo B — Provedor emite (revogar + gerar novo no painel)

| Segredo | Onde rotacionar | Atualizar em |
|---|---|---|
| **Senha do banco** (`DATABASE_URL` + `DIRECT_URL`) | Supabase → Settings → Database → **Reset database password** | Vultr (.env: API + Worker) (ambas URLs) |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → roll `service_role` | Vultr (.env: API + Worker) |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (mesma tela; baixa prioridade — é pública por design) | Vercel Web |
| `REDIS_URL` | `REDIS_PASSWORD` no `.env` do Vultr (container Redis) → trocar e reiniciar redis + api + worker | Vultr (.env: API + Worker) |
| `OPENAI_API_KEY` | platform.openai.com/api-keys → revoke + create | Vultr (.env: API + Worker) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | Vultr (.env: API + Worker) |
| `ASAAS_API_KEY` | app.asaas.com → Integrações → API Key | Vultr (.env: API) |
| `RESEND_API_KEY` | resend.com → API Keys | Vultr (.env: API) |
| `WHATSAPP_API_TOKEN` + `WHATSAPP_APP_SECRET` | developers.facebook.com → App → WhatsApp | Vultr (.env: API) |
| **`EVOLUTION_API_KEY`** | servidor Evolution (VPS) → variável `AUTHENTICATION_API_KEY` → reiniciar container | Vultr .env: API (**faça por último; não cole no chat**) |
| `SENTRY_DSN` | sentry.io (baixo risco — só ingest) | opcional |

---

## 🔁 Procedimento por segredo (ordem segura)

Para **cada** segredo, nesta ordem (evita downtime):

1. **Gere/revogue** a nova chave no provedor (Grupo B) ou localmente (Grupo A).
2. **Atualize** o valor em **todos** os serviços da coluna "Atualizar em":
   - **Vultr:** editar o `.env` no servidor e recriar os containers (`docker compose -f /root/docker-compose.zapscript.yml up -d api worker`). O sandbox do Claude Code não tem SSH no servidor — esse passo é manual.
   - **Vercel:** dashboard → projeto → *Settings → Environment Variables* → editar → *Redeploy*.
3. **Aguarde** os containers ficarem `healthy` e o redeploy da Vercel terminar.
4. **Verifique a saúde:**
   ```bash
   curl -s https://api.zapscript.me/health        # espera redis:ok, db:ok
   curl -s -o /dev/null -w "%{http_code}\n" https://www.zapscript.me   # 200
   ```
5. **Revogue/exclua a chave antiga** no provedor (Grupo B) — só depois que o health passar.

> Dica: faça **um segredo por vez** e valide o health entre cada um. Se algo quebrar, você sabe exatamente qual foi.

---

## ✅ Validação final (depois de tudo)

```bash
curl -s https://api.zapscript.me/health
curl -s -o /dev/null -w "admin-noauth:%{http_code}\n" https://api.zapscript.me/sys/g5r8t2/stats   # 401
```
Depois: faça login no painel `/g5r8t2` com o **novo** `ADMIN_TOKEN`, e teste 1 transcrição real ponta a ponta (áudio → texto → cobrança).

---

## 🧹 Opcional (avançado) — limpar o histórico do git
Mesmo após rotacionar, as chaves **antigas** continuam no histórico (já inúteis). Se quiser higienizar de vez:
```bash
# DESTRUTIVO — reescreve histórico, exige force-push e re-clone por todos
pip install git-filter-repo
git filter-repo --path zapscript.env --path zapscriptworker.env --invert-paths
git push --force --all
```
Não obrigatório se todas as chaves já foram rotacionadas (as do histórico ficam mortas).

---

_Gerado em 2026-06-10. Após rotacionar, este arquivo pode ser mantido como runbook._
