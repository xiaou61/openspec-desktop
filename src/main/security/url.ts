export function assertAllowedExternalUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error('仅允许 HTTPS 外部链接');
  if (parsed.username || parsed.password) throw new Error('外部链接不能包含凭据');
  return parsed.toString();
}
