import { LocalError } from './shared/openai-session.mjs';
const safeDetails = new Set([
  'A resposta da IA não contém JSON válido.', 'Decisão estruturada inválida.',
  'Identidade fora da política.', 'Atributo fora da política.', 'Nome de produto inválido.',
  'Política de tipo fora do formato.', 'Atributo da nova política inválido.',
  'A política precisa de atributos distintos e uma identidade.', 'Tipo fora das políticas oferecidas.',
  'Árvore inválida.', 'Categoria fora dos candidatos.', 'A IA precisa escolher ou criar uma categoria.',
  'Produto fora dos candidatos.', 'Modelo indisponível nesta conta.',
]);
export function analysisDetail(error: unknown): string {
  if (!(error instanceof LocalError)) return '';
  if (safeDetails.has(error.message)) return error.message;
  return error.status >= 400 && error.status <= 599 ? 'HTTP ' + error.status : '';
}
// Fixed diagnostics only: never forward provider bodies, tokens or raw exception messages.
export function analysisFailure(error: unknown) {
  const code = error instanceof LocalError ? error.code : '';
  const labels: Record<string, string> = {
    authentication: 'Sessão da IA indisponível', usage_limit: 'Limite da IA atingido',
    provider_unavailable: 'Provedor de IA indisponível', invalid_response: 'Resposta da IA não utilizável',
    timeout: 'Tempo da IA esgotado', connection: 'Conexão com a IA interrompida', unknown: 'Análise da IA indisponível',
  };
  if (error instanceof LocalError && ([401,403].includes(error.status) || code === 'invalid_grant'))
    return { code: 'authentication', label: labels.authentication };
  if (typeof code === 'string' && Object.hasOwn(labels, code)) return { code, label: labels[code] };
  if (error instanceof DOMException && error.name === 'TimeoutError') return { code: 'timeout', label: labels.timeout };
  return { code: 'unknown', label: labels.unknown };
}
