import { LocalError } from './shared/openai-session.mjs';
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
