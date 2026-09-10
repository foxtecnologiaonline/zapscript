-- Consentimento amarrado à lista salva (item 9 do redesenho de Campanhas):
-- confirmado uma vez ao criar/editar a lista, propagado pra Campanha.consentConfirmedAt
-- quando a lista é aplicada via from-lista — evita reconfirmar em toda campanha.

ALTER TABLE "CampanhaLista" ADD COLUMN "consentConfirmedAt" TIMESTAMP(3);
