/** Mascara e-mail para exibição/LGPD: "fr***@gmail.com" */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const masked = local.length > 2 ? local.slice(0, 2) + '***' : '***';
  return `${masked}@${domain}`;
}

/** Mascara telefone mantendo só os 4 últimos dígitos: "*******0254" */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return phone ?? null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** Trunca texto sensível (ex: transcrição completa), indicando quanto foi ocultado. */
export function maskText(text: string | null | undefined, visibleChars = 40): string | null {
  if (!text) return text ?? null;
  if (text.length <= visibleChars) return text;
  return `${text.slice(0, visibleChars)}… [oculto — ${text.length - visibleChars} caracteres, use ?reveal=true]`;
}
