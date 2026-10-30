import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewAiWorkflow } from '../dist/review-ai-workflow.js';
import {
  analyze,
  analysisInput,
  validateSuggestion,
} from '../extension/shared/analysis.mjs';
const context = {
  stage: 'identity',
  policy: { id: 'phone', attributes: [{ key: 'model' }] },
  offer: { title: 'Phone X' },
  prompt: 'Instrução de teste',
  enabled: true,
};
function fixture({
  mode = 'active',
  deterministic = false,
  fail = false,
} = {}) {
  const sent = [];
  let done = 0,
    calls = 0,
    attempt = 0;
  const transport = async (op, p) => {
    sent.push({ op, p });
    if (op === 'config')
      return {
        resolver: { mode },
        settings: { productEnabled: true, categoryEnabled: true },
      };
    if (op === 'prepare') return { nextCursor: null };
    if (op === 'resolverStart') return { id: 'run', mode, status: 'running' };
    if (op === 'resolverClaim')
      return {
        run: {
          status: done === 2 ? 'completed' : 'running',
          stats: { total: 2, accepted: done, excluded: 0, failed: 0 },
        },
        item:
          done === 2
            ? null
            : {
                id: 'item' + done,
                leaseId: 'lease',
                context,
                deterministic: deterministic
                  ? { policyId: 'phone', facts: {}, exclude: false, reason: '' }
                  : null,
              },
      };
    if (op === 'resolverComplete') {
      if (p.error) {
        attempt++;
        if (attempt >= 2) done++;
      } else done++;
      return { outcome: p.error ? 'retry' : 'drafted' };
    }
    return {};
  };
  return {
    sent,
    transport,
    analyze: async (input) => {
      calls++;
      if (fail && attempt === 0) throw Error('temporary');
      return {
        decision: { policyId: 'phone', facts: {}, exclude: false, reason: '' },
        metrics: { tokens: 12 },
      };
    },
    calls: () => calls,
  };
}
test('resolvedor não baixa inventário global: uma chamada por link, métricas e progresso de links', async () => {
  const f = fixture(),
    flow = new ReviewAiWorkflow(f.transport, f.analyze);
  await flow.run('product', 'shop', 100, 'small-model');
  assert.equal(flow.progress.completed, 2);
  assert.equal(flow.progress.total, 2);
  assert.equal(f.calls(), 2);
  assert.ok(
    !f.sent.some((s) =>
      ['inventory', 'queue', 'context', 'result'].includes(s.op),
    ),
  );
  assert.ok(
    f.sent
      .filter((s) => s.op === 'resolverComplete')
      .every((s) => s.p.tokens === 12),
  );
  assert.equal(flow.progress.status, 'completed');
});
test('identidade determinística dispensa IA e modelo; modo simulação fica explícito', async () => {
  const f = fixture({ mode: 'shadow', deterministic: true }),
    flow = new ReviewAiWorkflow(f.transport, f.analyze);
  await flow.run('product', 'shop', 2, '');
  assert.equal(f.calls(), 0);
  assert.match(flow.progress.title, /Simulação/);
  assert.equal(flow.progress.completed, 2);
});
test('falha isolada é devolvida à reserva para repetição técnica, sem interromper os demais links', async () => {
  const f = fixture({ fail: true }),
    flow = new ReviewAiWorkflow(f.transport, f.analyze);
  await flow.run('product', 'shop', 2, 'model');
  assert.equal(flow.progress.completed, 2);
  assert.ok(
    f.sent.some(
      (s) => s.op === 'resolverComplete' && s.p.error === 'technical',
    ),
  );
});
test('cancelamento pausa execução persistente e não salva resposta atrasada', async () => {
  const f = fixture();
  let flow;
  flow = new ReviewAiWorkflow(f.transport, async () => {
    flow.cancel();
    return { decision: {} };
  });
  await assert.rejects(
    () => flow.run('product', 'shop', 2, 'model'),
    /cancelada/,
  );
  assert.ok(
    f.sent.some((s) => s.op === 'resolverAction' && s.p.action === 'pause'),
  );
  assert.equal(f.sent.filter((s) => s.op === 'resolverComplete').length, 0);
});
test('contrato curto de IA não aceita tipos/candidatos inventados, dados excessivos ou respostas de revisão', async () => {
  const input = analysisInput({ task: 'resolver', context });
  assert.throws(() => validateSuggestion({ action: 'needs_review' }, input));
  assert.throws(() =>
    validateSuggestion(
      { policyId: 'other', facts: {}, exclude: false, reason: '' },
      input,
    ),
  );
  assert.throws(() =>
    analysisInput({
      task: 'resolver',
      context: { ...context, prompt: 'a'.repeat(50000) },
    }),
  );
  const value = {
    policyId: 'phone',
    facts: { model: { value: 'X', evidence: 'Phone X' } },
    exclude: false,
    reason: '',
  };
  assert.deepEqual(validateSuggestion(value, input), value);
  const category = analysisInput({
    task: 'resolver',
    context: {
      stage: 'category',
      offer: { title: 'X' },
      categories: [{ id: 'allowed', path: ['Phones'] }],
    },
  });
  assert.throws(() =>
    validateSuggestion(
      { categoryId: 'other', path: [], exclude: false, reason: '' },
      category,
    ),
  );
});
test('IA recebe política, evidências e prompt; credencial só vai ao provedor, tokens são contabilizados', async () => {
  let request;
  const decision = {
    policyId: 'phone',
    facts: { model: { value: 'X', evidence: 'Phone X' } },
    exclude: false,
    reason: '',
  };
  const events = [
    { type: 'response.output_text.delta', delta: JSON.stringify(decision) },
    {
      type: 'response.completed',
      response: { status: 'completed', usage: { total_tokens: 17 } },
    },
  ];
  const session = {
    models: async () => [{ id: 'model' }],
    token: async () => 'private',
    fetcher: async (url, options) => {
      request = { url, ...options };
      return new Response(
        events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''),
      );
    },
  };
  const result = await analyze(
    session,
    { task: 'resolver', context, model: 'model' },
    new AbortController().signal,
  );
  assert.deepEqual(result, { decision, metrics: { tokens: 17 } });
  const body = JSON.parse(request.body);
  assert.match(body.instructions, /Instrução de teste/);
  assert.match(body.instructions, /compatibilidade/);
  assert.match(body.instructions, /needs_review ou invalid significam exclude=true/);
  assert.match(body.instructions, /sem reformatar unidades/);
  assert.equal(body.store, false);
  assert.equal(JSON.parse(body.input[0].content).policy.id, 'phone');
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('progresso informa preparação relacionada e distingue falha da IA de rejeição ao salvar', async () => {
  const f = fixture();
  const phases = [];
  let rejected = false;
  const flow = new ReviewAiWorkflow(async (op, payload) => {
    if (op === 'resolverClaim') {
      const result = await f.transport(op, payload);
      if (result.item) result.item.context = { ...context, preparation: true };
      return result;
    }
    if (op === 'resolverComplete' && !payload.error && !rejected) {
      rejected = true;
      throw Error('Rejected');
    }
    return f.transport(op, payload);
  }, f.analyze, () => phases.push(flow.progress.title));
  await flow.run('product', 'shop', 2, 'model');
  assert.ok(phases.some(p => p.includes('Preparando candidato relacionado')));
  assert.ok(phases.some(p => p.includes('Resultado recusado')));
  assert.ok(f.sent.some(s => s.op === 'resolverComplete' && s.p.errorCode === 'result_rejected'));
  assert.equal(flow.progress.completed, 2);
});

test('concorrência configurável fica limitada a dois links e mantém contagem por link',async()=>{
 let claimed=0,done=0,active=0,peak=0;const transport=async(op,p)=>{
 if(op==='config')return {resolver:{mode:'active',concurrency:2},settings:{productEnabled:true,categoryEnabled:true}};
 if(op==='prepare')return {nextCursor:null};if(op==='resolverStart')return {id:'run',mode:'active',status:'running'};
 if(op==='resolverClaim'){const item=claimed<4?{id:'i'+claimed++,leaseId:'l',context}:null;return {run:{status:done===4?'completed':'running',stats:{total:4,accepted:done,excluded:0,failed:0}},item};}
 if(op==='resolverComplete'){done++;return {outcome:'drafted'};}return {};};
 const flow=new ReviewAiWorkflow(transport,async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return {decision:{policyId:'phone',facts:{},exclude:false,reason:''}};});
 await flow.run('product','shop',4,'model');assert.equal(peak,2);assert.equal(flow.progress.completed,4);assert.equal(flow.progress.total,4);
});
