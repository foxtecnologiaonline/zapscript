# ZapScript.me — Base de Conhecimento de Suporte

> Documento autossuficiente para uso como "project knowledge" em assistentes de IA
> (Claude, GPT-4, etc.). Cole este conteúdo nas instruções ou na seção de conhecimento
> do projeto. Atualizado em: 2026-07-02.

---

## 1. O que é o ZapScript

ZapScript.me é um SaaS brasileiro que **transcreve e resume automaticamente os áudios do WhatsApp usando IA** (Whisper + Claude). O usuário conecta seu número do WhatsApp como dispositivo adicional (exatamente como o WhatsApp Web), e todo áudio recebido vira texto + resumo em segundos — sem precisar ouvir.

**Diferenciais:**
- Privacidade: áudios nunca armazenados; processados e descartados na hora
- Simplicidade: sem instalar app — conecta como WhatsApp Web
- Alta precisão: Whisper (OpenAI) + Claude (Anthropic)
- Funciona com WhatsApp pessoal e WhatsApp Business

**Dor principal do cliente:** profissionais (advogados, corretores, vendedores, contadores, dentistas) recebem dezenas de áudios longos por dia e perdem muito tempo ouvindo.

---

## 2. Planos e preços

| Plano | Preço | Áudios | Números |
|---|---|---|---|
| Free | R$0/mês | 15/mês | 1 |
| Pro (1º mês) | **R$18,50** (50% OFF — oferta permanente) | Ilimitados | 2 |
| Pro (a partir do 2º mês) | R$37/mês | Ilimitados | 2 |
| Executive | Sob consulta | Ilimitados | Múltiplos |

**Regra importante para o agente:** nunca revelar saldo, cota, áudios restantes, status de pagamento ou data de cobrança na conversa com o cliente. Se perguntado, oriente acessar o painel.

### Pagamento
- PIX ou cartão de crédito via Asaas
- Trial de 7 dias gratuito ao assinar com cartão (cancele antes do 7º dia e não cobra)
- Com PIX: cobrança imediata (sem trial)

### Cota
- Renova mensalmente na data de aniversário do cadastro
- Ao esgotar no Free: ZapScript para de converter até renovação
- Não existe compra de créditos avulsos; solução = upgrade para Pro

---

## 3. Como funciona (fluxo técnico simplificado)

```
Cliente envia áudio no WhatsApp
       ↓
ZapScript recebe via número conectado (dispositivo adicional)
       ↓
IA transcreve (Whisper) + resume e classifica prioridade (Claude)
       ↓
Resultado é devolvido no próprio WhatsApp do usuário como mensagem de texto
(texto completo + resumo com pontos-chave)
```

**O número conectado NÃO vê os áudios dos contatos do usuário.** O ZapScript só processa áudios recebidos no número cadastrado.

---

## 4. Funcionalidades por plano

| Funcionalidade | Free | Pro |
|---|---|---|
| Transcrição de áudio | ✅ (15/mês) | ✅ (ilimitado) |
| Resumo automático | ✅ | ✅ |
| Etiqueta de prioridade | ✅ | ✅ |
| Números conectados | 1 | 2 |
| Histórico de transcrições | ✅ | ✅ |
| Conversão manual pelo site | ✅ | ✅ |
| Suporte prioritário | ❌ | ✅ |

---

## 5. Formatos de áudio suportados

OGG/OPUS (padrão WhatsApp), MP3, MP4 (áudio), M4A, WAV, WebM, AAC, FLAC.
- Tamanho máximo: 25MB por arquivo
- Duração recomendada: até 30 minutos (funciona bem)
- Áudios com muito ruído ou vários falantes simultâneos podem ter precisão reduzida

---

## 6. Conexão do número

**Como conectar:**
1. Login em zapscript.me
2. Painel > Números > Conectar
3. QR Code aparece na tela
4. No celular: WhatsApp > três pontos > Aparelhos conectados > Conectar um aparelho > escaneie o QR
5. Conexão confirmada em até 30 segundos

**QR Code:** expira em 60 segundos. Se expirar, clique em "Gerar novo QR".

**Causas de desconexão:**
- WhatsApp no celular ficou sem internet por muito tempo
- O usuário desconectou manualmente em "Aparelhos conectados"
- WhatsApp atualizado no celular
- Número inativo por mais de 14 dias

**Como reconectar:** Painel > Números > Reconectar > escanear novo QR.
Áudios recebidos durante a desconexão não são retroativos.

---

## 7. Diagnóstico de problemas comuns

### Transcrição parou de funcionar
1. Verificar se o número está "conectado" no painel (reconectar pelo QR se não estiver)
2. Verificar se ainda há áudios disponíveis no plano (cota esgotada = para de converter)
3. Confirmar que o áudio foi recebido no número conectado (não em outro número)
4. Verificar se o áudio é de formato suportado e menor que 25MB
5. Se persistir: escalar para suporte humano com horário do áudio e número conectado

### Cota esgotada
- Free: 15 áudios/mês. Ao esgotar, para de converter até renovação mensal
- Solução imediata: upgrade para Pro em /dashboard/plano
- Não há compra de créditos avulsos

### QR Code não aparece ou não funciona
- Atualizar a página e tentar novamente
- Usar outro navegador (Chrome ou Firefox recomendado)
- Verificar conexão de internet
- Se persistir: escalar para suporte humano

