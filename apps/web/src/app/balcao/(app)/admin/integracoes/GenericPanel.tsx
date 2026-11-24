'use client';
import React from 'react';
import Link from 'next/link';
import { API_ORIGIN, bv } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime } from '@/lib/balcao/format';
import { Banner, Card, Spinner, Tabs } from '../../../_ui/ui';
import { ConfigForm, type FieldDef, type FormApi, type Section } from './ConfigForm';
import { CopyField, LogsPanel, StatusBadge, TestButton, useIntegration, type IntegrationSummary } from './_shared';

const T = (key: string, label: string, hint?: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: 'text', hint, ...extra });
const U = (key: string, label: string, hint?: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: 'url', hint, ...extra });
const N = (key: string, label: string, def: number, min: number, max: number, hint?: string): FieldDef => ({ key, label, kind: 'number', def, min, max, hint });
const S = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: 'secret', ...extra });
const TIMEOUT = N('timeoutMs', 'Tempo limite das chamadas (ms)', 10000, 500, 60000, 'Entre 500 e 60.000 ms.');

export const EPROC_SECTIONS: Section[] = [
  {
    title: 'Conexão com o e-Proc (MNI)', fields: [
      { key: 'mode', label: 'Modo de integração', kind: 'select', required: true, def: 'soap', hint: 'SOAP: Modelo Nacional de Interoperabilidade (padrão dos tribunais). REST: contrato genérico por token.', options: [{ value: 'soap', label: 'SOAP (MNI)' }, { value: 'rest', label: 'REST' }] },
      U('endpoint', 'Endpoint do serviço', 'URL do serviço do e-Proc/MNI do tribunal.', { required: true }),
      U('wsdlUrl', 'URL do WSDL (opcional)', undefined, { showIf: (v) => v.mode === 'soap' }),
      T('idConsultante', 'Identificador do consultante', 'Usuário/sistema autorizado a consultar.', { required: true, showIf: (v) => v.mode === 'soap' }),
      S('senhaConsultante', 'Senha do consultante', { required: true, showIf: (v) => v.mode === 'soap' }),
      S('token', 'Token de acesso', { required: true, showIf: (v) => v.mode === 'rest' }),
    ],
  },
  {
    title: 'Privacidade e limites', fields: [
      { key: 'maskPartyNames', label: 'Mascarar nomes das partes nas respostas do assistente', kind: 'checkbox', def: true, hint: 'Recomendado (LGPD). Partes só aparecem para quem comprovar vínculo com o processo.' },
      N('maxMovimentos', 'Máximo de movimentos exibidos', 10, 1, 50),
      TIMEOUT, N('retries', 'Novas tentativas em caso de falha', 1, 0, 3), N('retryDelayMs', 'Intervalo entre tentativas (ms)', 300, 0, 5000),
    ],
  },
  {
    title: 'Avançado (namespaces SOAP e tabelas TPU)', advanced: true, description: 'Altere somente se o tribunal usar versão diferente do MNI 2.2.2.', fields: [
      T('wsdlNamespace', 'Namespace do serviço', undefined, { def: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/', showIf: (v) => v.mode === 'soap' }),
      T('tiposNamespace', 'Namespace dos tipos', undefined, { def: 'http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2', showIf: (v) => v.mode === 'soap' }),
      T('soapAction', 'SOAPAction', undefined, { showIf: (v) => v.mode === 'soap' }),
      N('maxResponseBytes', 'Tamanho máximo da resposta (bytes)', 2097152, 1024, 20971520),
      { key: 'tpu.classes', label: 'Tabela TPU — classes', kind: 'map', hint: 'Uma por linha: código = descrição.', rows: 3 },
      { key: 'tpu.assuntos', label: 'Tabela TPU — assuntos', kind: 'map', hint: 'Uma por linha: código = descrição.', rows: 3 },
      { key: 'tpu.movimentos', label: 'Tabela TPU — movimentos', kind: 'map', hint: 'Uma por linha: código = descrição.', rows: 3 },
    ],
  },
];

const OIDC_COMMON = (ctx: 'govbr' | 'oidc'): FieldDef[] => [
  T('clientId', 'Client ID', undefined, { required: true }),
  S('clientSecret', 'Client secret', { required: true }),
  U('redirectUri', 'URL de retorno (redirect URI)', 'Deve ser idêntica à cadastrada no provedor. Use o botão acima para preencher com a URL padrão.', { required: true }),
  T('issuer', 'Emissor (issuer)', ctx === 'govbr' ? 'Ex.: https://sso.staging.acesso.gov.br/ (homologação) ou https://sso.acesso.gov.br/ (produção).' : 'Valor do campo "iss" dos tokens do IdP.', { required: true }),
  U('authorizeUrl', 'URL de autorização', undefined, { required: true }),
  U('tokenUrl', 'URL do token', undefined, { required: true }),
  U('jwksUri', 'URL das chaves públicas (JWKS)', undefined, { required: true }),
  U('userinfoUrl', 'URL de userinfo (opcional)'),
];

export const GOVBR_SECTIONS: Section[] = [
  { title: 'Aplicação cadastrada no GOV.BR', fields: OIDC_COMMON('govbr') },
  {
    title: 'Nível de confiabilidade', fields: [
      { key: 'requiredLevel', label: 'Nível exigido para consultas processuais', kind: 'select', required: true, def: 'ouro', hint: 'Abaixo desse nível o assistente não exibe dados de processo.', options: [{ value: 'bronze', label: 'Bronze' }, { value: 'prata', label: 'Prata' }, { value: 'ouro', label: 'Ouro (recomendado)' }] },
      T('confiabilidadesUrl', 'URL da API de confiabilidades', 'Aceita {cpf} no lugar do CPF. Sem ela, o nível assumido é bronze (falha fechada).'),
      { key: 'scopes', label: 'Escopos', kind: 'list', def: ['openid', 'email', 'phone', 'profile', 'govbr_confiabilidades'], hint: 'Um por linha.', rows: 5 },
      { key: 'tokenAuthMethod', label: 'Autenticação no endpoint de token', kind: 'select', def: 'basic', options: [{ value: 'basic', label: 'HTTP Basic (padrão)' }, { value: 'post', label: 'Credenciais no corpo (POST)' }] },
      TIMEOUT,
    ],
  },
];

export const OIDC_SECTIONS: Section[] = [
  { title: 'Cliente OpenID Connect no IdP do TJTO', fields: OIDC_COMMON('oidc') },
  {
    title: 'Login da equipe', fields: [
      U('frontendRedirect', 'Página do console que recebe o login', 'Recebe ?code=… (ou ?error=…) e troca por sessão. Padrão: /balcao/login/oidc neste site.', { required: true }),
      { key: 'scopes', label: 'Escopos', kind: 'list', def: ['openid', 'email', 'profile'], hint: 'Um por linha.', rows: 4 },
      { key: 'tokenAuthMethod', label: 'Autenticação no endpoint de token', kind: 'select', def: 'basic', options: [{ value: 'basic', label: 'HTTP Basic (padrão)' }, { value: 'post', label: 'Credenciais no corpo (POST)' }] },
      T('emailClaim', 'Claim do e-mail', undefined, { def: 'email' }), T('nameClaim', 'Claim do nome', undefined, { def: 'name' }),
      { key: 'allowedEmailDomains', label: 'Domínios de e-mail permitidos', kind: 'list', hint: 'Um por linha (ex.: tjto.jus.br). Vazio = qualquer domínio.', rows: 3 },
      { key: 'requireAmr', label: 'Exigir MFA no IdP (valores aceitos em "amr")', kind: 'list', hint: 'Um por linha (ex.: mfa, otp). Vazio = não exige.', rows: 3 },
      TIMEOUT,
    ],
  },
  {
    title: 'Perfis e provisionamento', description: 'O perfil Administrador só pode ser concedido pelo mapeamento explícito de grupos.', fields: [
      { key: 'autoProvision', label: 'Criar usuário automaticamente no primeiro login', kind: 'checkbox', def: false, hint: 'Desligado, só entra quem já tem cadastro (mesmo e-mail).' },
      { key: 'defaultRole', label: 'Perfil padrão de quem é criado automaticamente', kind: 'select', required: true, def: 'ATENDENTE', options: [{ value: 'ATENDENTE', label: 'Atendente' }, { value: 'SUPERVISOR', label: 'Supervisor' }, { value: 'FISCAL', label: 'Fiscal do contrato' }] },
      T('roleClaim', 'Claim com os grupos do usuário', undefined, { def: 'groups' }),
      { key: 'roleMapping', label: 'Mapeamento de grupos para perfis', kind: 'map', mapValues: ['ATENDENTE', 'SUPERVISOR', 'ADMIN', 'FISCAL'], rows: 5, placeholder: 'grupo-atendimento = ATENDENTE\ngrupo-gestores = SUPERVISOR',
        hint: 'Uma linha por grupo: nome-do-grupo = PERFIL. Perfis: ATENDENTE, SUPERVISOR, ADMIN, FISCAL.' },
    ],
  },
];

export const GOOGLE_SECTIONS: Section[] = [
  {
    title: 'Conta de serviço (delegação em todo o domínio)', description: 'Usada para criar eventos com Google Meet na Agenda e enviar e-mail pelo Gmail em nome do usuário delegado.', fields: [
      { key: 'serviceAccountJson', label: 'Chave JSON da conta de serviço', kind: 'secretarea', required: true, fileJson: true, minLen: 20, hint: 'Cole o conteúdo do arquivo .json ou carregue o arquivo. Só é gravado cifrado e nunca é exibido novamente.' },
      T('delegatedUser', 'Usuário delegado (e-mail)', 'Conta do Workspace em nome da qual a Agenda/Gmail serão usados.', { required: true, email: true }),
      T('calendarId', 'Agenda', undefined, { def: 'primary' }), T('timeZone', 'Fuso horário', undefined, { def: 'America/Araguaina' }),
    ],
  },
  { title: 'Avançado', advanced: true, fields: [U('calendarBaseUrl', 'URL base da Agenda', undefined, { def: 'https://www.googleapis.com' }), U('gmailBaseUrl', 'URL base do Gmail', undefined, { def: 'https://gmail.googleapis.com' }), TIMEOUT] },
];

export const JIRA_SECTIONS: Section[] = [
  {
    title: 'Conexão com o Jira', fields: [
      U('baseUrl', 'URL do Jira', 'Ex.: https://tribunal.atlassian.net', { required: true }),
      T('email', 'E-mail (ou usuário) da conta de API', undefined, { required: true }),
      S('apiToken', 'Token de API', { required: true }),
      T('projectKey', 'Chave do projeto', 'Letras maiúsculas e números (ex.: BALCAO).', { required: true, pattern: /^[A-Z][A-Z0-9_]{1,19}$/, patternMsg: 'Use de 2 a 20 caracteres: letras maiúsculas, números ou _, começando por letra.' }),
      { key: 'apiVersion', label: 'Versão da API', kind: 'select', required: true, def: '3', options: [{ value: '3', label: 'Jira Cloud (v3)' }, { value: '2', label: 'Jira Server/Data Center (v2)' }] },
      S('webhookSecret', 'Segredo do webhook', { minLen: 8, hint: 'Mínimo de 8 caracteres. Cadastre o mesmo valor no webhook do Jira.' }),
      TIMEOUT,
    ],
  },
  {
    title: 'Sincronização e mapeamentos', fields: [
      { key: 'syncKinds', label: 'Tipos de tarefa enviados automaticamente ao Jira', kind: 'multicheck', def: ['SERVICE_REQUEST'], options: [{ value: 'SERVICE_REQUEST', label: 'Solicitação de serviço' }, { value: 'DEMAND', label: 'Demanda' }, { value: 'INTERNAL', label: 'Tarefa interna' }] },
      { key: 'issueTypeMap', label: 'Tipo de tarefa → tipo de issue', kind: 'map', rows: 4, def: { SERVICE_REQUEST: 'Task', DEMAND: 'Task', INTERNAL: 'Task' }, hint: 'Uma por linha: SERVICE_REQUEST = Task.' },
      { key: 'priorityMap', label: 'Prioridade → prioridade do Jira', kind: 'map', rows: 5, def: { LOW: 'Low', NORMAL: 'Medium', HIGH: 'High', URGENT: 'Highest' }, hint: 'Uma por linha: URGENT = Highest.' },
      { key: 'statusMap', label: 'Status do Jira → status da tarefa', kind: 'map', rows: 6, mapValues: ['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED'],
        def: { 'to do': 'OPEN', 'in progress': 'IN_PROGRESS', waiting: 'WAITING', blocked: 'WAITING', done: 'DONE', cancelled: 'CANCELLED' }, hint: 'Uma por linha: nome do status em minúsculas = OPEN, IN_PROGRESS, WAITING, DONE ou CANCELLED.' },
    ],
  },
];

const META: Record<string, { name: string; desc: string }> = {
  EPROC: { name: 'e-Proc (consulta processual)', desc: 'Consulta de processos pelo MNI do e-Proc, usada pelo assistente e pelos atendentes.' },
  GOVBR: { name: 'GOV.BR (identidade do cidadão)', desc: 'Login do cidadão com nível de confiabilidade (bronze, prata, ouro) para liberar consultas processuais.' },
  OIDC_TJTO: { name: 'IdP do TJTO (login da equipe)', desc: 'Login único (OpenID Connect) da equipe com o provedor de identidade do tribunal.' },
  GOOGLE_WORKSPACE: { name: 'Google Workspace', desc: 'Agenda com Google Meet e envio de e-mail pelo Gmail.' },
  JIRA: { name: 'Jira', desc: 'Envio de tarefas ao Jira e retorno de status por webhook.' },
};
export const GENERIC_TYPES = Object.keys(META);

/** Painel das integrações gerenciadas por /balcao/integrations/:type. */
export function GenericPanel({ type, summary, onChanged }: { type: string; summary?: IntegrationSummary; onChanged: () => void }) {
  const { me } = useBvSession();
  const { data, error, loading, reload } = useIntegration(type);
  const slug = me?.user.orgSlug ?? 'slug-do-orgao';
  const m = META[type];
  const sections = type === 'EPROC' ? EPROC_SECTIONS : type === 'GOVBR' ? GOVBR_SECTIONS : type === 'OIDC_TJTO' ? OIDC_SECTIONS : type === 'GOOGLE_WORKSPACE' ? GOOGLE_SECTIONS : JIRA_SECTIONS;

  const preface = (api: FormApi): React.ReactNode => {
    if (type === 'GOVBR') {
      const cb = `${API_ORIGIN}/balcao/integrations/govbr/callback`;
      return (
        <Card title="URL de retorno (callback) para cadastrar no GOV.BR">
          <CopyField label="URL de retorno do GOV.BR" value={cb} hint="Cadastre exatamente esta URL como redirect URI do cliente no GOV.BR e use a mesma no campo abaixo." />
          <button type="button" className="mt-2 text-sm underline" onClick={() => api.set('redirectUri', cb)}>Usar esta URL no campo “URL de retorno”</button>
        </Card>
      );
    }
    if (type === 'OIDC_TJTO') {
      const cb = `${API_ORIGIN}/balcao/integrations/oidc/callback`;
      const fr = typeof window !== 'undefined' ? `${window.location.origin}/balcao/login/oidc` : '';
      return (
        <Card title="URLs para cadastrar no IdP e para a equipe">
          <div className="flex flex-col gap-3">
            <CopyField label="URL de retorno (callback) do IdP" value={cb} hint="Cadastre como redirect URI do cliente no IdP do TJTO." />
            <button type="button" className="self-start text-sm underline" onClick={() => api.set('redirectUri', cb)}>Usar esta URL no campo “URL de retorno”</button>
            <button type="button" className="self-start text-sm underline" onClick={() => api.set('frontendRedirect', fr)}>Usar {fr} como página que recebe o login</button>
            <CopyField label="Link de login da equipe pelo IdP" value={`${API_ORIGIN}/balcao/integrations/oidc/login?org=${slug}`} hint="Inicia o login pelo IdP do TJTO para este órgão." />
            <Banner tone="warning" title="Atenção">A página /balcao/login/oidc (que troca o código por sessão) e o botão de entrada pelo IdP dependem da tela de login do console.</Banner>
          </div>
        </Card>
      );
    }
    if (type === 'JIRA') {
      return (
        <Card title="Webhook de status (Jira → Balcão)">
          <CopyField label="URL do webhook" value={`${API_ORIGIN}/balcao/integrations/jira/webhook?org=${slug}`} hint="Cadastre no webhook do projeto. Informe o segredo no campo do Jira (Cloud) ou acrescente &secret=… na URL." />
        </Card>
      );
    }
    return null;
  };

  if (loading) return <div className="p-6 text-center"><Spinner /></div>;
  if (error || !data) return <Banner tone="danger" title="Indisponível">{error ?? 'Não foi possível carregar a configuração.'}</Banner>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge s={summary ?? { configured: data.configured, enabled: data.enabled, status: data.status }} />
        {summary?.lastCheckAt && <span className="text-sm text-bv-muted">Última verificação: {fmtDateTime(summary.lastCheckAt)}</span>}
      </div>
      {summary?.lastError && <Banner tone="danger" title="Último erro">{summary.lastError}</Banner>}
      <p className="text-sm text-bv-muted">{m.desc}</p>
      <Tabs label={`Integração ${m.name}`} tabs={[
        {
          id: `${type}-cfg`, title: 'Configuração', content: (
            <div className="flex flex-col gap-4">
              <ConfigForm type={type} sections={sections} config={data.config} configured={data.configured} enabled={data.enabled} preface={preface}
                onSaved={async () => { await reload(); onChanged(); }} />
              <Card title="Testar conexão">
                <p className="mb-2 text-sm text-bv-muted">{data.configured ? 'Testa a configuração salva (salve antes de testar).' : 'Salve a configuração antes de testar.'}</p>
                <TestButton disabled={!data.configured} onDone={onChanged}
                  run={async () => { const r = await bv.post<{ ok: boolean; message: string }>(`/integrations/${type}/test`); return { ok: r.ok, message: r.message }; }} />
              </Card>
            </div>
          ),
        },
        { id: `${type}-logs`, title: 'Registros de chamadas', content: <LogsPanel type={type} /> },
      ]} />
    </div>
  );
}

export const genericName = (type: string) => META[type]?.name ?? type;
export const genericDesc = (type: string) => META[type]?.desc ?? '';
// Link auxiliar usado por outras telas
export const LinkToOrg = () => <Link className="underline" href="/balcao/admin/orgao">Configurações do órgão</Link>;
