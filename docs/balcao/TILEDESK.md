# Tiledesk no Balcão Virtual — avaliação e plano de uso inicial

**Autorização:** o responsável pelo projeto autorizou usar a estrutura do Tiledesk (tiledesk.com) *inicialmente*.
**Decisão:** o núcleo do Balcão permanece nativo (já construído e testado); o Tiledesk entra como **console de
atendimento e widget opcionais** nas primeiras demonstrações, sem ser fonte da verdade.

## O que o Tiledesk resolveria rápido
| Necessidade do edital | Tiledesk | Balcão nativo |
|---|---|---|
| Inbox/console do atendente, departamentos, respostas prontas | Sim (dashboard em Angular, pt-BR) | `apps/web/src/app/balcao/atendimento` |
| Widget de chat/popup no site | Sim | `channels/webchat` (widget.js acessível, Shadow DOM) |
| Bots/automação simples | Sim (Design Studio) | `ai/` (base aprovada + LLM ancorado + curadoria) |
| Voz nativa (SIP/URA/gravação) | **Não** | `channels/voice` + Asterisk |
| WhatsApp oficial com cotas por categoria (itens 7–9) | Parcial (integração Meta) | `channels/whatsapp` |
| Tarefas internas / service desk / ISA | **Não** | `tasks/` |
| e-Proc, GOV.BR (ouro), IdP do TJTO | **Não** | `integrations/` |
| Painel do fiscal, cotas, IQA, relatórios | Analytics básico | `reports/` |
| LGPD (DSR, retenção, exportação final), criptografia de conteúdo | **Não** | `security/` + core |

## Riscos que impedem torná-lo a base única
- **Licença/open-core:** parte dos recursos e imagens Docker é enterprise; white label/branding e domínio próprio são
  candidatos a enterprise-only (ver `Attende-ZapBot/ESCOPO.md` §2). Verificar `LICENSE` de cada repositório antes de distribuir.
- **Nunca validado:** a ponte Tiledesk ↔ conector do Attende-ZapBot não foi testada contra um Tiledesk real
  (`Attende-ZapBot/infra/tiledesk/README.md`); endpoints de subscription/autenticação precisam ser confirmados na instância.
- **Estado duplicado:** com o Tiledesk como inbox, haveria duas fontes de verdade para conversa, atribuição e SLA
  (o ACD, os relatórios e o painel do fiscal leem do banco do Balcão).
- **PoC eliminatória:** voz, tarefas, e-Proc/GOV.BR e curadoria precisam estar na MESMA interface do atendente/supervisor.

## Como usar o Tiledesk agora (sem mexer no núcleo)
1. Subir o Tiledesk com o compose do Attende-ZapBot (`docker-compose.yml`) e criar um Projeto (porta 8081 do dashboard).
2. **Widget:** instalar o snippet do Tiledesk no site de demonstração se for preciso mostrar o chat antes do console nativo
   ficar pronto; depois trocar pelo `widget.js` do Balcão (mesmo local de instalação).
3. **Console:** agentes podem usar o dashboard do Tiledesk apenas para o canal que for roteado a ele via ponte (abaixo).

## Ponte opcional (desenho, não implementada)
Um canal `TILEDESK` do Balcão: (a) webhook do Tiledesk (mensagem do visitante) → `ingestInbound` com `channelRef = request_id`;
(b) `registerChannelSender('TILEDESK', …)` envia a resposta do atendente/bot via API do Tiledesk (`/{project}/requests/{id}/messages`);
(c) o ACD e os relatórios continuam no Balcão; o Tiledesk atua só como interface do cidadão e/ou do atendente.
Reaproveitar `Attende-ZapBot/services/whatsapp-connector/src/bridge/tiledesk.ts` como referência. **Só implementar após validar a
API contra uma instância real** e confirmar a licença dos módulos usados.
