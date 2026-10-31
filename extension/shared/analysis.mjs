import { resolverInput, resolverResult, resolverInstructions } from './resolver.mjs';
import { LocalError } from './openai-session.mjs';
export function analysisInput(body) {
  if (!body || body.task !== 'resolver') throw new LocalError('Atualize para o fluxo de catalogação completa.', 400, 'invalid_response');
  return resolverInput(body);
}
export const validateSuggestion = (value, input) => resolverResult(value, input);
const invalid = () => new LocalError('Resposta da IA fora do formato de catalogação.', 422, 'invalid_response');
export async function readSuggestion(response, input, onUsage = () => {}) {
  if (!response.ok) {
    await response.body?.cancel();
    const status = response.status;
    const code = status === 429 ? 'usage_limit' : [401,403].includes(status) ? 'authentication' : status >= 500 ? 'provider_unavailable' : 'invalid_response';
    throw new LocalError('A análise foi recusada pelo provedor (HTTP ' + status + ').', status, code);
  }
  if (!response.body) throw new LocalError('A IA não retornou uma resposta.', 503, 'provider_unavailable');
  let pending = '', output = '', completed = false, total = 0;
  const decoder = new TextDecoder();
  const event = frame => {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let item;
    try { item = JSON.parse(data); } catch { throw invalid(); }
    if (item.type === 'response.output_text.delta') output += typeof item.delta === 'string' ? item.delta : '';
    if (['error','response.failed','response.incomplete'].includes(item.type)) throw new LocalError('A IA não concluiu a resposta.', 503, 'provider_unavailable');
    if (item.type === 'response.completed') {
      if (item.response?.status !== 'completed') throw invalid();
      completed = true;
      onUsage(item.response.usage);
      if (!output) output = (item.response.output ?? []).flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('');
    }
    if (output.length > 24000) throw invalid();
  };
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 2 * 1024 * 1024) throw invalid();
      pending = (pending + decoder.decode(value, { stream: true })).replaceAll('\r\n','\n');
      let index;
      while ((index = pending.indexOf('\n\n')) >= 0) { event(pending.slice(0,index)); pending = pending.slice(index+2); }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  pending += decoder.decode();
  if (pending.trim()) event(pending);
  if (!completed) throw new LocalError('Conexão encerrada antes da conclusão.', 503, 'connection');
  try { return validateSuggestion(JSON.parse(output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')),input); }
  catch { throw invalid(); }
}
export async function analyze(session, body, signal) {
  const input = analysisInput(body), models = await session.models(true);
  if (!models.some(m => m.id === body.model)) throw new LocalError('Modelo indisponível nesta conta.', 400, 'invalid_response');
  const token = await session.token();
  signal?.throwIfAborted();
  const response = await session.fetcher('https://api.openai.com/v1/responses', {
    method:'POST', redirect:'error', credentials:'omit', signal,
    headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' },
    body:JSON.stringify({ model:body.model, store:false, stream:true, instructions:resolverInstructions(input), input:[{role:'user',content:JSON.stringify({...input,instructions:undefined})}] }),
  });
  let tokens = 0;
  const decision = await readSuggestion(response,input,usage => {
    tokens = Number.isSafeInteger(usage?.total_tokens) ? usage.total_tokens : 0;
    session.usage = {requests:(session.usage?.requests ?? 0)+1,totalTokens:(session.usage?.totalTokens ?? 0)+tokens};
  });
  return {decision,metrics:{tokens}};
}
