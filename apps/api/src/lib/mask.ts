/** Mascara e-mail para exibição/LGPD: "fr***@gmail.com" */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const masked = local.length > 2 ? local.slice(0, 2) + '***' : '***';
  return `${masked}@${domain}`;
}
