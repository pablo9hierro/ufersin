-- Bug real na migration 0032: service_catalog_items.model_name nem sempre
-- guarda um modelo de aparelho -- em vários registros (serviços avulsos
-- tipo "Formatação PC", "Compra de Aparelho Usado", "Reparo de Flash
-- Motorola") esse campo guarda o próprio rótulo do serviço. A 0032 copiou
-- esse texto pra catalog_models sem distinguir, poluindo o multi-select de
-- "Aparelho/Marca/Modelo" com nomes que não são modelo nenhum.
DELETE FROM eletronicos.catalog_models
WHERE name ~* '^(Reparo de|Troca de|Formatação|Manutenção|Avaliação|Compra de|Entrega de|Instalação|Diagnóstico|Backup)';
