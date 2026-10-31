import { resolverInput, resolverResult, resolverInstructions } from './resolver.mjs';
import { LocalError } from './openai-session.mjs';
export function analysisInput(body) {
  if (body?.task !== 'resolver') throw new LocalError('Atualize para o fluxo de catalogação completa.', 400, 'invalid_response');
  return resolverInput(body);
}
export const validateSuggestion = (value, input) => resolverResult(value, input);
const invalid = () => new LocalError('Resposta da IA fora do formato de catalogação.', 422, 'invalid_response');
async function checkResponse(response) {
  if (response.ok && response.body) return;
  await response.body?.cancel();
  const status = response.status;
  let code = 'invalid_response';
  if (status === 429) code = 'usage_limit';
  else if ([401,403].includes(status)) code = 'authentication';
  else if (status >= 500 || !response.body) code = 'provider_unavailable';
  throw new LocalError('A análise foi recusada ou não retornou conteúdo (HTTP ' + status + ').', status, code);
}
function parseFrame(frame) {
  const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  if (!data || data === '[DONE]') return null;
  try {
    const item = JSON.parse(data);
    if (!item || typeof item !== 'object') throw invalid();
    return item;
  } catch { throw invalid(); }
}
function applyFrame(frame, state, onUsage) {
  const item = parseFrame(frame);
  if (!item) return false;
  if (item.type === 'response.output_text.delta' && typeof item.delta === 'string') state.output += item.delta;
  if (['error','response.failed','response.incomplete'].includes(item.type)) throw new LocalError('A IA não concluiu a resposta.', 503, 'provider_unavailable');
  if (item.type === 'response.completed') {
    if (item.response?.status !== 'completed') throw invalid();
    state.completed = true;
    onUsage(item.response.usage);
    if (!state.output) state.output = (item.response.output ?? []).flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('');
  }
  if (state.output.length > 24000) throw invalid();
  return state.completed;
}
async function readFrames(response, consume) {
  let pending = '', total = 0;
  const decoder = new TextDecoder(), reader = response.body.getReader();
  try {
    while (true) {
      const {value,done} = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 2 * 1024 * 1024) throw invalid();
      pending = (pending + decoder.decode(value, {stream:true})).replaceAll('\r\n','\n');
      let index;
      while ((index = pending.indexOf('\n\n')) >= 0) {
        if (consume(pending.slice(0,index))) return;
        pending = pending.slice(index+2);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function readSuggestion(response, input, onUsage = () => {}) {
  await checkResponse(response);
  const state = {output:'',completed:false};
  await readFrames(response, frame => applyFrame(frame,state,onUsage));
  if (!state.completed) throw new LocalError('Conexão encerrada antes da conclusão.', 503, 'connection');
  try { return validateSuggestion(parseOutput(state.output),input); }
  catch { throw invalid(); }
}
function parseOutput(output) {
  let text = output.trim();
  if (text.startsWith('```')) {
    text = text.slice(3).trimStart();
    if (text.slice(0,4).toLowerCase() === 'json') text = text.slice(4).trimStart();
    if (!text.endsWith('```')) throw invalid();
    text = text.slice(0,-3).trimEnd();
  }
  return JSON.parse(text);
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
