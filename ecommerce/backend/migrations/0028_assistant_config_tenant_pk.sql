-- assistant_config.id era PK sozinha ('default' singleton, herdado do
-- vrtech single-tenant). Isso quebraria o 2º tenant de eletrônica: ele
-- nunca conseguiria inserir sua própria linha 'default', porque colidiria
-- com a PK já ocupada pelo tenant vrtech. Vira composta (tenant_id, id) --
-- cada tenant tem seu próprio singleton 'default'.
ALTER TABLE eletronicos.assistant_config DROP CONSTRAINT assistant_config_pkey;
ALTER TABLE eletronicos.assistant_config ADD PRIMARY KEY (tenant_id, id);