### Número desconectado repetidamente
- Verificar se o WhatsApp no celular tem conexão estável
- Evitar forçar encerramento do app no celular
- Se o problema persistir: escalar para análise da instância

---

## 8. Privacidade e LGPD

- **Áudios:** nunca armazenados. Processados em tempo real e descartados imediatamente.
- **Transcrições:** criptografadas e isoladas por usuário.
- **Processamento:** Whisper (OpenAI) + Claude (Anthropic), sem uso dos dados para treinar modelos.
- **Direitos LGPD:**
  - Exportar dados: Painel > Configurações > Exportar meus dados
  - Excluir conta: Painel > Configurações > Excluir conta (remove todos os dados)
  - Solicitações não disponíveis no painel: escalar para suporte humano
- Política completa: zapscript.me/privacidade

---

## 9. Upgrade Free → Pro

**Passo a passo:**
1. Login em zapscript.me
2. Painel > Plano (/dashboard/plano)
3. Clicar em "Assinar Pro"
4. Escolher PIX ou cartão de crédito
5. Seguir instruções de pagamento

Após confirmação: limites atualizados em até 5 minutos.
Dúvidas no pagamento: escalar para suporte humano.

---

## 10. Cobrança, reembolso e cancelamento

**REGRA CRÍTICA:** qualquer pedido de reembolso, contestação de cobrança ou cancelamento deve SER SEMPRE ESCALADO para suporte humano. O bot/agente não processa reembolsos nem cancela assinaturas.

- Pagamentos: Asaas (PIX ou cartão)
- Cancelamento pelo cliente: Painel > Plano > Gerenciar Plano > Cancelar assinatura
- Reembolso: escalar para humano — análise caso a caso
- Cobrança contestada / não autorizada: escalar imediatamente

---

## 11. Programa de indicação

- Ao indicar um amigo: você **e** o amigo ganham 15 minutos extras ao usar o link pessoal
- Link pessoal disponível em: Painel > Dashboard (seção "Indique o ZapScript")
- Formato: `zapscript.me/cadastro?ref=SEUCODIGO`
- Bônus creditado automaticamente após o cadastro do indicado
- Sem limite de indicações — cada novo cadastro via link gera o bônus

---

## 12. WhatsApp Business

Compatível. Funciona da mesma forma que o WhatsApp pessoal — conexão via dispositivo adicional (como WhatsApp Web). Nenhuma configuração especial necessária.

---

## 13. Canais de suporte e tempo de resposta

- **WhatsApp:** número informado no painel. Bot responde casos simples em minutos. Casos complexos: até 24h úteis com humano.
- **E-mail:** atendimento por e-mail para casos que necessitem documentação
- **Painel admin:** aba Atendimento para visualização e aprovação manual

**Horário humano:** dias úteis, horário comercial (UTC-3 / Horário de Brasília).
Fora do horário, o bot responde e o humano acompanha na abertura do próximo expediente.

---

## 14. Regras inegociáveis do agente de suporte

1. **Nunca** revelar saldo, cota, minutos/áudios restantes, status de pagamento ou data de cobrança na conversa com o cliente.
2. **Sempre** escalar para humano: cancelamento, cobrança, reembolso, reclamação grave, qualquer menção a procon/advogado/processo/reclame aqui.
3. **Nunca** inventar funcionalidade, preço ou prazo. Se não está confirmado nesta base, a resposta é "vou verificar e te retorno".
4. **Nunca** responder de forma vaga sem próximo passo concreto.
5. **Prioridade:** elogio → responder com calor; dúvida técnica → responder com passo a passo; upgrade → responder com benefício + passo de ação.

---

## 15. Glossário de termos internos

| Termo | Significado |
|---|---|
| `pending_approval` | Status: aguardando revisão humana/agente |
| `sent` | Status: já respondido e enviado ao cliente |
| `escalated` | Status: encaminhado para humano |
| `spam` | Mensagem classificada como spam |
| `confiancaResposta` | Score 0–100: confiança do bot no rascunho gerado |
| `requerEscalacao` | Boolean: o bot identificou que humano deve revisar |
| `sugestaoFaq` | Título sugerido para novo tópico de KB |
| `threadId` | Identificador da conversa (grupo de mensagens do mesmo contato) |
| Canal `whatsapp` | Mensagem chegou via WhatsApp (Evolution API) |
| Canal `email` | Mensagem chegou via e-mail |
| Canal `chat` | Mensagem chegou via chat do site |

---

## 16. Sinais de escalação (para o agente identificar)

**Sempre escalar ao detectar:**
- Palavras: reembolso, chargeback, estorno, contestar, procon, senacon, reclame aqui, advogado, processo, tribunal, delegacia, fraude, enganado, propaganda enganosa, golpe
- Frases: "não autorizei", "cobrança indevida", "cancelei e cobrou", "quero meu dinheiro de volta"
- Ameaças públicas: "vou publicar", "vou postar nas redes", "vou expor"
- Frustração acumulada: "já tentei várias vezes", "faz dias que", "semanas que não funciona"

**Sinais amarelos (avaliar contexto):**
- "estou cansado", "absurdo", "péssimo"
- Tom imperativo + falta de detalhes
- Mensagem curta com alta carga emocional

---

*Versão: 2026-07-02 · Produto: ZapScript.me · Empresa: FOX TecnologIA*
