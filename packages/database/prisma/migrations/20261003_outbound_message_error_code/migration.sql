-- Item 6 do escopo ZapScript × Twilio: código de erro ESTÁVEL no envio.
--
-- `failureReason` guarda a frase crua do provedor (Evolution/Meta) — muda sem
-- aviso e não dá para programar contra. `errorCode` guarda o código do catálogo
-- (apps/api/src/lib/apiErrors.ts), que o integrador consegue comparar e que as
-- métricas agrupam para responder "por que as mensagens estão falhando".

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "errorCode" TEXT;
