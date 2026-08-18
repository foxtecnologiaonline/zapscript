# API + Worker no Render (+ Redis no Upstash)

Alternativa ao `deploy/oci-backend/` — use este caminho se o login na Oracle Cloud não
estiver funcionando. Blueprint pronto em `render.yaml` (raiz do repo).

**Custo:** API grátis (com ressalva de "dormir" — ver abaixo) + Worker Starter $7/mês
(Render não tem plano grátis pra Background Worker) = **~$7/mês**, 84% mais barato que os
$45/mês da Vultr. Redis é o Upstash free tier (já criado na Parte 0 do `deploy/oci-backend/`
— se ainda não tiver, crie em [upstash.com](https://upstash.com) antes de continuar).

Sem Evolution API aqui também — caminho 100% oficial (Meta Cloud API), igual ao plano da OCI.

---

## Parte 1 — Criar o Blueprint

1. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**.
2. Conectar o repositório GitHub `foxtecnologiaonline/zapscript`, branch `master` (ou a que
   estiver usando).
3. O Render lê o `render.yaml` da raiz e propõe **2 serviços**: `zapscript-api` (Free) e
   `zapscript-worker` (Starter, $7/mês). Confirmar.
4. Antes de criar, o Render pede pra preencher as variáveis marcadas `sync: false` em cada
   serviço — ver a lista comentada dentro do `render.yaml`. Os valores são os mesmos que
   você já preencheria no `.env` de qualquer outro deploy (DATABASE_URL, ENCRYPTION_KEY,
   REDIS_URL do Upstash, etc.) — pode copiar do `.env.example` da raiz como referência.
5. **Deploy**. Acompanhe os logs de build de cada serviço no dashboard.

## Parte 2 — Domínio

Por padrão o Render dá uma URL tipo `zapscript-api.onrender.com`. Pra manter
`api.zapscript.me` (e não precisar mexer em mais nada na Vercel/Asaas/Meta):

1. No serviço `zapscript-api` → **Settings → Custom Domain → Add Custom Domain** →
   `api.zapscript.me`.
2. O Render mostra o valor exato de CNAME a configurar.
3. No provedor de DNS do domínio `zapscript.me`: **trocar o registro de `api` de tipo A
   (apontava pro IP da Vultr) para tipo CNAME**, com o valor que o Render mostrou.
4. Aguardar propagação + emissão automática do certificado SSL (o Render cuida disso).

## Parte 3 — Manter a API grátis sempre acordada

O plano Free do Render **dorme após 15 minutos sem tráfego** — a primeira requisição depois
disso demora ~30-50s, o que pode fazer a Meta dar timeout no webhook. Configure um ping
externo gratuito:

1. [uptimerobot.com](https://uptimerobot.com) (ou [cron-job.org](https://cron-job.org)) →
   criar um monitor **HTTP(s)** apontando pra `https://api.zapscript.me/health`, intervalo de
   **5 ou 10 minutos**.
2. Isso mantém a API sempre respondendo — sem esse passo, o plano Free não é confiável pra
   receber mensagens de clientes reais a qualquer hora.

> Se no futuro o volume justificar, dá pra trocar o plano da API de Free pra Starter
> ($7/mês) e eliminar essa dependência do ping externo — mas por ora resolve.

## Verificação

```bash
curl https://api.zapscript.me/health
# Deve responder {"status":"ok",...}
```

## Rollback / comparação

Não precisa mexer na Vercel — `NEXT_PUBLIC_API_URL` já aponta pra `api.zapscript.me`, só o
DNS por trás mudou de A (Vultr) pra CNAME (Render). Se quiser voltar pra Vultr ou migrar pra
OCI depois, o processo é o mesmo: trocar o DNS de novo, nada fica preso no Render.

| | Vultr | OCI + Upstash (`deploy/oci-backend/`) | Render + Upstash (aqui) |
|---|---|---|---|
| Evolution API | Sim | Não | Não |
| Custo | ~$45/mês | **$0** | **~$7/mês** |
| Confiabilidade | Alta (VM dedicada) | Alta, mas depende de conseguir provisionar a VM | Depende do ping externo pra API não dormir |
| Complexidade de setup | Manual, SSH | Manual, SSH + Docker | Mais simples — Blueprint faz o build/deploy |
