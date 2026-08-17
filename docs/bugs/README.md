# Documentação de bugs, quebras e mudanças de comportamento — Resolutoo

Este módulo tem dois objetivos:

1. **Registrar** todo bug/quebra/desvio de comportamento relatado, cobrindo qualquer camada — frontend, backend, banco, API, Railway, Supabase, Vercel, Evolution API, pipeline de IA.
2. **Garantir** que bug crítico corrigido não volta a acontecer sem ninguém perceber — via `scripts/check-bug-coverage.mjs`, rodado como parte da suíte de testes.

## Onde fica cada coisa

- `docs/bugs/registry.yaml` — a fonte de verdade. Uma entrada por bug, campos estruturados (ver comentário no topo do arquivo).
- `ecommerce/frontend/tests/bug-regressions/run.mjs` — testes automatizados reais (sem mock) contra a API ao vivo, um por bug que tem `regression_test_id`.
- `scripts/check-bug-coverage.mjs` — lê o registry e falha se algum bug `severity: critical` + `status: fixed` não tiver **nem** `regression_test_id` **nem** `manual_verification` preenchido.
- `npm run test:admin` (em `ecommerce/frontend`) já roda o coverage-check + a suíte de regressão + a suíte live de admin, nessa ordem — se o coverage-check falhar, os outros nem rodam.

## Como adicionar um bug novo

1. Corrija o bug de verdade primeiro (ver disciplina normal: investigar causa real, nunca só sintoma).
2. Adicione uma entrada em `registry.yaml` com `id` novo (`BUG-NNN`, sequencial, nunca reutilizar um id antigo mesmo que o bug tenha sido removido depois).
3. Preencha `symptom` (o que foi observado, não a causa) e `root_cause` (a causa técnica REAL, descoberta por investigação — nunca suposição).
4. Se `severity: critical`:
   - Prefira escrever um teste real em `tests/bug-regressions/run.mjs`, nomeado `run('BUG-NNN: descrição', ...)`, e preencha `regression_test_id: "BUG-NNN"`.
   - Se automatizar não for viável agora (custa dinheiro de API, precisa de fluxo multi-turno de WhatsApp, é só observável na UI), preencha `manual_verification` com o passo a passo exato de como checar na mão.
5. Rode `npm run test:bug-coverage` (dentro de `ecommerce/frontend`) — se falhar, alguma das duas coisas acima ainda falta.

## Disciplina pra features novas / mudanças de comportamento esperado

Toda vez que uma feature nova ou uma mudança de comportamento passa pelo circuito de testes, documente o "antes vs depois" — não precisa de registry.yaml pra isso (esse é só pra bugs), mas siga o mesmo espírito:

1. **Antes de mudar**: anote (no commit, ou num arquivo em `docs/changes/` se for uma mudança grande o bastante pra merecer) qual era o comportamento atual e por quê está mudando.
2. **Depois de mudar**: rode a suíte de regressão inteira (`npm run test:admin`) — não só o teste da feature nova. O objetivo é saber com certeza se algo crítico quebrou, não só se a feature nova funciona.
3. Se a mudança tocar em algo que já tem um bug documentado aqui (ex: mexeu de novo em `whatsapp.rs`, que já teve BUG-001/BUG-002), rode o teste de regressão daquele bug especificamente antes de considerar a mudança pronta — é exatamente pra isso que ele existe.
4. Se a mudança for grande o bastante pra merecer sua própria investigação (tipo as que passam pelo agente `subagg`), o próprio plano gerado já serve como esse documento de antes/depois — não precisa duplicar.

## Por que YAML em vez de banco/ferramenta dedicada

Fica no próprio repo, versionado junto com o código que ele documenta (o commit que corrige o bug e a entrada do registry andam juntos), sem infra nova pra manter. Se um dia isso crescer demais pra um arquivo só, dá pra migrar pra um arquivo por bug (`docs/bugs/BUG-NNN.md` + um `index.yaml` só com os campos estruturados) sem mudar a ideia central.
