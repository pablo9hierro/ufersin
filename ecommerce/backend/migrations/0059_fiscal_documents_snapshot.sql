-- Snapshot imutavel do resultado da resolucao fiscal no momento da
-- emissao (CFOP/CST/CSOSN/cclass_trib efetivamente usados, apos combinar
-- perfil + overrides do produto + contexto da venda -- ver
-- resolution.rs::resolve). Sem isso, editar um perfil fiscal depois
-- mudaria retroativamente a "explicacao" de notas ja emitidas -- a nota em
-- si (XML/DANFE) ja e imutavel no Jubilados, mas nosso lado tambem precisa
-- registrar o que foi decidido e por que, sem depender de reconstruir a
-- partir do estado atual (que pode ja ter mudado).
ALTER TABLE fiscal_documents
  ADD COLUMN IF NOT EXISTS resolved_snapshot JSONB;
