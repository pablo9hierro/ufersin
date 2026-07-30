# Gestão de ambientes — dev → demo → main

Pipeline de promoção de 3 estágios (o nome de mercado é **"environment
branching"** / **"branch-based promotion pipeline"** — o mesmo conceito por
trás do clássico `dev → staging → production` do GitFlow, adaptado pro
jeito que a Vercel já trabalha nativamente com branches).

```
dev  ──(promover quando validar local)──►  demo  ──(promover quando validar)──►  main
 │                                           │                                     │
 localhost                          demo pública (dados                  produção real
 (instável, é onde                  seedados, /demo do                  (planos pagos,
 eu trabalho)                       Rodoletas aponta pra cá)             tenants reais)
```

## As 3 branches

- **`dev`** — trabalho em andamento, só localhost. Pode quebrar, pode ter
  código pela metade. NUNCA deploya sozinha (sem preview automático na
  Vercel pra ela).
- **`demo`** — o que a demo pública do Rodoletas (`/demo`) mostra pro
  visitante. Só recebe o que já foi testado em `dev`. Se a Vercel tiver um
  Preview Deployment ligado a essa branch, o link fica estável (dá pra
  apontar um domínio tipo `demo.rodoletas.app` pra ele sem precisar trocar
  a URL a cada deploy).
- **`main`** — produção de verdade. Só recebe o que já foi validado em
  `demo`. É o que os tenants pagantes de verdade rodam.

## Como promover

```bash
# 1. Trabalhar em dev (pode commitar direto ou via branch de feature -> dev)
git checkout dev
# ...edita, testa local...
git add -A && git commit -m "..."

# 2. Validado localmente? Promove pra demo (sem regressão nem WIP quebrado)
git checkout demo
git merge dev
git push origin demo   # dispara o Preview Deployment da Vercel, se configurado

# 3. Validado na demo pública? Promove pra produção
git checkout main
git merge demo
git push origin main   # dispara o deploy de produção
```

Nunca pular estágio (`dev -> main` direto) exceto hotfix crítico — aí sim,
corrigir direto em `main` e depois sincronizar de volta pra `demo`/`dev`
(`git checkout dev && git merge main`), pra elas não ficarem atrasadas em
relação à produção.

## Estado atual (2026-07-24)

Branches `dev` e `demo` criadas localmente a partir de `main`, ainda não
enviadas pro GitHub (`git push origin dev demo`) — só faço isso quando o
Pablo confirmar. O trabalho do modo demo sem backend (localApi/localData
seedado) está pronto localmente mas **ainda não commitado** (pedido
explícito do Pablo: só commitar quando estiver perfeito e testado).

## Próximo passo pra ligar isso na Vercel

1. No dashboard do projeto Vercel do `ufersin/frontend` (e futuramente do
   `ecommerce/frontend`, quando ele também for pra produção): em Settings
   → Git, garantir que Production Branch = `main`.
2. Toda branch enviada ao GitHub que não seja `main` já vira Preview
   Deployment automático por padrão na Vercel — não precisa configurar
   nada extra pra isso acontecer com `demo` e `dev`.
3. Pra `demo` ter uma URL fixa e apresentável (em vez do link aleatório de
   preview), usar Vercel → Settings → Domains → atribuir um domínio (ou
   subdomínio) especificamente à branch `demo` (a Vercel suporta domínio
   por branch, não só por produção).
