-- Segundo bug real da mesma cadeia de crash-loop: o frontend do Kanban de
-- eletronicos (EletronicaAdminDashboard.tsx) ja trata 'aguardando_diagnostico'
-- e 'diagnostico_enviado' como status legitimos (colunas "Aguardando
-- diagnostico"/"Diagnostico enviado" do Kanban), mas a CHECK constraint
-- original de service_requests (migration 0022) nunca foi atualizada pra
-- permitir esses dois valores -- drift entre front e schema que so foi
-- exposto agora porque o seed de demo foi o primeiro INSERT a tentar usar
-- esses status de verdade.
ALTER TABLE eletronicos.service_requests DROP CONSTRAINT IF EXISTS service_requests_status_check;
ALTER TABLE eletronicos.service_requests ADD CONSTRAINT service_requests_status_check
  CHECK (status IN (
    'pending','accepted','rejected','retirada_local','em_busca',
    'in_progress','em_entrega','completed','em_pagamento',
    'delivered','finished','cancelled',
    'aguardando_diagnostico','diagnostico_enviado'
  ));
